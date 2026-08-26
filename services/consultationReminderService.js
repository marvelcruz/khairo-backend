import CrmActivity from "../models/CrmActivity.js";
import CrmOpportunity from "../models/CrmOpportunity.js";
import { addCrmActivity } from "./crmService.js";
import { isEmailConfigured, sendEmail } from "../utils/mailer.js";

const HOUR = 60 * 60 * 1000;
const REMINDER_WINDOWS = [
  { key: "24h", minMs: 23 * HOUR, maxMs: 25 * HOUR, label: "tomorrow" },
  { key: "2h", minMs: 90 * 60 * 1000, maxMs: 150 * 60 * 1000, label: "in about 2 hours" },
];

function escapeHtml(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatDate(value) {
  const date = new Date(value);
  return date.toLocaleString("en-NG", {
    timeZone: process.env.CONSULTATION_TIMEZONE || "Africa/Lagos",
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

async function sendReminder({ opportunity, contact, window }) {
  const scheduledAt = new Date(opportunity.nextFollowUpAt);
  const reminderKey = `${opportunity._id}:${scheduledAt.toISOString()}:${window.key}`;

  const duplicate = await CrmActivity.exists({
    contact: contact._id,
    "metadata.event": "crm_consultation_reminder",
    "metadata.reminderKey": reminderKey,
  });
  if (duplicate) return { duplicate: true };

  const booking = await CrmActivity.findOne({
    contact: contact._id,
    opportunity: opportunity._id,
    "metadata.event": "crm_consultation_booking",
  })
    .sort({ createdAt: -1 })
    .lean();

  const location = String(booking?.metadata?.location || "").trim();
  const channel = String(booking?.metadata?.channel || "video").replaceAll("_", " ");
  const when = formatDate(scheduledAt);
  let delivery = "skipped";
  let error = "";

  if (contact.email && isEmailConfigured()) {
    try {
      await sendEmail({
        to: contact.email,
        subject: `KhairoDietClinic consultation reminder — ${when}`,
        text: `Hi ${contact.fullName},\n\nThis is a reminder that your KhairoDietClinic consultation is ${window.label}, on ${when}.\nFormat: ${channel}.${location ? `\nLocation/link: ${location}` : ""}\n\nIf you need to change the appointment, please contact the KhairoDietClinic team.`,
        html: `<p>Hi ${escapeHtml(contact.fullName)},</p><p>This is a reminder that your KhairoDietClinic consultation is <strong>${escapeHtml(window.label)}</strong>, on <strong>${escapeHtml(when)}</strong>.</p><p><strong>Format:</strong> ${escapeHtml(channel)}${location ? `<br><strong>Location/link:</strong> ${escapeHtml(location)}` : ""}</p><p>If you need to change the appointment, please contact the KhairoDietClinic team.</p>`,
      });
      delivery = "delivered";
    } catch (err) {
      delivery = "failed";
      error = err?.message || String(err);
    }
  } else {
    const existingTask = await CrmActivity.exists({
      contact: contact._id,
      type: "task",
      completedAt: { $exists: false },
      "metadata.event": "crm_consultation_manual_reminder",
      "metadata.reminderKey": reminderKey,
    });

    if (!existingTask) {
      await addCrmActivity({
        contact,
        opportunity,
        type: "task",
        subject: "Send consultation reminder",
        body: `Send ${contact.fullName} a consultation reminder for ${when}.`,
        dueAt: new Date(),
        assignedTo: opportunity.assignedTo || contact.assignedTo,
        metadata: {
          event: "crm_consultation_manual_reminder",
          reminderKey,
          scheduledAt,
        },
      });
    }
  }

  await addCrmActivity({
    contact,
    opportunity,
    type: "system",
    subject: "Consultation reminder processed",
    body: `Consultation reminder ${window.key} processed. Email: ${delivery}${error ? `. Error: ${error.slice(0, 300)}` : ""}.`,
    metadata: {
      event: "crm_consultation_reminder",
      reminderKey,
      scheduledAt,
      reminderWindow: window.key,
      emailDelivery: delivery,
    },
  });

  return { duplicate: false, delivery };
}

export async function runConsultationReminderScan() {
  const now = Date.now();
  const upper = new Date(now + 25 * HOUR);
  const lower = new Date(now + 90 * 60 * 1000);

  const opportunities = await CrmOpportunity.find({
    stage: "consultation_booked",
    status: "open",
    nextFollowUpAt: { $gte: lower, $lte: upper },
  })
    .populate("contact", "fullName email phone assignedTo isArchived")
    .limit(250);

  const result = { scanned: opportunities.length, delivered: 0, skipped: 0, failed: 0, duplicates: 0 };

  for (const opportunity of opportunities) {
    const contact = opportunity.contact;
    if (!contact || contact.isArchived || !opportunity.nextFollowUpAt) continue;

    const msUntil = new Date(opportunity.nextFollowUpAt).getTime() - now;
    const window = REMINDER_WINDOWS.find((item) => msUntil >= item.minMs && msUntil <= item.maxMs);
    if (!window) continue;

    const processed = await sendReminder({ opportunity, contact, window });
    if (processed.duplicate) result.duplicates += 1;
    else if (processed.delivery === "delivered") result.delivered += 1;
    else if (processed.delivery === "failed") result.failed += 1;
    else result.skipped += 1;
  }

  return result;
}
