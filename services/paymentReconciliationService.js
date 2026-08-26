import Payment from "../models/Payment.js";
import BusinessSettings from "../models/BusinessSettings.js";
import CrmContact from "../models/CrmContact.js";
import CrmOpportunity from "../models/CrmOpportunity.js";
import CrmActivity from "../models/CrmActivity.js";
import { verifyTransaction } from "../utils/paystack.js";
import { persistVerifiedPaymentStatus } from "../controllers/paymentActivationController.js";
import { addCrmActivity } from "./crmService.js";
import { isEmailConfigured, sendEmail } from "../utils/mailer.js";

const STALE_AFTER_MS = 20 * 60 * 1000;

async function createProblemFollowUp(payment, status, { emailEnabled = true } = {}) {
  const contactSelectors = [
    ...(payment.client ? [{ client: payment.client }] : []),
    ...(payment.application ? [{ application: payment.application }] : []),
  ];

  if (!contactSelectors.length) return;

  const contact = await CrmContact.findOne({
    isArchived: false,
    $or: contactSelectors,
  });

  if (!contact) return;

  const opportunity = await CrmOpportunity.findOne({
    contact: contact._id,
    stage: "payment_pending",
    status: "open",
  }).sort({ updatedAt: -1 });

  if (!opportunity) return;

  const eventKey = `payment_problem:${payment.reference}:${status}`;
  const duplicate = await CrmActivity.exists({
    contact: contact._id,
    "metadata.eventKey": eventKey,
  });
  if (duplicate) return;

  await addCrmActivity({
    contact,
    opportunity,
    type: "system",
    subject: "Payment needs attention",
    body: `Paystack transaction ${payment.reference} was verified as ${status}.`,
    metadata: {
      event: "payment_terminal_status",
      eventKey,
      paymentId: String(payment._id),
      reference: payment.reference,
      status,
    },
  });

  await addCrmActivity({
    contact,
    opportunity,
    type: "task",
    subject: "Follow up payment",
    body: `Follow up with ${contact.fullName} after the ${status} payment attempt and send a fresh payment link if appropriate.`,
    dueAt: new Date(),
    assignedTo: opportunity.assignedTo || contact.assignedTo,
    metadata: {
      event: "payment_problem_follow_up",
      eventKey,
      paymentId: String(payment._id),
      reference: payment.reference,
      status,
    },
  });

  if (contact.email && emailEnabled && isEmailConfigured()) {
    const emailEventKey = `payment_problem_email:${payment.reference}:${status}`;
    const alreadyEmailed = await CrmActivity.exists({
      contact: contact._id,
      "metadata.event": "payment_problem_email",
      "metadata.emailEventKey": emailEventKey,
    });

    if (!alreadyEmailed) {
      try {
        const heading =
          status === "failed"
            ? "Your payment did not go through"
            : "Your payment is incomplete";

        const nextStep =
          status === "failed"
            ? "Try again using the same payment link, or contact us if you would prefer a bank transfer."
            : "Complete your payment using the link provided, or contact us if you need help.";

        await sendEmail({
          to: contact.email,
          subject: `Your Khairo Diet Clinic payment needs attention`,
          text: `Hi ${contact.fullName},

${heading}. ${nextStep}

We're here if you have any questions.

- Khairo Diet Clinic`,
          html: `<p>Hi ${contact.fullName},</p><p><strong>${heading}.</strong> ${nextStep}</p><p>We're here if you have any questions.</p><p>- Khairo Diet Clinic</p>`,
        });

        await addCrmActivity({
          contact,
          opportunity,
          type: "email",
          subject: "Payment problem email sent",
          body: `${status} payment follow-up email sent to ${contact.email}.`,
          createdBy: null,
          metadata: {
            event: "payment_problem_email",
            emailEventKey,
            paymentId: String(payment._id),
            reference: payment.reference,
            status,
          },
        });
      } catch (error) {
        console.error(
          `Payment follow-up email failed for ${payment.reference}:`,
          error?.message || error
        );
      }
    }
  }
}

export async function reconcileStalePayments() {
  if (!process.env.PAYSTACK_SECRET_KEY) {
    return { skipped: true, reason: "paystack_not_configured" };
  }

  const settings = await BusinessSettings.findOne({ key: "business" });
  const delayHours = Number(settings?.growth?.abandonedRecoveryDelayHours) || 24;
  const staleBefore = new Date(Date.now() - delayHours * 60 * 60 * 1000);
  const recoveryEnabled = settings?.growth?.abandonedPaymentRecoveryEnabled === true;
  const emailEnabled = settings?.growth?.abandonedRecoveryEmailEnabled !== false;
  const payments = await Payment.find({
    status: "pending",
    createdAt: { $lte: staleBefore },
    reference: { $not: /^MANUAL-/ },
  })
    .sort({ createdAt: 1 })
    .limit(50);

  const result = {
    scanned: payments.length,
    success: 0,
    failed: 0,
    abandoned: 0,
    pending: 0,
    errors: 0,
  };

  for (const payment of payments) {
    try {
      const response = await verifyTransaction(payment.reference);
      const status = await persistVerifiedPaymentStatus(payment, response?.data || {});

      if (status === "success") result.success += 1;
      else if (status === "failed") {
        result.failed += 1;
        if (recoveryEnabled) await createProblemFollowUp(payment, status, { emailEnabled });
      } else if (status === "abandoned") {
        result.abandoned += 1;
        if (recoveryEnabled) await createProblemFollowUp(payment, status, { emailEnabled });
      } else {
        result.pending += 1;
      }
    } catch (error) {
      result.errors += 1;
      console.error("Paystack stale payment verification failed:", payment.reference, error?.message || error);
    }
  }

  return result;
}
