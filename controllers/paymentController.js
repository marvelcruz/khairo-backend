import crypto from "crypto";
import Client from "../models/Client.js";
import Application from "../models/Application.js";
import Subscription from "../models/Subscription.js";
import Payment from "../models/Payment.js";
import PromoCode from "../models/PromoCode.js";
import GiftCard from "../models/GiftCard.js";
import { initializeTransaction, verifyTransaction } from "../utils/paystack.js";
import { generatePaymentReference, generateReceiptNumber } from "../utils/generateReference.js";
import { CYCLE_DAYS } from "../config/plans.js";
import Pricing from "../models/Pricing.js";
import { createOrderIfNeeded } from "./orderController.js";
import AuditLog from "../models/AuditLog.js";
import { logAudit } from "../utils/auditLogger.js";
import { sendEmail } from "../utils/mailer.js";
import { syncClientToCrm } from "../services/crmService.js";
import { dispatchWorkflowEvent } from "../services/workflowService.js";
import {
  getLegacyCycleWeeks,
  isLegacyProgramKey,
  normalizeLegacyProgramKey,
  resolveLegacyProgramOffering,
} from "../utils/programOfferingResolver.js";

async function findEnrollmentApplicationForClient(client) {
  if (!client) return null;

  const criteria = [{ clientId: client._id }];

  if (client.fromApplication) {
    criteria.push({ _id: client.fromApplication });
  }

  if (client.email) {
    criteria.push({ email: client.email });
  }

  return Application.findOne({ $or: criteria }).sort({ createdAt: -1 });
}

function getProgramPrice(pricing, program) {
  return (
    pricing?.programs?.find((p) => p.key === program)?.price ||
    pricing?.[program] ||
    null
  );
}

// POST /api/payments/initialize
// Client-portal route: protected by protectClient, so req.client is always the
// logged-in client. We never trust a clientId from the request body here - that
// would let anyone pay (or trigger side effects) on someone else's account.
export const initializePayment = async (req, res, next) => {
  try {
    const client = req.client;
    const { purpose = "renewal", program, promoCode, giftCardCode } = req.body;
    
    // Allow client to pick a program before paying
    const selectedProgram =
      normalizeLegacyProgramKey(
        program || client.program
      );

    if (!isLegacyProgramKey(selectedProgram)) {
      return res.status(400).json({
        success: false,
        message:
          "This program is not yet supported by the current enrollment flow.",
      });
    }

    const offering = await resolveLegacyProgramOffering(selectedProgram);

    if (!offering) {
      return res.status(409).json({
        success: false,
        message:
          "This program is not linked to an active catalogue offering. Please contact an administrator.",
      });
    }

    const pricing = await Pricing.findOne();
    const chosenProgram = (pricing && pricing.programs ? pricing.programs : []).find((pr) => pr.key === selectedProgram);

    let clientChanged = false;

    if (
      program &&
      selectedProgram !== client.program
    ) {
      client.program = selectedProgram;
      client.cycleWeeks = getLegacyCycleWeeks(
        offering,
        selectedProgram
      );
      clientChanged = true;
    }

    if (
      !client.programOffering ||
      String(client.programOffering) !== String(offering._id)
    ) {
      client.programOffering = offering._id;
      clientChanged = true;
    }

    if (clientChanged) {
      await client.save();
    }

    const amount = chosenProgram ? chosenProgram.price : pricing ? pricing[selectedProgram] : null;
    if (!amount) {
      return res.status(400).json({
        success: false,
        message: `No price configured for program "${client.program}"`,
      });
    }

    const originalAmount = Number(amount) || 0;
    let finalAmount = originalAmount;
    let appliedPromoCode = "";

    if (promoCode) {
      const normalizedPromoCode = String(promoCode).trim().toUpperCase();
      const promo = await PromoCode.findOne({
        code: normalizedPromoCode,
        active: true,
      });

      if (!promo) {
        return res.status(400).json({ success: false, message: "This promo code is not valid." });
      }

      if (promo.expiresAt && new Date(promo.expiresAt).getTime() < Date.now()) {
        return res.status(400).json({ success: false, message: "This promo code has expired." });
      }

      if (promo.maxUses > 0 && promo.currentUses >= promo.maxUses) {
        return res.status(400).json({ success: false, message: "This promo code has reached its usage limit." });
      }

      if (promo.discountType === "percentage") {
        finalAmount = Math.max(0, originalAmount * (1 - promo.discountValue / 100));
      } else {
        finalAmount = Math.max(0, originalAmount - promo.discountValue);
      }

      if (finalAmount <= 0) {
        return res.status(400).json({ success: false, message: "This promo code reduces the total to zero. Please use a different code." });
      }

      appliedPromoCode = normalizedPromoCode;
    }

    // Apply gift card after promo, if supplied.
    let appliedGiftCardCode = "";
    let appliedGiftCardAmount = 0;

    if (giftCardCode) {
      const normalizedGiftCode = String(giftCardCode).trim().toUpperCase();
      const giftCard = await GiftCard.findOne({
        code: normalizedGiftCode,
        active: true,
      });

      if (!giftCard) {
        return res.status(400).json({ success: false, message: "This gift card is not valid." });
      }

      if (giftCard.expiresAt && new Date(giftCard.expiresAt).getTime() < Date.now()) {
        return res.status(400).json({ success: false, message: "This gift card has expired." });
      }

      if (giftCard.balance <= 0) {
        return res.status(400).json({ success: false, message: "This gift card has no remaining balance." });
      }

      const remainingAfterGift = Math.max(0, finalAmount - giftCard.balance);
      appliedGiftCardAmount = finalAmount - remainingAfterGift;
      finalAmount = remainingAfterGift;
      appliedGiftCardCode = normalizedGiftCode;

      if (finalAmount <= 0) {
        return res.status(400).json({
          success: false,
          message: "This gift card covers the full amount. Please contact KhairoDietClinic to redeem it manually.",
        });
      }
    }

    const reference = generatePaymentReference();

    const payment = await Payment.create({
      receiptNumber: await generateReceiptNumber(Payment),
      client: client._id,
      purpose,
      amount: finalAmount,
      originalAmount,
      promoCode: appliedPromoCode,
      giftCardCode: appliedGiftCardCode,
      giftCardAmount: appliedGiftCardAmount,
      reference,
      status: "pending",
    });

    const paystackRes = await initializeTransaction({
      email: client.email,
      amountKobo: finalAmount * 100,
      reference,
      callback_url: process.env.PAYSTACK_CALLBACK_URL,
      metadata: { clientId: client._id.toString(), paymentId: payment._id.toString(), purpose },
    });

    if (!paystackRes.status) {
      payment.status = "failed";
      await payment.save();
      return res.status(502).json({ success: false, message: paystackRes.message || "Could not start payment" });
    }

    res.status(200).json({ success: true, authorizationUrl: paystackRes.data.authorization_url, reference });
  } catch (err) {
    next(err);
  }
};

// Shared + idempotent: called from both the webhook and the verify fallback.
// Safe to call twice for the same payment - won't double-activate.
async function activateSubscriptionForClient(
  payment,
  client,
  {
    paystackData = {},
    staffId = null,
    userName = "System",
    auditAction = "Subscription activated via payment",
  } = {}
) {
  const offering = await resolveLegacyProgramOffering(
    client.program
  );

  if (!offering) {
    throw new Error(
      `No active catalogue offering is linked to program "${client.program}".`
    );
  }

  if (
    !client.programOffering ||
    String(client.programOffering) !== String(offering._id)
  ) {
    client.programOffering = offering._id;
    client.cycleWeeks = getLegacyCycleWeeks(
      offering,
      client.program
    );
    await client.save();
  }

  const pricing = await Pricing.findOne();

  const programAmount =
    pricing?.programs?.find((p) => p.key === client.program)?.price ||
    pricing?.[client.program] ||
    payment.amount;

  const now = new Date();
  const periodEnd = new Date(
    now.getTime() + CYCLE_DAYS * 24 * 60 * 60 * 1000
  );

  let subscription = await Subscription.findOne({
    client: client._id,
    status: { $in: ["pending", "active", "grace_period", "paused"] },
  });

  if (!subscription) {
    subscription = new Subscription({
      client: client._id,
      program: client.program,
      offering: offering._id,
      amount: programAmount,
    });
  }

  subscription.program = client.program;
  subscription.offering = offering._id;
  subscription.amount = programAmount;
  subscription.currentPeriodStart = now;
  subscription.currentPeriodEnd = periodEnd;
  subscription.status = "active";
  subscription.lastPaymentAt = now;
  subscription.renewalRemindersSent = {
    day27: false,
    day29: false,
  };

  if (staffId) {
    subscription.createdBy = staffId;
  }

  if (paystackData?.customer?.customer_code) {
    subscription.paystackCustomerCode =
      paystackData.customer.customer_code;
  }

  if (paystackData?.authorization?.authorization_code) {
    subscription.paystackAuthorizationCode =
      paystackData.authorization.authorization_code;
  }

  await subscription.save();

  payment.subscription = subscription._id;
  await payment.save();

  client.status = "active";
  client.reconciled = true;
  client.portalActive = true;

  const previousStage =
    client.accountStage;

  const previousProgramEnd =
    client.programEndsAt
      ? new Date(client.programEndsAt)
      : null;

  const startNewJourney =
    !client.programStartedAt ||
    !previousProgramEnd ||
    previousProgramEnd.getTime() <= now.getTime() ||
    previousStage === "preview" ||
    previousStage === "completed";

  if (startNewJourney) {
    const journeyWeeks =
      Math.max(
        1,
        Number(client.cycleWeeks) ||
          (client.program === "core" ? 8 : 12)
      );

    client.programStartedAt = now;
    client.startDate = now;

    client.programEndsAt =
      new Date(
        now.getTime() +
          journeyWeeks *
            7 *
            24 *
            60 *
            60 *
            1000
      );
  }

  client.accountStage = "active";

  await client.save();

  await Application.updateMany(
    {
      email: client.email,
      status: { $in: ["pending", "contacted"] },
    },
    { status: "approved" }
  );

  const auditRecord = {
    userName,
    action: auditAction,
    entityType: "Client",
    entityId: client._id.toString(),
    details: `${client.program} program, ₦${Number(programAmount).toLocaleString()}`,
  };

  if (staffId) auditRecord.user = staffId;

  await AuditLog.create(auditRecord);

  await createOrderIfNeeded({
    client,
    subscription,
    staffId: staffId || undefined,
  });

  const enrollmentApplication =
    await findEnrollmentApplicationForClient(client);

  syncClientToCrm(client, enrollmentApplication, {
    userId: staffId || undefined,
    userName,
  })
    .then(({ contact, opportunity }) =>
      dispatchWorkflowEvent({
        type: "client_activated",
        eventKey: `client_activated:${client._id}`,
        clientId: client._id,
        applicationId: enrollmentApplication?._id,
        contactId: contact?._id,
        opportunityId: opportunity?._id,
        actorUserId: staffId || undefined,
        actorName: userName,
        data: {
          clientName: client.fullName,
          programInterest: client.program || contact?.programInterest || "not_sure",
        },
      })
    )
    .catch((error) => {
      console.error("CRM/client workflow sync failed:", error.message);
    });

  return subscription;
}

async function activateFromPayment(payment, paystackData) {
  const wasSuccessful = payment.status === "success";

  if (!wasSuccessful) {
    payment.status = "success";
    payment.paidAt = new Date();
    payment.channel = paystackData?.channel || payment.channel;
    payment.authorizationCode =
      paystackData?.authorization?.authorization_code ||
      payment.authorizationCode;
    payment.cardLast4 =
      paystackData?.authorization?.last4 || payment.cardLast4;
    payment.bank =
      paystackData?.authorization?.bank || payment.bank;
    payment.rawWebhookEvent = paystackData;
    await payment.save();
  }

  const client = payment.client
    ? await Client.findById(payment.client)
    : null;

  let app = payment.application
    ? await Application.findById(payment.application)
    : null;

  if (!app && client) {
    app = await findEnrollmentApplicationForClient(client);
  }

  if (
    app &&
    ["consultation", "combined"].includes(payment.purpose)
  ) {
    app.consultationPaid = true;
    app.timeline = app.timeline || {};

    app.timeline.consultationPaid = {
      at: payment.paidAt || new Date(),
      by:
        payment.purpose === "combined"
          ? "Paystack (combined)"
          : "Paystack",
      amount: payment.amount,
    };

    await app.save();
  }

  if (payment.purpose === "consultation") {
    return payment;
  }

  if (!client) {
    return payment;
  }

  if (app && !client.reconciled) {
    if (!wasSuccessful) {
      await AuditLog.create({
        userName: "Paystack Payment",
        action: "Program payment received",
        entityType: "Client",
        entityId: client._id.toString(),
        details: JSON.stringify({
          amount: payment.amount,
          purpose: payment.purpose,
          reference: payment.reference,
        }),
      });
    }

    return payment;
  }

  if (payment.subscription) {
    return payment;
  }

  await activateSubscriptionForClient(payment, client, {
    paystackData,
    userName: paystackData?.channel
      ? "Paystack Payment"
      : "System",
    auditAction: "Subscription activated via payment",
  });

  return payment;
}

// POST /api/payments/webhook/paystack  -- source of truth, never trust the browser here
export const handlePaystackWebhook = async (req, res) => {
  try {
    const signature = req.headers["x-paystack-signature"];
    const hash = crypto.createHmac("sha512", process.env.PAYSTACK_SECRET_KEY).update(req.rawBody).digest("hex");

    if (hash !== signature) {
      return res.status(401).json({ success: false, message: "Invalid signature" });
    }

    const event = req.body;

    if (event.event === "charge.success") {
      const payment = await Payment.findOne({ reference: event.data.reference });
      if (payment) await activateFromPayment(payment, event.data);
    }

    res.sendStatus(200); // ack fast so Paystack doesn't retry
  } catch (err) {
    console.error("Paystack webhook error:", err);
    res.sendStatus(200); // still ack; log for manual follow-up
  }
};

// GET /api/payments/verify/:reference  -- frontend calls this right after redirect back
export const verifyPayment = async (req, res, next) => {
  try {
    const payment = await Payment.findOne({ reference: req.params.reference });
    if (!payment) return res.status(404).json({ success: false, message: "Payment not found" });

    if (payment.status === "success") {
      await activateFromPayment(payment, payment.rawWebhookEvent || {});
      return res.status(200).json({
        success: true,
        status: "success",
        payment,
      });
    }

    const paystackRes = await verifyTransaction(payment.reference);
    if (paystackRes.status && paystackRes.data.status === "success") {
      await activateFromPayment(payment, paystackRes.data);
      return res.status(200).json({ success: true, status: "success", payment });
    }

    res.status(200).json({ success: true, status: paystackRes.data?.status || "pending" });
  } catch (err) {
    next(err);
  }
};

async function getOrCreatePendingPaymentLink({
  client,
  amount,
  paymentPurpose,
  enrollmentApplication,
  initiatedBy,
  req,
}) {
  const existing = await Payment.findOne({
    client: client._id,
    purpose: paymentPurpose,
    amount,
    status: "pending",
    paymentLink: { $exists: true, $ne: "" },
  })
    .sort({ createdAt: -1 })
    .lean();

  if (existing) {
    return {
      payment: existing,
      authorizationUrl: existing.paymentLink,
      reference: existing.reference,
      alreadyExisted: true,
    };
  }

  const reference = generatePaymentReference();

  const payment = await Payment.create({
    receiptNumber: await generateReceiptNumber(Payment),
    client: client._id,
    application: enrollmentApplication?._id || undefined,
    purpose: paymentPurpose,
    amount,
    reference,
    status: "pending",
  });

  const paystackRes = await initializeTransaction({
    email: client.email,
    amountKobo: amount * 100,
    reference,
    callback_url: process.env.PAYSTACK_CALLBACK_URL,
    metadata: {
      clientId: client._id.toString(),
      applicationId: enrollmentApplication?._id?.toString(),
      paymentId: payment._id.toString(),
      purpose: paymentPurpose,
      initiatedBy,
    },
  });

  if (!paystackRes.status) {
    payment.status = "failed";
    payment.rawWebhookEvent = paystackRes;
    await payment.save();

    const error = new Error(
      paystackRes.message || "Could not generate payment link"
    );
    error.statusCode = 502;
    throw error;
  }

  payment.paymentLink = paystackRes.data.authorization_url;
  await payment.save();

  return {
    payment,
    authorizationUrl: paystackRes.data.authorization_url,
    reference,
    alreadyExisted: false,
  };
}

// POST /api/clients/:id/payment-link  -- staff-triggered
// Idempotent: reuses the latest active pending link for the same client/purpose/amount.
export const generateStaffPaymentLink = async (req, res, next) => {
  try {
    const client = await Client.findById(req.params.id);
    if (!client) return res.status(404).json({ success: false, message: "Client not found" });

    const pricing = await Pricing.findOne();
    const amount = getProgramPrice(pricing, client.program);
    if (!amount) {
      return res.status(400).json({
        success: false,
        message: `No price configured for program "${client.program}"`,
      });
    }

    const enrollmentApplication =
      await findEnrollmentApplicationForClient(client);

    const paymentPurpose =
      enrollmentApplication && !client.reconciled
        ? "program"
        : "renewal";

    const { authorizationUrl, reference, alreadyExisted } =
      await getOrCreatePendingPaymentLink({
        client,
        amount,
        paymentPurpose,
        enrollmentApplication,
        initiatedBy: "staff",
        req,
      });

    await logAudit(
      req,
      alreadyExisted ? "Reused existing payment link" : "Generated payment link",
      "Client",
      client._id,
      client.fullName
    );

    res.status(200).json({
      success: true,
      authorizationUrl,
      reference,
      reusedExisting: alreadyExisted,
    });
  } catch (err) {
    next(err);
  }
};

// @route GET /api/payments (staff only) - full payment ledger, newest first
export const listPayments = async (req, res, next) => {
  try {
    const { status, search, limit = 50 } = req.query;
    const safeLimit = Math.min(Number(limit) || 50, 200);

    const query = {};
    if (status) query.status = status;

    let payments = await Payment.find(query)
      .populate("client", "fullName email phone")
      .sort({ createdAt: -1 })
      .limit(safeLimit);

    if (search) {
      const term = search.toLowerCase();
      payments = payments.filter(
        (p) =>
          p.client?.fullName?.toLowerCase().includes(term) ||
          p.client?.email?.toLowerCase().includes(term) ||
          p.receiptNumber?.toLowerCase().includes(term) ||
          p.reference?.toLowerCase().includes(term)
      );
    }

    res.status(200).json({ success: true, payments });
  } catch (err) {
    next(err);
  }
};

// @route POST /api/clients/:id/manual-activate (staff only)
// body: { method: "cash" | "bank_transfer" | "other", note }
// For cash/bank-transfer payments taken outside Paystack, or activating a
// client before Paystack is fully live. Creates a real Payment record
// (marked manual) and runs the same activation as a successful Paystack
// charge, so nothing downstream (subscriptions, reports) has to know the
// difference.
export const manualActivateClient = async (req, res, next) => {
  try {
    const { method = "cash", note } = req.body;

    const client = await Client.findById(req.params.id);

    if (!client) {
      return res.status(404).json({
        success: false,
        message: "Client not found",
      });
    }

    const enrollmentApplication =
      await findEnrollmentApplicationForClient(client);

    if (enrollmentApplication && !client.reconciled) {
      return res.status(409).json({
        success: false,
        message:
          "Application enrollments must complete the Requests reconciliation workflow before activation.",
      });
    }

    const pricing = await Pricing.findOne();
    const amount = getProgramPrice(pricing, client.program);

    if (!amount) {
      return res.status(400).json({
        success: false,
        message: `No price configured for program "${client.program}"`,
      });
    }

    const reference = `MANUAL-${generatePaymentReference()}`;

    const payment = await Payment.create({
      receiptNumber: await generateReceiptNumber(Payment),
      client: client._id,
      purpose: "renewal",
      amount,
      reference,
      status: "success",
      channel: `manual_${method}`,
      paidAt: new Date(),
      rawWebhookEvent: {
        manualActivation: true,
        method,
        note,
        staffId: req.user._id.toString(),
      },
    });

    const subscription = await activateSubscriptionForClient(
      payment,
      client,
      {
        staffId: req.user._id,
        userName: req.user.name,
        auditAction: `Manually activated subscription via ${method}`,
      }
    );

    client.portalActive = true;
    await client.save();

    res.status(200).json({
      success: true,
      client,
      payment,
      subscription,
    });
  } catch (err) {
    next(err);
  }
};


// POST /api/clients/:id/email-payment-link -- staff triggers Paystack link + email
export const emailPaymentLink = async (req, res, next) => {
  try {
    const client = await Client.findById(req.params.id);
    if (!client) return res.status(404).json({ success: false, message: "Client not found" });
    if (!client.email) return res.status(400).json({ success: false, message: "Client has no email address." });

    const pricing = await Pricing.findOne();
    const amount = getProgramPrice(pricing, client.program);
    if (!amount) return res.status(400).json({ success: false, message: `No price configured for program "${client.program}"` });

    const enrollmentApplication =
      await findEnrollmentApplicationForClient(client);

    const paymentPurpose =
      enrollmentApplication && !client.reconciled
        ? "program"
        : "renewal";

    const { authorizationUrl: link, reference } =
      await getOrCreatePendingPaymentLink({
        client,
        amount,
        paymentPurpose,
        enrollmentApplication,
        initiatedBy: "staff_email",
        req,
      });
    const formattedAmount = amount.toLocaleString();

    const html = `<div style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;background:#0a0a0a;padding:32px;color:#f5f5f5;"><div style="max-width:520px;margin:0 auto;background:#171717;border:1px solid #262626;border-radius:8px;padding:32px;"><div style="display:flex;align-items:center;gap:10px;margin-bottom:24px;"><div style="width:36px;height:36px;background:#0d9488;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:700;color:white;">F</div><span style="font-weight:600;letter-spacing:-0.02em;">KHAIRO</span></div><p style="margin:0 0 16px;font-size:15px;">Hi ${client.fullName},</p><p style="margin:0 0 24px;font-size:15px;line-height:1.5;color:#d4d4d4;">Your ${client.program} program renewal is ready. Click below to complete your payment of <strong style="color:white;">₦${formattedAmount}</strong>.</p><div style="text-align:center;margin:32px 0;"><a href="${link}" style="display:inline-block;background:#0d9488;color:white;text-decoration:none;padding:14px 28px;border-radius:999px;font-weight:600;font-size:14px;">Pay now →</a></div><p style="margin:0 0 8px;font-size:13px;color:#a3a3a3;">If the button doesn't work, paste this link into your browser:</p><p style="margin:0;font-size:12px;color:#737373;word-break:break-all;">${link}</p><hr style="border:none;border-top:1px solid #262626;margin:28px 0;" /><p style="margin:0;font-size:11px;color:#737373;">This link is unique to you. Please don't share it.</p></div></div>`;

    await sendEmail({
      to: client.email,
      subject: `Your ${client.program} renewal — KhairoDietClinic`,
      html,
      text: `Hi ${client.fullName},\n\nYour ${client.program} program renewal is ready. Pay ₦${formattedAmount} here:\n${link}\n\n— KhairoDietClinic`,
    });

    await logAudit(req, "Emailed payment link", "Client", client._id, client.fullName);
    res.status(200).json({ success: true, authorizationUrl: link, reference });
  } catch (err) {
    next(err);
  }
};


// POST /api/clients/:id/reconcile -- staff confirms money received with exact amount
export const reconcilePayment = async (req, res, next) => {
  try {
    const {
      amountReceived,
      note,
      method = "bank_transfer",
    } = req.body;

    const received = Number(amountReceived);

    if (!received || received <= 0) {
      return res.status(400).json({
        success: false,
        message: "Enter the exact program amount received.",
      });
    }

    const client = await Client.findById(req.params.id);

    if (!client) {
      return res.status(404).json({
        success: false,
        message: "Client not found",
      });
    }

    const enrollmentApplication =
      await findEnrollmentApplicationForClient(client);

    if (enrollmentApplication) {
      const consultationDecision =
        enrollmentApplication.consultationDecision || "pending";

      if (consultationDecision === "pending") {
        return res.status(409).json({
          success: false,
          message:
            "Record the consultation decision before program reconciliation.",
        });
      }

      if (
        consultationDecision === "yes" &&
        !enrollmentApplication.consultationReconciled
      ) {
        return res.status(409).json({
          success: false,
          message:
            "Complete consultation reconciliation before program reconciliation.",
        });
      }
    }

    if (client.reconciled) {
      return res.status(409).json({
        success: false,
        message: "This person has already completed reconciliation.",
      });
    }

    if (client.programReconciliation?.status === "mismatch") {
      return res.status(409).json({
        success: false,
        message:
          "This mismatch requires Admin Check-in before Final Reconciliation.",
        requiresAdminReview: true,
      });
    }

    const pricing = await Pricing.findOne();

    const expected =
      pricing?.programs?.find((p) => p.key === client.program)?.price ||
      pricing?.[client.program];

    if (!expected) {
      return res.status(400).json({
        success: false,
        message: `No price configured for "${client.program}"`,
      });
    }

    const programPurposes = [
      "new_subscription",
      "renewal",
      "upgrade",
      "combined",
      "program",
    ];

    const paymentQuery = {
      client: client._id,
      status: "success",
      purpose: { $in: programPurposes },
    };

    if (enrollmentApplication) {
      paymentQuery.$or = [
        { application: enrollmentApplication._id },
        {
          application: null,
          createdAt: { $gte: enrollmentApplication.createdAt },
        },
      ];
    }

    let payment = await Payment.findOne(paymentQuery).sort({
      paidAt: -1,
      createdAt: -1,
    });

    if (!payment) {
      payment = await Payment.create({
        receiptNumber: await generateReceiptNumber(Payment),
        client: client._id,
        application: enrollmentApplication?._id || undefined,
        purpose: "program",
        amount: received,
        reference: "MANUAL-" + generatePaymentReference(),
        status: "success",
        channel: "reconciled_" + method,
        paidAt: new Date(),
      });
    }

    const effectivePaymentAmount =
      payment.purpose === "combined" && enrollmentApplication
        ? Math.max(
            0,
            Number(payment.amount) -
              Number(pricing?.consultationFee || 15000)
          )
        : Number(payment.amount);

    const ledgerMismatch = effectivePaymentAmount !== received;

    const matched =
      received === Number(expected) &&
      !ledgerMismatch;

    client.programReconciliation = {
      status: matched ? "matched" : "mismatch",
      amountReceived: received,
      expected: Number(expected),
      paymentId: payment._id,
      paymentAmount: effectivePaymentAmount,
      ledgerMismatch,
      method,
      note: note || "",
      at: new Date(),
      by: req.user._id,
      byName: req.user.name,
    };

    client.adminReconciliationReview = {
      completed: false,
    };

    client.finalReconciliation = {
      completed: false,
    };

    client.reconciled = false;
    await client.save();

    if (!matched) {
      await logAudit(
        req,
        "Program payment mismatch",
        "Client",
        client._id,
        JSON.stringify({
          amountReceived: received,
          expected: Number(expected),
          paymentAmount: effectivePaymentAmount,
          ledgerMismatch,
          matched: false,
          method,
          note: note || "",
        })
      );

      return res.status(200).json({
        success: true,
        matched: false,
        requiresAdminReview: true,
        ledgerMismatch,
        paymentAmount: effectivePaymentAmount,
        client,
        payment,
      });
    }

    await logAudit(
      req,
      "Reconciled payment",
      "Client",
      client._id,
      JSON.stringify({
        amountReceived: received,
        expected: Number(expected),
        paymentAmount: effectivePaymentAmount,
        ledgerMismatch,
        matched: true,
        method,
        note: note || "",
      })
    );

    const subscription = await activateSubscriptionForClient(
      payment,
      client,
      {
        staffId: req.user._id,
        userName: req.user.name,
        auditAction: "Enrollment finalized after reconciliation",
      }
    );

    res.status(200).json({
      success: true,
      matched: true,
      completed: true,
      client,
      payment,
      subscription,
    });
  } catch (err) {
    next(err);
  }
};

export const reviewPaymentMismatch = async (req, res, next) => {
  try {
    const note = String(req.body.note || "").trim();

    if (!note) {
      return res.status(400).json({
        success: false,
        message: "Admin Check-in requires a resolution note.",
      });
    }

    const client = await Client.findById(req.params.id);

    if (!client) {
      return res.status(404).json({
        success: false,
        message: "Client not found",
      });
    }

    if (client.reconciled) {
      return res.status(409).json({
        success: false,
        message: "This person has already completed reconciliation.",
      });
    }

    if (client.programReconciliation?.status !== "mismatch") {
      return res.status(409).json({
        success: false,
        message:
          "Admin Check-in is available only after a program payment mismatch.",
      });
    }

    client.adminReconciliationReview = {
      completed: true,
      note,
      at: new Date(),
      by: req.user._id,
      byName: req.user.name,
    };

    await client.save();

    await logAudit(
      req,
      "Admin reviewed payment mismatch",
      "Client",
      client._id,
      JSON.stringify({ note })
    );

    res.status(200).json({
      success: true,
      client,
    });
  } catch (err) {
    next(err);
  }
};

export const finalReconcilePayment = async (req, res, next) => {
  try {
    const note = String(req.body.note || "").trim();

    const client = await Client.findById(req.params.id);

    if (!client) {
      return res.status(404).json({
        success: false,
        message: "Client not found",
      });
    }

    const enrollmentApplication =
      await findEnrollmentApplicationForClient(client);

    if (enrollmentApplication) {
      const consultationDecision =
        enrollmentApplication.consultationDecision || "pending";

      if (consultationDecision === "pending") {
        return res.status(409).json({
          success: false,
          message:
            "Record the consultation decision before Final Reconciliation.",
        });
      }

      if (
        consultationDecision === "yes" &&
        !enrollmentApplication.consultationReconciled
      ) {
        return res.status(409).json({
          success: false,
          message:
            "Complete consultation reconciliation before Final Reconciliation.",
        });
      }
    }

    if (client.reconciled) {
      return res.status(409).json({
        success: false,
        message: "This person has already completed reconciliation.",
      });
    }

    if (client.programReconciliation?.status !== "mismatch") {
      return res.status(409).json({
        success: false,
        message:
          "Final Reconciliation is used only after a program payment mismatch.",
      });
    }

    if (!client.adminReconciliationReview?.completed) {
      return res.status(409).json({
        success: false,
        message:
          "Admin Check-in must be completed before Final Reconciliation.",
      });
    }

    let payment = null;

    if (client.programReconciliation?.paymentId) {
      payment = await Payment.findOne({
        _id: client.programReconciliation.paymentId,
        client: client._id,
        status: "success",
      });
    }

    if (!payment) {
      payment = await Payment.findOne({
        client: client._id,
        status: "success",
        purpose: {
          $in: [
            "new_subscription",
            "renewal",
            "upgrade",
            "combined",
            "program",
          ],
        },
      }).sort({
        paidAt: -1,
        createdAt: -1,
      });
    }

    if (!payment) {
      return res.status(409).json({
        success: false,
        message:
          "No successful program payment is available to finalize.",
      });
    }

    client.finalReconciliation = {
      completed: true,
      note,
      at: new Date(),
      by: req.user._id,
      byName: req.user.name,
    };

    await client.save();

    await logAudit(
      req,
      "Final reconciliation",
      "Client",
      client._id,
      JSON.stringify({
        note,
        originalMismatch: client.programReconciliation,
        adminReview: client.adminReconciliationReview,
      })
    );

    const subscription = await activateSubscriptionForClient(
      payment,
      client,
      {
        staffId: req.user._id,
        userName: req.user.name,
        auditAction:
          "Enrollment finalized after final reconciliation",
      }
    );

    res.status(200).json({
      success: true,
      completed: true,
      client,
      payment,
      subscription,
    });
  } catch (err) {
    next(err);
  }
};
