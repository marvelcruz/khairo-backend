import Pricing from "../models/Pricing.js";
import { initializeTransaction } from "../utils/paystack.js";
import { generatePaymentReference, generateReceiptNumber } from "../utils/generateReference.js";
import { logAudit } from "../utils/auditLogger.js";
import Application from "../models/Application.js";
import Client from "../models/Client.js";
import Payment from "../models/Payment.js";
import AuditLog from "../models/AuditLog.js";
import { sendEmail } from "../utils/mailer.js";
import { syncApplicationToCrm } from "../services/crmService.js";
import { copyCustomFieldValues } from "../services/customFieldService.js";
import { dispatchWorkflowEvent } from "../services/workflowService.js";
import {
  getLegacyCycleWeeks,
  isLegacyProgramKey,
  normalizeLegacyProgramKey,
  resolveLegacyProgramOffering,
  resolveProgramInterestSelection,
} from "../utils/programOfferingResolver.js";

async function buildApplicationProgramInterest(
  value
) {
  const selection =
    await resolveProgramInterestSelection(
      value,
      { defaultToNotSure: true }
    );

  if (!selection.valid) {
    return {
      errorStatus:
        selection.reason === "missing_offering"
          ? 409
          : 400,
      message:
        selection.reason === "missing_offering"
          ? "This program is not linked to an active catalogue offering. Please contact an administrator."
          : "Invalid program interest.",
    };
  }

  return {
    fields: {
      programInterest: selection.key,
      ...(selection.offering
        ? {
            programInterestOffering:
              selection.offering._id,
          }
        : {}),
    },
  };
}

// @route POST /api/public/applications - PUBLIC, no auth required
export const submitApplication = async (req, res, next) => {
  try {
    const { fullName, email, phone, programInterest, goals, healthNotes } = req.body;

    if (!fullName || !email || !phone) {
      return res.status(400).json({ success: false, message: "Full name, email, and phone are required." });
    }

    const interest =
      await buildApplicationProgramInterest(
        programInterest
      );

    if (interest.errorStatus) {
      return res.status(interest.errorStatus).json({
        success: false,
        message: interest.message,
      });
    }

    const application = await Application.create({
      fullName,
      email,
      phone,
      ...interest.fields,
      goals,
      healthNotes,
    });

    // CRM synchronization and workflow automation must never block the existing application flow.
    syncApplicationToCrm(application)
      .then(({ contact, opportunity }) =>
        dispatchWorkflowEvent({
          type: "application_submitted",
          eventKey: `application_submitted:${application._id}`,
          applicationId: application._id,
          contactId: contact?._id,
          opportunityId: opportunity?._id,
          actorName: "Public application",
          data: {
            applicationName: application.fullName,
            programInterest: application.programInterest || application.program || "not_sure",
          },
        })
      )
      .catch((error) => {
        console.error("CRM/application workflow sync failed:", error.message);
      });

    res.status(201).json({
      success: true,
      message: "Thank you! Your application has been received. We'll be in touch soon.",
      applicationId: application._id,
    });
  } catch (err) {
    next(err);
  }
};

// @route GET /api/applications (staff only)
export const getApplications = async (req, res, next) => {
  try {
    const { status, page = 1, limit = 30 } = req.query;
    const query = {};
    if (status) query.status = status;

    const completedClients = await Client.find({
      reconciled: true,
      fromApplication: { $ne: null },
    }).select("fromApplication");

    const completedApplicationIds = completedClients
      .map((c) => c.fromApplication)
      .filter(Boolean);

    if (completedApplicationIds.length) {
      query._id = { $nin: completedApplicationIds };
    }

    const safeLimit = Math.min(Number(limit) || 30, 100);
    const skip = (Number(page) - 1) * safeLimit;

    const [applications, total] = await Promise.all([
      Application.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(safeLimit),
      Application.countDocuments(query),
    ]);

    const emails = [...new Set(applications.map((a) => a.email).filter(Boolean))];
    const explicitClientIds = applications.map((a) => a.clientId).filter(Boolean);

    const clientLookup = [];
    if (emails.length) clientLookup.push({ email: { $in: emails } });
    if (explicitClientIds.length) clientLookup.push({ _id: { $in: explicitClientIds } });

    const clients = clientLookup.length
      ? await Client.find({ $or: clientLookup }).select(
          "email isArchived program reconciled programReconciliation adminReconciliationReview finalReconciliation fromApplication"
        )
      : [];

    const clientIds = clients.map((c) => c._id);

    const paidRows = clientIds.length
      ? await Payment.find({
          client: { $in: clientIds },
          status: "success",
          purpose: { $ne: "consultation" },
        }).select("client")
      : [];

    const paidIds = new Set(paidRows.map((row) => row.client.toString()));
    const byEmail = new Map(clients.map((c) => [c.email, c]));
    const byId = new Map(clients.map((c) => [c._id.toString(), c]));

    const enriched = applications.map((a) => {
      const obj = a.toObject();
      const client =
        (a.clientId && byId.get(a.clientId.toString())) ||
        byEmail.get(a.email);

      obj.clientId = client ? client._id : a.clientId || null;
      obj.clientArchived = client ? client.isArchived : false;
      obj.program = client?.program || a.program || null;
      obj.paid = client ? paidIds.has(client._id.toString()) : false;
      obj.reconciled = client?.reconciled === true;
      obj.programReconciliation = client?.programReconciliation || null;
      obj.adminReconciliationReview = client?.adminReconciliationReview || null;
      obj.finalReconciliation = client?.finalReconciliation || null;

      return obj;
    });

    const appIds = applications.map((a) => a._id.toString());
    const clientIdsForAudit = clients.map((c) => c._id.toString());

    const orConditions = [];
    if (appIds.length) {
      orConditions.push({ entityType: "Application", entityId: { $in: appIds } });
    }
    if (clientIdsForAudit.length) {
      orConditions.push({ entityType: "Client", entityId: { $in: clientIdsForAudit } });
    }

    const allLogs = orConditions.length
      ? await AuditLog.find({ $or: orConditions })
          .populate("user", "name")
          .sort({ createdAt: 1 })
      : [];

    const logsByEntity = {};
    for (const log of allLogs) {
      if (!logsByEntity[log.entityId]) logsByEntity[log.entityId] = [];
      logsByEntity[log.entityId].push(log);
    }

    const buildTimeline = (application, client) => {
      const appId = application._id.toString();
      const clientId = client ? client._id.toString() : null;

      const logs = [
        ...(logsByEntity[appId] || []),
        ...(clientId && logsByEntity[clientId] ? logsByEntity[clientId] : []),
      ];

      const t = {
        applied: { at: application.createdAt },
        contacted: null,
        declined: null,
        reconciled: null,
        programMismatch: null,
        adminReview: null,
        finalReconciled: null,
        approved: null,
        linkSent: null,
        paid: null,
      };

      for (const log of logs) {
        const who = log.user?.name || log.userName;
        const at = log.createdAt;

        if (log.action === "Contacted application" && !t.contacted) {
          t.contacted = { by: who, at };
        }

        if (log.action === "Declined application" && !t.declined) {
          t.declined = { by: who, at };
        }

        if (log.action === "Reconciled payment") {
          try {
            const details = JSON.parse(log.details || "{}");
            if (details.matched === false) {
              t.programMismatch = { by: who, at, ...details };
            } else {
              t.reconciled = { by: who, at, ...details };
            }
          } catch {
            t.reconciled = { by: who, at };
          }
        }

        if (log.action === "Program payment mismatch") {
          try {
            t.programMismatch = {
              by: who,
              at,
              ...JSON.parse(log.details || "{}"),
            };
          } catch {
            t.programMismatch = { by: who, at };
          }
        }

        if (log.action === "Admin reviewed payment mismatch") {
          try {
            t.adminReview = {
              by: who,
              at,
              ...JSON.parse(log.details || "{}"),
            };
          } catch {
            t.adminReview = { by: who, at };
          }
        }

        if (log.action === "Final reconciliation") {
          try {
            t.finalReconciled = {
              by: who,
              at,
              ...JSON.parse(log.details || "{}"),
            };
          } catch {
            t.finalReconciled = { by: who, at };
          }
        }

        if (log.action === "Approved application" && !t.approved) {
          t.approved = { by: who, at };
        }

        if (log.action === "Generated payment link" && !t.linkSent) {
          t.linkSent = { by: who, at, method: "copied" };
        }

        if (log.action === "Emailed payment link") {
          t.linkSent = { by: who, at, method: "emailed" };
        }

        if (
          ["Program payment received", "Subscription activated via payment", "Manually activated subscription"].includes(log.action)
        ) {
          t.paid = { by: who, at };
        }
      }

      const statusValue = application.status;

      if (
        !t.contacted &&
        ["contacted", "approved", "declined"].includes(statusValue)
      ) {
        t.contacted = {
          by: "Staff",
          at: application.updatedAt || application.createdAt,
        };
      }

      if (!t.approved && statusValue === "approved") {
        t.approved = {
          by: "Staff",
          at: application.updatedAt || application.createdAt,
        };
      }

      return t;
    };

    const finalEnriched = enriched.map((obj) => {
      const application = applications.find(
        (a) => a._id.toString() === obj._id.toString()
      );

      const client =
        (obj.clientId && byId.get(obj.clientId.toString())) ||
        byEmail.get(obj.email);

      return {
        ...obj,
        timeline: buildTimeline(application, client),
      };
    });

    res.status(200).json({
      success: true,
      count: finalEnriched.length,
      total,
      applications: finalEnriched,
    });
  } catch (err) {
    next(err);
  }
};

export const updateApplication = async (req, res, next) => {
  try {
    const { status, reviewNotes } = req.body;
    const updates = { reviewedBy: req.user._id };
    if (status) updates.status = status;
    if (reviewNotes !== undefined) updates.reviewNotes = reviewNotes;

    if (status && status !== "approved") {
      const existing = await Application.findById(req.params.id);
      if (existing) {
        const linkedClient = await Client.findOne({ email: existing.email });
        if (linkedClient) {
          const hasSuccess = await Payment.exists({ client: linkedClient._id, status: "success" });
          if (hasSuccess) {
            return res.status(409).json({ success: false, message: "This lead has paid - paperwork is locked. Use deliberate actions (archive/void) for changes." });
          }
        }
      }
    }

    const application = await Application.findByIdAndUpdate(req.params.id, updates, {
      new: true,
      runValidators: true,
    });

    if (!application) {
      return res.status(404).json({ success: false, message: "Application not found." });
    }

    if (status) {
      const actionMap = { contacted: "Contacted application", approved: "Approved application", declined: "Declined application", pending: "Reset application to pending" };
      const action = actionMap[status];
      if (action) {
        await AuditLog.create({
          user: req.user._id,
          userName: req.user.name,
          action,
          entityType: "Application",
          entityId: application._id.toString(),
          details: application.fullName,
        });
      }
    }

    res.status(200).json({ success: true, application });
  } catch (err) {
    next(err);
  }
};

// @route POST /api/applications/:id/approve (staff only)
// Creates or links the provisional Client record used for program payment.
// Admission to the active client roster happens only after reconciliation.
export const approveApplication = async (req, res, next) => {
  try {
    const program = normalizeLegacyProgramKey(
      req.body.program
    );

    if (!isLegacyProgramKey(program)) {
      return res.status(400).json({
        success: false,
        message: "A currently supported program is required.",
      });
    }

    const offering = await resolveLegacyProgramOffering(program);

    if (!offering) {
      return res.status(409).json({
        success: false,
        message:
          "This program is not linked to an active catalogue offering. Please contact an administrator.",
      });
    }

    const cycleWeeks = getLegacyCycleWeeks(offering, program);

    const application = await Application.findById(req.params.id);

    if (!application) {
      return res.status(404).json({
        success: false,
        message: "Application not found.",
      });
    }

    const consultationDecision =
      application.consultationDecision || "pending";

    if (consultationDecision === "pending") {
      return res.status(409).json({
        success: false,
        message:
          "Record the consultation decision before selecting the program.",
      });
    }

    if (
      consultationDecision === "yes" &&
      !application.consultationReconciled
    ) {
      return res.status(409).json({
        success: false,
        message:
          "Complete consultation reconciliation before selecting the program.",
      });
    }

    let client =
      (application.clientId &&
        (await Client.findById(application.clientId))) ||
      (await Client.findOne({ email: application.email }));

    if (client?.reconciled) {
      return res.status(409).json({
        success: false,
        message: "This person is already a reconciled client.",
      });
    }

    if (!client) {
      client = await Client.create({
        fullName: application.fullName,
        email: application.email,
        phone: application.phone,
        assignedDoctor: application.assignedDoctor || null,
        program,
        programOffering: offering._id,
        cycleWeeks,
        fromApplication: application._id,
        addedBy: req.user._id,
        reconciled: false,
      });
    } else {
      client.fullName = application.fullName;
      client.phone = application.phone;
      client.program = program;
      client.programOffering = offering._id;
      client.cycleWeeks = cycleWeeks;
      client.fromApplication = application._id;
      if (!client.addedBy) client.addedBy = req.user._id;
      await client.save();
    }

    application.clientId = client._id;
    application.program = program;
    application.programOffering = offering._id;
    application.status = "approved";
    application.reviewedBy = req.user._id;
    await application.save();

    await copyCustomFieldValues({ fromType: "application", fromId: application._id, toType: "client", toId: client._id, userId: req.user._id });

    await AuditLog.create({
      user: req.user._id,
      userName: req.user.name,
      action: "Approved application",
      entityType: "Application",
      entityId: application._id.toString(),
      details: `${application.fullName} → ${program}`,
    });

    syncApplicationToCrm(application, {
      userId: req.user._id,
      userName: req.user.name,
    })
      .then(async ({ contact, opportunity }) => {
        contact.client = client._id;
        contact.updatedBy = req.user._id;
        await contact.save();

        opportunity.client = client._id;
        opportunity.updatedBy = req.user._id;
        await opportunity.save();
      })
      .catch((error) => {
        console.error("CRM approval sync failed:", error.message);
      });

    res.status(201).json({
      success: true,
      client,
      application,
    });
  } catch (err) {
    next(err);
  }
};

export const addManualApplication = async (req, res, next) => {
  try {
    const { fullName, email, phone, programInterest, goals, healthNotes } = req.body;
    if (!fullName || !phone) {
      return res.status(400).json({ success: false, message: "Name and phone are required." });
    }

    const interest =
      await buildApplicationProgramInterest(
        programInterest
      );

    if (interest.errorStatus) {
      return res.status(interest.errorStatus).json({
        success: false,
        message: interest.message,
      });
    }

    const application = await Application.create({
      fullName,
      email,
      phone,
      ...interest.fields,
      goals,
      healthNotes,
    });
    await AuditLog.create({
      user: req.user._id,
      userName: req.user.name,
      action: "Manually added request",
      entityType: "Application",
      entityId: application._id.toString(),
      details: fullName,
    });
    res.status(201).json({ success: true, application });
  } catch (err) {
    next(err);
  }
};


export const createManualApplication = async (req, res, next) => {
  try {
    const { fullName, email, phone, programInterest, goals, healthNotes } = req.body;

    if (!fullName || !phone) {
      return res.status(400).json({ success: false, message: "Name and phone are required." });
    }

    const cleanName = String(fullName).trim();
    const nameParts = cleanName.split(/\s+/);
    const firstName = nameParts[0] || "";
    const lastName = nameParts.slice(1).join(" ");

    const interest =
      await buildApplicationProgramInterest(
        programInterest
      );

    if (interest.errorStatus) {
      return res.status(interest.errorStatus).json({
        success: false,
        message: interest.message,
      });
    }

    const application = await Application.create({
      fullName: cleanName,
      firstName,
      lastName,
      email,
      phone,
      ...interest.fields,
      goals,
      healthNotes,
      status: "pending",
      source: "manual",
      submittedBy: req.user?._id || req.user,
      timeline: { applied: { at: new Date(), by: (req.user && req.user.name) || "Staff", method: "manual" } },
    });

    await AuditLog.create({
      user: req.user._id,
      userName: req.user.name,
      action: "Manually added request",
      entityType: "Application",
      entityId: application._id.toString(),
      details: cleanName,
    });

    syncApplicationToCrm(application, {
      userId: req.user._id,
      userName: req.user.name,
    })
      .then(({ contact, opportunity }) =>
        dispatchWorkflowEvent({
          type: "application_submitted",
          eventKey: `application_submitted:${application._id}`,
          applicationId: application._id,
          contactId: contact?._id,
          opportunityId: opportunity?._id,
          actorUserId: req.user._id,
          actorName: req.user.name,
          data: {
            applicationName: application.fullName,
            programInterest: application.programInterest || application.program || "not_sure",
          },
        })
      )
      .catch((error) => {
        console.error("CRM/manual application workflow sync failed:", error.message);
      });

    res.status(201).json({ success: true, application });
  } catch (err) {
    next(err);
  }
};


export const updateConsultationDetails = async (req, res, next) => {
  try {
    const { consultationDecision, assignedDoctor } = req.body;
    const app = await Application.findById(req.params.id);
    if (!app) return res.status(404).json({ success: false, message: "Not found" });
    
    if (consultationDecision !== undefined) app.consultationDecision = consultationDecision;
    if (assignedDoctor !== undefined) {
      app.assignedDoctor = assignedDoctor || null;
      app.timeline = app.timeline || {};
      if (assignedDoctor) {
        app.timeline.doctorAssigned = { at: new Date(), by: req.user?.name || "Staff", doctorId: assignedDoctor };
      }
    }
    await app.save();
    if (assignedDoctor !== undefined) {
      const linkedClient =
        (app.clientId && (await Client.findById(app.clientId))) ||
        (app.email && (await Client.findOne({ email: String(app.email).toLowerCase().trim() })));

      if (linkedClient) {
        linkedClient.assignedDoctor = assignedDoctor || null;
        await linkedClient.save();
      }
    }

    await app.populate("assignedDoctor", "name");
    res.status(200).json({ success: true, application: app });
  } catch (err) { next(err); }
};

export const generateConsultationLink = async (req, res, next) => {
  try {
    const app = await Application.findById(req.params.id);

    if (!app) {
      return res.status(404).json({
        success: false,
        message: "Application not found",
      });
    }

    if (app.consultationDecision !== "yes") {
      return res.status(409).json({
        success: false,
        message:
          "Consultation must be accepted before generating a consultation payment link.",
      });
    }

    if (!app.assignedDoctor) {
      return res.status(409).json({
        success: false,
        message:
          "Assign a doctor before generating the consultation payment link.",
      });
    }

    const pricing = await Pricing.findOne();
    const consultFee = pricing?.consultationFee || 15000;

    const reference = generatePaymentReference();

    const payment = await Payment.create({
      receiptNumber: await generateReceiptNumber(Payment),
      application: app._id,
      purpose: "consultation",
      amount: consultFee,
      reference,
      status: "pending",
    });

    const paystackRes = await initializeTransaction({
      email: app.email,
      amountKobo: consultFee * 100,
      reference,
      callback_url: process.env.PAYSTACK_CALLBACK_URL,
      metadata: {
        applicationId: app._id.toString(),
        paymentId: payment._id.toString(),
        purpose: "consultation",
      },
    });

    if (!paystackRes.status) {
      payment.status = "failed";
      await payment.save();

      return res.status(502).json({
        success: false,
        message: paystackRes.message,
      });
    }

    res.status(200).json({
      success: true,
      authorizationUrl: paystackRes.data.authorization_url,
      reference,
      amount: consultFee,
    });
  } catch (err) {
    next(err);
  }
};

export const generateCombinedLink = async (req, res) => {
  return res.status(409).json({
    success: false,
    message:
      "Combined consultation and program payment links are disabled. Complete consultation payment and reconciliation first, then generate the program payment.",
  });
};


export const reconcileConsultation = async (req, res, next) => {
  try {
    const { amountReceived, method = "bank_transfer" } = req.body;

    const received = Number(amountReceived);

    if (!received || received <= 0) {
      return res.status(400).json({
        success: false,
        message: "Enter the exact consultation amount received.",
      });
    }

    const app = await Application.findById(req.params.id);

    if (!app) {
      return res.status(404).json({
        success: false,
        message: "Application not found",
      });
    }

    if (app.consultationDecision !== "yes") {
      return res.status(409).json({
        success: false,
        message:
          "Consultation reconciliation is available only when consultation was accepted.",
      });
    }

    if (!app.assignedDoctor) {
      return res.status(409).json({
        success: false,
        message:
          "Assign a doctor before reconciling the consultation.",
      });
    }

    const pricing = await Pricing.findOne();
    const expected = pricing?.consultationFee || 15000;
    let payment = await Payment.findOne({
      application: app._id,
      purpose: "consultation",
      status: "success",
    }).sort({
      paidAt: -1,
      createdAt: -1,
    });

    const successfulCombinedPayment = await Payment.findOne({
      application: app._id,
      purpose: "combined",
      status: "success",
    }).sort({
      paidAt: -1,
      createdAt: -1,
    });

    if (!payment && !successfulCombinedPayment) {
      payment = await Payment.create({
        receiptNumber: await generateReceiptNumber(Payment),
        application: app._id,
        purpose: "consultation",
        amount: received,
        reference: "MANUAL-" + generatePaymentReference(),
        status: "success",
        channel: "reconciled_" + method,
        paidAt: new Date(),
      });
    }

    const consultationPaymentAmount =
      payment ? Number(payment.amount) : received;

    const ledgerMismatch =
      payment
        ? consultationPaymentAmount !== received
        : false;

    const matched =
      received === expected &&
      !ledgerMismatch;

    app.consultationPaid = true;
    app.consultationReconciled = matched;
    app.timeline = app.timeline || {};

    app.timeline.consultationPaid = {
      at: new Date(),
      by: req.user?.name || "Staff",
      amount: received,
      method,
      matched,
      expected,
      paymentAmount: consultationPaymentAmount,
      ledgerMismatch,
    };

    app.timeline.consultationReconciled = {
      at: new Date(),
      by: req.user?.name || "Staff",
      amount: received,
      matched,
      expected,
      paymentAmount: consultationPaymentAmount,
      ledgerMismatch,
    };

    await app.save();

    await logAudit(
      req,
      matched ? "Reconciled consultation" : "Consultation payment mismatch",
      "Application",
      app._id,
      JSON.stringify({
        amountReceived: received,
        expected,
        matched,
        method,
        paymentAmount: consultationPaymentAmount,
        ledgerMismatch,
      })
    );

    res.status(200).json({
      success: true,
      matched,
      requiresCorrection: !matched,
      ledgerMismatch,
      paymentAmount: consultationPaymentAmount,
      application: app,
    });
  } catch (err) {
    next(err);
  }
};

export const nudgeStuckLeads = async (req, res, next) => {
  try {
    const cutoff = new Date(Date.now() - 3 * 86400000);
    const stuck = await Application.find({ status: "contacted", createdAt: { $lte: cutoff } });
    let sent = 0;
    for (const a of stuck) {
      if (!a.email) continue;
      const html = `<div style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;background:#0a0a0a;padding:32px;color:#f5f5f5;"><div style="max-width:520px;margin:0 auto;background:#171717;border:1px solid #262626;border-radius:8px;padding:32px;"><div style="display:flex;align-items:center;gap:10px;margin-bottom:24px;"><div style="width:36px;height:36px;background:#0d9488;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:700;color:white;">F</div><span style="font-weight:600;letter-spacing:-0.02em;">KHAIRO</span></div><p style="margin:0 0 16px;font-size:15px;">Hi ${a.fullName},</p><p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#d4d4d4;">A few days ago you reached out about starting with us - and we don't want you to lose that momentum.</p><p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#d4d4d4;">Your first week is simple: one consultation, one meal plan built for your body, and a coach who checks in every single day. No guesswork, no fad diets.</p><div style="text-align:center;margin:32px 0;"><a href="mailto:hello@khairo.com?subject=I'm ready to start" style="display:inline-block;background:#0d9488;color:white;text-decoration:none;padding:14px 28px;border-radius:999px;font-weight:600;font-size:14px;">I'm ready to start →</a></div><p style="margin:0;font-size:12px;color:#737373;">Questions? Just reply to this email - a real human reads every one.</p></div></div>`;
      await sendEmail({
        to: a.email,
        subject: `Still thinking it over, ${a.fullName.split(" ")[0]}? - KhairoDietClinic`,
        html,
        text: `Hi ${a.fullName},\n\nA few days ago you reached out about starting with us. Your first week is simple: one consultation, one meal plan built for your body, and a coach who checks in daily.\n\nReply to this email when you're ready to start.\n\n- KhairoDietClinic`,
      });
      await AuditLog.create({ user: req.user._id, userName: req.user.name, action: "Nudged stuck lead", entityType: "Application", entityId: a._id.toString(), details: a.fullName });
      sent++;
    }
    res.status(200).json({ success: true, sent, total: stuck.length });
  } catch (err) {
    next(err);
  }
};
