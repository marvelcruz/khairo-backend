import CrmActivity from "../models/CrmActivity.js";
import { addCrmActivity } from "./crmService.js";
import { isEmailConfigured, sendEmail } from "../utils/mailer.js";

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function messageForDecision({ fullName, result, disposition }) {
  const firstName = String(fullName || "").trim().split(/\s+/)[0] || "there";
  const safeName = escapeHtml(firstName);

  if (result === "qualified") {
    return {
      key: "qualified",
      subject: "Your next KhairoDietClinic step",
      text:
        `Hi ${firstName},\n\nThanks for completing your KhairoDietClinic application. You are ready for the next step, and a KhairoDietClinic team member can help you move forward.\n\nWe look forward to speaking with you.\n\nKhairoDietClinic`,
      html:
        `<p>Hi ${safeName},</p><p>Thanks for completing your KhairoDietClinic application. You are ready for the next step, and a KhairoDietClinic team member can help you move forward.</p><p>We look forward to speaking with you.</p><p>KhairoDietClinic</p>`,
    };
  }

  if (result === "not_qualified" && disposition === "nurture") {
    return {
      key: "nurture",
      subject: "Your KhairoDietClinic application",
      text:
        `Hi ${firstName},\n\nThanks for completing your KhairoDietClinic application. It sounds like now may not be the right time to take the next step. That is completely fine — you can reconnect with KhairoDietClinic when you are ready.\n\nWe appreciate your interest.\n\nKhairoDietClinic`,
      html:
        `<p>Hi ${safeName},</p><p>Thanks for completing your KhairoDietClinic application. It sounds like now may not be the right time to take the next step. That is completely fine — you can reconnect with KhairoDietClinic when you are ready.</p><p>We appreciate your interest.</p><p>KhairoDietClinic</p>`,
    };
  }

  return null;
}

export async function sendQualificationOutcomeCommunication({
  application,
  contact,
  opportunity,
  result,
  disposition,
  actorUserId,
}) {
  const message = messageForDecision({
    fullName: application?.fullName,
    result,
    disposition,
  });

  if (!message) {
    return {
      status: "not_sent",
      reason: "policy",
    };
  }

  const applicationId = String(application?._id || "");
  const alreadySent = await CrmActivity.exists({
    contact: contact._id,
    type: "email",
    "metadata.event": "qualification_outcome_email",
    "metadata.applicationId": applicationId,
    "metadata.messageKey": message.key,
    "metadata.deliveryStatus": "sent",
  });

  if (alreadySent) {
    return {
      status: "duplicate",
      messageKey: message.key,
    };
  }

  if (!application?.email || !isEmailConfigured()) {
    return {
      status: "not_sent",
      reason: !application?.email ? "missing_email" : "email_not_configured",
      messageKey: message.key,
    };
  }

  try {
    await sendEmail({
      to: application.email,
      subject: message.subject,
      text: message.text,
      html: message.html,
    });

    await addCrmActivity({
      contact,
      opportunity,
      type: "email",
      subject: message.subject,
      body: message.text,
      createdBy: actorUserId,
      metadata: {
        event: "qualification_outcome_email",
        applicationId,
        messageKey: message.key,
        qualificationResult: result,
        qualificationDisposition: disposition,
        deliveryStatus: "sent",
      },
    });

    return {
      status: "sent",
      messageKey: message.key,
    };
  } catch (error) {
    await addCrmActivity({
      contact,
      opportunity,
      type: "system",
      subject: "Qualification email was not delivered",
      body: "The qualification decision was saved, but the transactional outcome email could not be delivered. Staff can follow up manually if needed.",
      createdBy: actorUserId,
      metadata: {
        event: "qualification_outcome_email",
        applicationId,
        messageKey: message.key,
        qualificationResult: result,
        qualificationDisposition: disposition,
        deliveryStatus: "failed",
        error: String(error?.message || error || "Email delivery failed.").slice(0, 500),
      },
    }).catch(() => {});

    return {
      status: "failed",
      messageKey: message.key,
      reason: String(error?.message || error || "Email delivery failed.").slice(0, 500),
    };
  }
}
