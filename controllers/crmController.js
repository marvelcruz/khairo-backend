import Application from "../models/Application.js";
import CrmActivity from "../models/CrmActivity.js";
import CrmContact, {
  CRM_PREFERRED_CONTACT_METHOD_VALUES,
} from "../models/CrmContact.js";
import CrmOpportunity, {
  CRM_LEAD_PRIORITY_VALUES,
  CRM_STAGE_VALUES,
} from "../models/CrmOpportunity.js";
import User from "../models/User.js";
import { logAudit } from "../utils/auditLogger.js";
import { normalizeCrmSource, CRM_SOURCE_VALUES } from "../utils/crmSourceTaxonomy.js";
import { addCrmActivity, ensureOpenOpportunity, findCrmContact, syncApplicationToCrm, upsertCrmLead } from "../services/crmService.js";
import { copyCustomFieldValues } from "../services/customFieldService.js";
import { dispatchWorkflowEvent } from "../services/workflowService.js";
import {
  normalizeProgramInterestKey,
  resolveProgramInterestSelection,
} from "../utils/programOfferingResolver.js";

const escapeRegex = (str = "") => str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const clampLimit = (requested, max = 100, fallback = 30) => {
  const value = Number(requested);
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return Math.min(Math.floor(value), max);
};
const validActivityTypes = ["note", "call", "email", "whatsapp", "meeting", "task"];

async function resolveCrmInterestInput(
  value,
  { defaultToNotSure = false } = {}
) {
  const selection =
    await resolveProgramInterestSelection(
      value,
      { defaultToNotSure }
    );

  if (selection.valid) {
    return { selection };
  }

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

function applyCrmInterestSelection(
  document,
  selection
) {
  document.programInterest = selection.key;

  document.programInterestOffering =
    selection.offering
      ? selection.offering._id
      : undefined;
}
const CRM_DATE_MIN = new Date("2000-01-01T00:00:00.000Z").getTime();
const CRM_DATE_MAX = new Date("2101-01-01T00:00:00.000Z").getTime();

const parseCrmDate = (value, label) => {
  if (value === undefined) return { provided: false, value: undefined };
  if (value === null || value === "") return { provided: true, value: undefined };
  if (typeof value !== "string" || !/(?:Z|[+-]\d{2}:\d{2})$/i.test(value.trim())) {
    return { provided: true, error: `${label} must include an explicit timezone.` };
  }

  const date = new Date(value);
  const time = date.getTime();
  if (!Number.isFinite(time) || time < CRM_DATE_MIN || time >= CRM_DATE_MAX) {
    return { provided: true, error: `${label} must be a valid date between 2000 and 2100.` };
  }

  return { provided: true, value: date };
};

const REQUIRED_FIELDS_BY_STAGE = {
  qualification: [
    { entity: "contact", field: "fullName", label: "Full name" },
    { entity: "contact", field: "email", label: "Email" },
    { entity: "contact", field: "phone", label: "Phone" },
    {
      entity: "opportunity",
      field: "programInterest",
      label: "Program interest",
      invalid: (value) => !value || value === "not_sure",
    },
  ],
  consultation_booked: [
    { entity: "contact", field: "fullName", label: "Full name" },
    { entity: "contact", field: "email", label: "Email" },
    { entity: "contact", field: "phone", label: "Phone" },
    {
      entity: "opportunity",
      field: "nextFollowUpAt",
      label: "Consultation date/time",
    },
  ],
  medical_review: [
    { entity: "contact", field: "fullName", label: "Full name" },
    { entity: "contact", field: "email", label: "Email" },
    { entity: "contact", field: "phone", label: "Phone" },
    { entity: "opportunity", field: "assignedTo", label: "Owner" },
  ],
  payment_pending: [
    { entity: "contact", field: "fullName", label: "Full name" },
    { entity: "contact", field: "email", label: "Email" },
    { entity: "contact", field: "phone", label: "Phone" },
    {
      entity: "opportunity",
      field: "programInterest",
      label: "Program interest",
      invalid: (value) => !value || value === "not_sure",
    },
    {
      entity: "opportunity",
      field: "estimatedValue",
      label: "Estimated value",
      invalid: (value) => !Number.isFinite(Number(value)) || Number(value) <= 0,
    },
  ],
};

function missingRequiredFieldsForStage(targetStage, contact, opportunity) {
  const rules = REQUIRED_FIELDS_BY_STAGE[targetStage] || [];
  const missing = [];

  for (const rule of rules) {
    const value =
      rule.entity === "contact"
        ? contact?.[rule.field]
        : opportunity?.[rule.field];

    if (rule.invalid ? rule.invalid(value) : !value) {
      missing.push(rule.label);
    }
  }

  return missing;
}

const contactDto = (contact, opportunity = null) => ({
  ...contact.toObject(),
  opportunity: opportunity ? opportunity.toObject() : null,
});

export const getCrmAssignees = async (req, res, next) => {
  try {
    const users = await User.find({
      isActive: true,
      roles: { $in: ["admin", "sales", "staff", "coach"] },
    })
      .select("_id name roles isActive")
      .sort({ name: 1 });

    res.status(200).json({ success: true, users });
  } catch (err) {
    next(err);
  }
};

export const getCrmOverview = async (req, res, next) => {
  try {
    const now = new Date();
    const [stageRows, openCount, openValueRows, overdueFollowUps, unassigned, recentContacts] = await Promise.all([
      CrmOpportunity.aggregate([
        { $match: { status: { $in: ["open", "lost"] } } },
        { $group: { _id: "$stage", count: { $sum: 1 }, value: { $sum: "$estimatedValue" } } },
      ]),
      CrmOpportunity.countDocuments({ status: "open" }),
      CrmOpportunity.aggregate([
        { $match: { status: "open" } },
        { $group: { _id: null, value: { $sum: "$estimatedValue" } } },
      ]),
      CrmOpportunity.countDocuments({ status: "open", nextFollowUpAt: { $lt: now } }),
      CrmOpportunity.countDocuments({ status: "open", assignedTo: null }),
      CrmContact.find({ isArchived: false })
        .sort({ createdAt: -1 })
        .limit(5)
        .populate("assignedTo", "name roles"),
    ]);

    const stages = Object.fromEntries(
      CRM_STAGE_VALUES.map((stage) => [stage, { count: 0, value: 0 }])
    );
    for (const row of stageRows) stages[row._id] = { count: row.count, value: row.value || 0 };

    res.status(200).json({
      success: true,
      openCount,
      openValue: openValueRows[0]?.value || 0,
      overdueFollowUps,
      unassigned,
      stages,
      recentContacts,
    });
  } catch (err) {
    next(err);
  }
};

export const getCrmContacts = async (req, res, next) => {
  try {
    const { search = "", stage, assignedTo, source, tags = "", page = 1, limit = 30 } = req.query;
    const query = { isArchived: false, lifecycleStage: { $in: ["lead", "applicant"] } };

    if (search) {
      const rx = new RegExp(escapeRegex(String(search).trim()), "i");
      query.$or = [{ fullName: rx }, { email: rx }, { phone: rx }];
    }
    if (assignedTo) query.assignedTo = assignedTo;
    if (source) query.source = source;

    const tagKeys = String(tags || "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);

    if (tagKeys.length) {
      query.tags = { $all: tagKeys };
    }

    if (stage) {
      if (!CRM_STAGE_VALUES.includes(stage)) {
        return res.status(400).json({ success: false, message: "Invalid CRM stage." });
      }
      const matching = await CrmOpportunity.find({ stage, status: { $in: ["open", "lost"] } }).select("contact");
      query._id = { $in: matching.map((item) => item.contact) };
    }

    const safeLimit = clampLimit(limit);
    const safePage = Math.max(Number(page) || 1, 1);
    const skip = (safePage - 1) * safeLimit;

    const [contacts, total] = await Promise.all([
      CrmContact.find(query)
        .sort({ lastActivityAt: -1, createdAt: -1 })
        .skip(skip)
        .limit(safeLimit)
        .populate("assignedTo", "name roles"),
      CrmContact.countDocuments(query),
    ]);

    const opportunities = contacts.length
      ? await CrmOpportunity.find({
          contact: { $in: contacts.map((contact) => contact._id) },
          status: { $in: ["open", "lost"] },
        })
          .sort({ updatedAt: -1 })
          .populate("assignedTo", "name roles")
      : [];

    const byContact = new Map();
    for (const opportunity of opportunities) {
      const key = opportunity.contact.toString();
      if (!byContact.has(key)) byContact.set(key, opportunity);
    }

    res.status(200).json({
      success: true,
      contacts: contacts.map((contact) => contactDto(contact, byContact.get(contact._id.toString()))),
      total,
      page: safePage,
      pages: Math.ceil(total / safeLimit),
    });
  } catch (err) {
    next(err);
  }
};

export const getCrmContactById = async (req, res, next) => {
  try {
    const contact = await CrmContact.findOne({ _id: req.params.id, isArchived: false })
      .populate("assignedTo", "name roles")
      .populate("application", "fullName status program programInterest consultationDecision clientId")
      .populate("client", "fullName status program reconciled portalActive");

    if (!contact) {
      return res.status(404).json({ success: false, message: "CRM contact not found." });
    }

    const [opportunity, activities] = await Promise.all([
      CrmOpportunity.findOne({ contact: contact._id })
        .sort({ updatedAt: -1 })
        .populate("assignedTo", "name roles"),
      CrmActivity.find({ contact: contact._id })
        .sort({ createdAt: -1 })
        .limit(100)
        .populate("createdBy", "name roles")
        .populate("assignedTo", "name roles"),
    ]);

    res.status(200).json({ success: true, contact, opportunity, activities });
  } catch (err) {
    next(err);
  }
};

export const createCrmContact = async (req, res, next) => {
  try {
    const {
      fullName,
      email,
      phone,
      source = "manual",
      sourceDetail = "",
      preferredContactMethod = "no_preference",
      programInterest = "not_sure",
      assignedTo,
      estimatedValue = 0,
      leadPriority = "normal",
      nextFollowUpAt,
      note,
    } = req.body;

    if (!fullName || (!email && !phone)) {
      return res.status(400).json({
        success: false,
        message: "Name and at least one contact method (email or phone) are required.",
      });
    }
    if (
      !CRM_PREFERRED_CONTACT_METHOD_VALUES.includes(
        preferredContactMethod
      )
    ) {
      return res.status(400).json({
        success: false,
        message: "Choose a valid preferred contact method.",
      });
    }

    if (!CRM_LEAD_PRIORITY_VALUES.includes(leadPriority)) {
      return res.status(400).json({
        success: false,
        message: "Choose a valid lead priority.",
      });
    }

    const interest =
      await resolveCrmInterestInput(
        programInterest,
        { defaultToNotSure: true }
      );

    if (interest.errorStatus) {
      return res.status(interest.errorStatus).json({
        success: false,
        message: interest.message,
      });
    }

    const parsedFollowUp = parseCrmDate(nextFollowUpAt, "Next follow-up");
    if (parsedFollowUp.error) {
      return res.status(400).json({ success: false, message: parsedFollowUp.error });
    }

    const existing = await findCrmContact({ email, phone });
    if (existing) {
      return res.status(409).json({
        success: false,
        message: "A CRM contact with this email or phone already exists.",
        contactId: existing._id,
      });
    }

    if (assignedTo) {
      const assignee = await User.findOne({ _id: assignedTo, isActive: true });
      if (!assignee) return res.status(400).json({ success: false, message: "Assigned staff member was not found." });
    }

    const { contact, opportunity } = await upsertCrmLead(
      {
        fullName,
        email,
        phone,
        source,
        sourceDetail,
        preferredContactMethod,
        programInterest:
          interest.selection.key,
        assignedTo,
        message: note,
      },
      { createdBy: req.user._id, stage: "new" }
    );

    opportunity.estimatedValue = Math.max(Number(estimatedValue) || 0, 0);
    opportunity.leadPriority = leadPriority;
    opportunity.nextFollowUpAt = parsedFollowUp.value;
    opportunity.updatedBy = req.user._id;
    await opportunity.save();

    await logAudit(req, "Created CRM lead", "CrmContact", contact._id.toString(), contact.fullName);

    dispatchWorkflowEvent({
      type: "crm_lead_created",
      eventKey: `crm_lead_created:${contact._id}`,
      contactId: contact._id,
      opportunityId: opportunity._id,
      actorUserId: req.user._id,
      actorName: req.user.name,
      data: {
        source: contact.source,
        programInterest: contact.programInterest,
      },
    }).catch((error) => console.error("Workflow lead trigger failed:", error.message));

    res.status(201).json({ success: true, contact: contactDto(contact, opportunity) });
  } catch (err) {
    next(err);
  }
};

export const updateCrmContact = async (req, res, next) => {
  try {
    const contact = await CrmContact.findOne({ _id: req.params.id, isArchived: false });
    if (!contact) return res.status(404).json({ success: false, message: "CRM contact not found." });

    let interestSelection = null;

    if (req.body.programInterest !== undefined) {
      const interest =
        await resolveCrmInterestInput(
          req.body.programInterest,
          { defaultToNotSure: false }
        );

      if (interest.errorStatus) {
        return res.status(interest.errorStatus).json({
          success: false,
          message: interest.message,
        });
      }

      interestSelection = interest.selection;
    }

    if (
      req.body.preferredContactMethod !== undefined &&
      !CRM_PREFERRED_CONTACT_METHOD_VALUES.includes(
        req.body.preferredContactMethod
      )
    ) {
      return res.status(400).json({
        success: false,
        message: "Choose a valid preferred contact method.",
      });
    }

    const allowed = [
      "fullName",
      "email",
      "phone",
      "source",
      "sourceDetail",
      "preferredContactMethod",
      "assignedTo",
    ];

    for (const key of allowed) {
      if (req.body[key] !== undefined) {
        contact[key] =
          key === "source"
            ? normalizeCrmSource(req.body[key])
            : req.body[key];
      }
    }

    if (interestSelection) {
      applyCrmInterestSelection(
        contact,
        interestSelection
      );
    }

    contact.updatedBy = req.user._id;
    await contact.save();

    const opportunity =
      await ensureOpenOpportunity(
        contact,
        { createdBy: req.user._id }
      );

    if (req.body.assignedTo !== undefined) {
      opportunity.assignedTo =
        req.body.assignedTo || undefined;
    }

    if (interestSelection) {
      applyCrmInterestSelection(
        opportunity,
        interestSelection
      );
    }

    opportunity.updatedBy = req.user._id;
    await opportunity.save();

    await logAudit(req, "Updated CRM contact", "CrmContact", contact._id.toString(), contact.fullName);
    res.status(200).json({ success: true, contact: contactDto(contact, opportunity) });
  } catch (err) {
    next(err);
  }
};

export const updateCrmOpportunity = async (req, res, next) => {
  try {
    const opportunity = await CrmOpportunity.findById(req.params.id);
    if (!opportunity) return res.status(404).json({ success: false, message: "CRM opportunity not found." });

    const previousStage = opportunity.stage;
    const {
      stage,
      estimatedValue,
      leadPriority,
      nextFollowUpAt,
      assignedTo,
      lostReason,
      programInterest,
    } = req.body;
    const parsedFollowUp = parseCrmDate(nextFollowUpAt, "Next follow-up");
    if (parsedFollowUp.error) {
      return res.status(400).json({ success: false, message: parsedFollowUp.error });
    }

    if (stage !== undefined) {
      if (!CRM_STAGE_VALUES.includes(stage)) {
        return res.status(400).json({ success: false, message: "Invalid CRM stage." });
      }
      if (previousStage !== stage) {
        opportunity.stageEnteredAt = new Date();
      }

      opportunity.stage = stage;

      if (stage === "lost") {
        opportunity.status = "lost";
        opportunity.closedAt = new Date();
      } else if (opportunity.status === "lost") {
        opportunity.status = "open";
        opportunity.closedAt = undefined;
        opportunity.lostReason = "";
      }
    }
    if (stage === "lost" && previousStage !== "lost") {
      const normalizedLostReason = String(lostReason || "").trim();
      if (!normalizedLostReason) {
        return res.status(400).json({
          success: false,
          code: "lost_reason_required",
          message: "Add a lost reason before moving this lead to Lost.",
        });
      }
      opportunity.lostReason = normalizedLostReason;
    }

    if (estimatedValue !== undefined) {
      opportunity.estimatedValue =
        Math.max(Number(estimatedValue) || 0, 0);
    }

    if (leadPriority !== undefined) {
      if (!CRM_LEAD_PRIORITY_VALUES.includes(leadPriority)) {
        return res.status(400).json({
          success: false,
          message: "Choose a valid lead priority.",
        });
      }

      opportunity.leadPriority = leadPriority;
    }

    if (parsedFollowUp.provided) opportunity.nextFollowUpAt = parsedFollowUp.value;
    if (assignedTo !== undefined) opportunity.assignedTo = assignedTo || undefined;
    if (lostReason !== undefined) opportunity.lostReason = String(lostReason || "").trim();
    let interestSelection = null;

    if (programInterest !== undefined) {
      const interest =
        await resolveCrmInterestInput(
          programInterest,
          { defaultToNotSure: false }
        );

      if (interest.errorStatus) {
        return res.status(interest.errorStatus).json({
          success: false,
          message: interest.message,
        });
      }

      interestSelection = interest.selection;

      applyCrmInterestSelection(
        opportunity,
        interestSelection
      );
    }

    if (REQUIRED_FIELDS_BY_STAGE[opportunity.stage]) {
      const contactForValidation = await CrmContact.findById(opportunity.contact);
      if (!contactForValidation) {
        return res.status(404).json({ success: false, message: "CRM contact not found." });
      }

      const missingFields = missingRequiredFieldsForStage(
        opportunity.stage,
        contactForValidation,
        opportunity
      );

      if (missingFields.length) {
        return res.status(400).json({
          success: false,
          code: "required_fields_by_stage",
          message: `Complete the required fields before moving this lead to ${opportunity.stage.replaceAll("_", " ")}: ${missingFields.join(", ")}.`,
          stage: opportunity.stage,
          missingFields,
        });
      }
    }

    opportunity.updatedBy = req.user._id;
    await opportunity.save();

    const contact = await CrmContact.findById(opportunity.contact);
    if (contact) {
      if (assignedTo !== undefined) {
        contact.assignedTo =
          assignedTo || undefined;
      }

      if (interestSelection) {
        applyCrmInterestSelection(
          contact,
          interestSelection
        );
      }

      contact.updatedBy = req.user._id;
      contact.lastActivityAt = new Date();
      await contact.save();
    }

    if (stage !== undefined && previousStage !== stage) {
      await addCrmActivity({
        contact: opportunity.contact,
        opportunity,
        type: "stage_change",
        subject: "Pipeline stage changed",
        body: `Stage moved from ${previousStage} to ${stage}.`,
        createdBy: req.user._id,
        metadata: { from: previousStage, to: stage },
      });
      await logAudit(req, "Moved CRM opportunity", "CrmOpportunity", opportunity._id.toString(), `${previousStage} → ${stage}`);
      if (stage === "lost") {
        await addCrmActivity({
          contact: opportunity.contact,
          opportunity,
          type: "task",
          subject: "Review lost lead",
          body: `Review why ${contact?.fullName || "this lead"} was lost and record the next follow-up action if appropriate.`,
          dueAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
          assignedTo: opportunity.assignedTo || contact?.assignedTo,
          createdBy: req.user._id,
          metadata: {
            event: "lost_reason_follow_up",
            fromStage: previousStage,
            toStage: "lost",
          },
        });
      }
      dispatchWorkflowEvent({
        type: "crm_stage_changed",
        eventKey: `crm_stage_changed:${opportunity._id}:${opportunity.updatedAt?.getTime?.() || Date.now()}`,
        contactId: opportunity.contact,
        opportunityId: opportunity._id,
        actorUserId: req.user._id,
        actorName: req.user.name,
        data: {
          fromStage: previousStage,
          toStage: stage,
          programInterest: opportunity.programInterest,
        },
      }).catch((error) => console.error("Workflow stage trigger failed:", error.message));
    }

    await opportunity.populate("assignedTo", "name roles");
    res.status(200).json({ success: true, opportunity });
  } catch (err) {
    next(err);
  }
};

export const addCrmContactActivity = async (req, res, next) => {
  try {
    const contact = await CrmContact.findOne({ _id: req.params.id, isArchived: false });
    if (!contact) return res.status(404).json({ success: false, message: "CRM contact not found." });

    const { type = "note", subject, body, dueAt, assignedTo } = req.body;
    if (!validActivityTypes.includes(type)) {
      return res.status(400).json({ success: false, message: "Invalid CRM activity type." });
    }
    if (!body || !String(body).trim()) {
      return res.status(400).json({ success: false, message: "Activity details are required." });
    }

    const parsedDueAt = parseCrmDate(dueAt, "Task due date");
    if (parsedDueAt.error) {
      return res.status(400).json({ success: false, message: parsedDueAt.error });
    }

    const opportunity = await ensureOpenOpportunity(contact, { createdBy: req.user._id });
    const activity = await addCrmActivity({
      contact,
      opportunity,
      type,
      subject,
      body: String(body).trim(),
      dueAt: parsedDueAt.value,
      assignedTo: assignedTo || contact.assignedTo,
      createdBy: req.user._id,
    });

    await logAudit(req, "Added CRM activity", "CrmContact", contact._id.toString(), `${type}: ${subject || body}`.slice(0, 500));
    res.status(201).json({ success: true, activity });
  } catch (err) {
    next(err);
  }
};

export const completeCrmActivity = async (req, res, next) => {
  try {
    const activity = await CrmActivity.findById(req.params.id);
    if (!activity) return res.status(404).json({ success: false, message: "CRM activity not found." });
    if (activity.type !== "task") return res.status(409).json({ success: false, message: "Only CRM tasks can be completed." });

    activity.completedAt = activity.completedAt ? undefined : new Date();
    await activity.save();
    await logAudit(req, activity.completedAt ? "Completed CRM task" : "Reopened CRM task", "CrmActivity", activity._id.toString(), activity.subject || activity.body);

    res.status(200).json({ success: true, activity });
  } catch (err) {
    next(err);
  }
};

export const convertCrmContactToApplication = async (req, res, next) => {
  try {
    const contact = await CrmContact.findOne({ _id: req.params.id, isArchived: false });
    if (!contact) return res.status(404).json({ success: false, message: "CRM contact not found." });

    if (contact.application) {
      const existing = await Application.findById(contact.application);
      if (existing) {
        return res.status(200).json({ success: true, application: existing, alreadyExists: true });
      }
    }

    if (!contact.email || !contact.phone) {
      return res.status(409).json({
        success: false,
        message: "Email and phone are required before moving a CRM lead into Requests.",
      });
    }

    const existingByEmail = await Application.findOne({ email: contact.email }).sort({ createdAt: -1 });
    if (existingByEmail) {
      contact.application = existingByEmail._id;
      contact.lifecycleStage = "applicant";
      contact.updatedBy = req.user._id;
      await contact.save();
      await syncApplicationToCrm(existingByEmail, { userId: req.user._id, userName: req.user.name });
      await copyCustomFieldValues({ fromType: "crm_contact", fromId: contact._id, toType: "application", toId: existingByEmail._id, userId: req.user._id });
      return res.status(200).json({ success: true, application: existingByEmail, alreadyExists: true });
    }

    const opportunity = await ensureOpenOpportunity(
      contact,
      {
        createdBy: req.user._id,
        reopen: true,
        stage: "qualification",
      }
    );

    if (["new", "nurture"].includes(opportunity.stage)) {
      opportunity.stage = "qualification";
      opportunity.stageEnteredAt = new Date();
      opportunity.updatedBy = req.user._id;
      await opportunity.save();
    }

    const applicationInterest =
      await resolveCrmInterestInput(
        opportunity.programInterest ||
          contact.programInterest ||
          "not_sure",
        { defaultToNotSure: true }
      );

    if (applicationInterest.errorStatus) {
      return res.status(
        applicationInterest.errorStatus
      ).json({
        success: false,
        message: applicationInterest.message,
      });
    }

    const application = await Application.create({
      fullName: contact.fullName,
      email: contact.email,
      phone: contact.phone,
      programInterest:
        applicationInterest.selection.key,
      ...(applicationInterest.selection.offering
        ? {
            programInterestOffering:
              applicationInterest.selection
                .offering._id,
          }
        : {}),
      status: "pending",
      source: "crm",
      submittedBy: req.user._id,
      timeline: {
        applied: { at: new Date(), by: req.user.name, method: "crm" },
      },
    });

    await syncApplicationToCrm(application, { userId: req.user._id, userName: req.user.name });
    await copyCustomFieldValues({ fromType: "crm_contact", fromId: contact._id, toType: "application", toId: application._id, userId: req.user._id });
    await logAudit(req, "Moved CRM lead to Requests", "Application", application._id.toString(), contact.fullName);

    res.status(201).json({ success: true, application, alreadyExists: false });
  } catch (err) {
    next(err);
  }
};

export const archiveCrmContact = async (req, res, next) => {
  try {
    const contact = await CrmContact.findOne({ _id: req.params.id, isArchived: false });
    if (!contact) return res.status(404).json({ success: false, message: "CRM contact not found." });

    contact.isArchived = true;
    contact.archivedAt = new Date();
    contact.updatedBy = req.user._id;
    await contact.save();

    await CrmOpportunity.updateMany({ contact: contact._id, status: "open" }, { status: "lost", stage: "lost", closedAt: new Date(), updatedBy: req.user._id });
    await logAudit(req, "Archived CRM contact", "CrmContact", contact._id.toString(), contact.fullName);

    res.status(200).json({ success: true, message: "CRM contact archived." });
  } catch (err) {
    next(err);
  }
};

export const submitPublicCrmLead = async (req, res, next) => {
  try {
    const { name, fullName, email, phone, message, programInterest = "not_sure" } = req.body;
    const resolvedName = String(fullName || name || "").trim();
    const resolvedEmail = String(email || "").trim().toLowerCase();

    if (!resolvedName || !resolvedEmail || !message || !String(message).trim()) {
      return res.status(400).json({ success: false, message: "Name, email, and message are required." });
    }

    const normalizedProgramInterest =
      normalizeProgramInterestKey(
        programInterest,
        { defaultToNotSure: true }
      ) || "not_sure";

    await upsertCrmLead(
      {
        fullName: resolvedName,
        email: resolvedEmail,
        phone,
        source: "website_contact",
        programInterest:
          normalizedProgramInterest,
        message: String(message).trim(),
      },
      { stage: "new" }
    );

    res.status(201).json({
      success: true,
      message: "Thank you. Your message has been received and our team will follow up.",
    });
  } catch (err) {
    next(err);
  }
};


export const mergeCrmContacts = async (req, res, next) => {
  try {
    const primaryId = String(req.params.id || "").trim();
    const duplicateId = String(req.body?.duplicateId || "").trim();

    if (!primaryId || !duplicateId || primaryId === duplicateId) {
      return res.status(400).json({
        success: false,
        message: "Provide the primary contact and a different duplicate contact to merge.",
      });
    }

    const [primary, duplicate] = await Promise.all([
      CrmContact.findOne({ _id: primaryId, isArchived: false }),
      CrmContact.findOne({ _id: duplicateId }),
    ]);

    if (!primary) {
      return res.status(404).json({ success: false, message: "Primary contact not found." });
    }
    if (!duplicate) {
      return res.status(404).json({ success: false, message: "Duplicate contact not found." });
    }

    // Fill empty primary fields from duplicate.
    const emptyFields = ["fullName", "email", "phone", "source", "sourceDetail", "preferredContactMethod", "programInterest", "programInterestOffering"];
    const mergedValues = {};
    for (const field of emptyFields) {
      if (!primary[field] && duplicate[field] !== undefined && duplicate[field] !== null && duplicate[field] !== "") {
        primary[field] = duplicate[field];
        mergedValues[field] = duplicate[field];
      }
    }

    // Merge tags.
    primary.tags = [...new Set([...(primary.tags || []), ...(duplicate.tags || [])])];

    // Merge external identities.
    const identities = new Map();
    for (const identity of primary.externalIdentities || []) {
      identities.set(`${identity.provider}:${identity.externalId}`, identity);
    }
    for (const identity of duplicate.externalIdentities || []) {
      identities.set(`${identity.provider}:${identity.externalId}`, identity);
    }
    primary.externalIdentities = [...identities.values()];

    // Keep the earlier inbound timestamps.
    const inboundFields = ["lastInboundInstagramAt", "lastInboundWhatsAppAt"];
    for (const field of inboundFields) {
      if (!primary[field] && duplicate[field]) primary[field] = duplicate[field];
    }

    // Keep the stronger lifecycle stage.
    const lifecycleRank = { lead: 0, applicant: 1, client: 2, former_client: 1 };
    if ((lifecycleRank[duplicate.lifecycleStage] || 0) > (lifecycleRank[primary.lifecycleStage] || 0)) {
      primary.lifecycleStage = duplicate.lifecycleStage;
    }

    if (!primary.application && duplicate.application) primary.application = duplicate.application;
    if (!primary.client && duplicate.client) primary.client = duplicate.client;

    primary.updatedBy = req.user._id;
    primary.lastActivityAt = primary.lastActivityAt || duplicate.lastActivityAt || new Date();
    await primary.save();

    // Move duplicate records to primary.
    await CrmActivity.updateMany({ contact: duplicate._id }, { $set: { contact: primary._id } });
    await CrmOpportunity.updateMany({ contact: duplicate._id }, { $set: { contact: primary._id } });

    // Archive duplicate.
    duplicate.isArchived = true;
    duplicate.archivedAt = new Date();
    duplicate.updatedBy = req.user._id;
    duplicate.lifecycleStage = duplicate.lifecycleStage || "lead";
    await duplicate.save();

    await logAudit(
      req,
      "Merged CRM contacts",
      "CrmContact",
      primary._id.toString(),
      `${duplicate.fullName} merged into ${primary.fullName}`
    );

    const opportunity = await CrmOpportunity.findOne({ contact: primary._id, status: "open" }).sort({ updatedAt: -1 });

    res.status(200).json({
      success: true,
      contact: primary,
      opportunity,
      duplicateId: duplicate._id,
      mergedValues,
    });
  } catch (err) {
    next(err);
  }
};

