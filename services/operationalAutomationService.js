import Client from "../models/Client.js";
import CrmContact from "../models/CrmContact.js";
import CrmOpportunity from "../models/CrmOpportunity.js";
import CrmActivity from "../models/CrmActivity.js";
import BusinessSettings from "../models/BusinessSettings.js";
import User from "../models/User.js";
import { addCrmActivity } from "./crmService.js";
import { isEmailConfigured, sendEmail } from "../utils/mailer.js";

const DAY = 24 * 60 * 60 * 1000;
const MONTH = 30 * DAY;

function adminRecipientEmail() {
  return process.env.ADMIN_EMAIL || process.env.SEED_ADMIN_EMAIL || "";
}

async function dedupeActivityExists({ contactId, event, clientId, reference }) {
  return CrmActivity.exists({
    contact: contactId,
    "metadata.event": event,
    ...(clientId ? { "metadata.clientId": clientId } : {}),
    ...(reference ? { "metadata.reference": reference } : {}),
  });
}

async function notifyAdmin({ subject, body, contactId, event, clientId, reference, settings }) {
  const adminEmail = adminRecipientEmail();
  const emailEnabled = settings.email && adminEmail && isEmailConfigured();
  const taskEnabled = settings.createTask;

  if (emailEnabled) {
    try {
      await sendEmail({
        to: adminEmail,
        subject,
        text: body,
        html: `<p>${body.replace(/\n/g, "<br/>")}</p>`,
      });
    } catch (error) {
      console.error("Admin notification email failed:", error?.message || error);
    }
  }

  if (taskEnabled && contactId) {
    await addCrmActivity({
      contact: { _id: contactId },
      opportunity: null,
      type: "task",
      subject,
      body,
      dueAt: new Date(),
      assignedTo: null,
      metadata: {
        event,
        clientId,
        reference,
        automated: true,
      },
    });
  }
}

async function runNewSignupAdminNotification(settings) {
  if (!settings.enabled) return { scanned: 0, acted: 0 };

  const recent = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const clients = await Client.find({
    portalActive: true,
    createdAt: { $gte: recent },
  }).lean();

  let acted = 0;
  for (const client of clients) {
    const contact = await CrmContact.findOne({ client: client._id, isArchived: false }).lean();
    if (!contact) continue;

    const already = await dedupeActivityExists({
      contactId: contact._id,
      event: "automation_new_signup_admin_notification",
      clientId: String(client._id),
    });
    if (already) continue;

    await notifyAdmin({
      settings,
      subject: `New KhairoDietClinic client signup: ${client.fullName}`,
      body: `${client.fullName} signed up for the client portal.\nEmail: ${client.email}\nPhone: ${client.phone}`,
      contactId: contact._id,
      event: "automation_new_signup_admin_notification",
      clientId: String(client._id),
    });
    acted += 1;
  }

  return { scanned: clients.length, acted };
}

async function runQualificationFollowUp(settings) {
  if (!settings.enabled) return { scanned: 0, acted: 0 };

  const threshold = new Date(Date.now() - settings.delayDays * DAY);
  const opportunities = await CrmOpportunity.find({
    stage: "qualification",
    status: "open",
    stageEnteredAt: { $lte: threshold },
  }).populate("contact", "fullName isArchived").lean();

  let acted = 0;
  for (const opp of opportunities) {
    if (!opp.contact || opp.contact.isArchived) continue;

    const already = await CrmActivity.exists({
      contact: opp.contact._id,
      "metadata.event": "automation_qualification_follow_up",
      "metadata.opportunityId": String(opp._id),
    });
    if (already) continue;

    await addCrmActivity({
      contact: { _id: opp.contact._id },
      opportunity: opp,
      type: "task",
      subject: "Qualification follow-up needed",
      body: `${opp.contact.fullName} has been in Qualification for ${settings.delayDays} days without a decision.`,
      dueAt: new Date(),
      assignedTo: opp.assignedTo,
      metadata: {
        event: "automation_qualification_follow_up",
        opportunityId: String(opp._id),
        automated: true,
      },
    });
    acted += 1;
  }

  return { scanned: opportunities.length, acted };
}

async function runMonthlyReviews(settings) {
  if (!settings.enabled) return { scanned: 0, acted: 0 };

  const months = [];
  if (settings.month3) months.push(3);
  if (settings.month6) months.push(6);
  if (settings.month9) months.push(9);

  if (!months.length) return { scanned: 0, acted: 0 };

  const threshold = new Date(Date.now() - Math.max(...months) * MONTH - (settings.reviewDueDays || 0) * DAY);
  const clients = await Client.find({
    status: "active",
    isArchived: false,
    programStartedAt: { $lte: threshold },
  }).lean();

  let acted = 0;
  for (const client of clients) {
    const contact = await CrmContact.findOne({ client: client._id, isArchived: false }).lean();
    if (!contact) continue;

    const start = new Date(client.programStartedAt);
    const now = Date.now();

    for (const month of months) {
      const due = new Date(start.getTime() + month * MONTH + (settings.reviewDueDays || 0) * DAY);
      if (due.getTime() > now) continue;

      const event = `automation_month${month}_review_task`;
      const already = await CrmActivity.exists({
        contact: contact._id,
        "metadata.event": event,
        "metadata.clientId": String(client._id),
      });
      if (already) continue;

      await addCrmActivity({
        contact: { _id: contact._id },
        opportunity: null,
        type: "task",
        subject: `Month ${month} review due`,
        body: `${client.fullName} is due for their Month ${month} review.`,
        dueAt: new Date(),
        assignedTo: client.assignedCoach,
        metadata: {
          event,
          clientId: String(client._id),
          month,
          automated: true,
        },
      });
      acted += 1;
    }
  }

  return { scanned: clients.length, acted };
}

async function runClientActivationNotification(settings) {
  if (!settings.enabled) return { scanned: 0, acted: 0 };

  const recent = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const clients = await Client.find({
    reconciled: true,
    programStartedAt: { $gte: recent },
  }).lean();

  let acted = 0;
  for (const client of clients) {
    const contact = await CrmContact.findOne({ client: client._id, isArchived: false }).lean();
    if (!contact) continue;

    const already = await dedupeActivityExists({
      contactId: contact._id,
      event: "automation_client_activation_notification",
      clientId: String(client._id),
    });
    if (already) continue;

    await notifyAdmin({
      settings,
      subject: `Client activated: ${client.fullName}`,
      body: `${client.fullName} is now active.\nProgram: ${client.program}\nStart date: ${client.programStartedAt}`,
      contactId: contact._id,
      event: "automation_client_activation_notification",
      clientId: String(client._id),
    });
    acted += 1;
  }

  return { scanned: clients.length, acted };
}

export async function runOperationalAutomations() {
  const settingsRecord = await BusinessSettings.findOne({ key: "business" });
  if (!settingsRecord) return { skipped: true, reason: "no_settings" };

  const automations = settingsRecord.automations || {};
  const results = {};

  results.newSignup = await runNewSignupAdminNotification(automations.newSignupAdminNotification || {});
  results.qualification = await runQualificationFollowUp(automations.qualificationFollowUp || {});
  results.monthlyReviews = await runMonthlyReviews(automations.monthlyReviews || {});
  results.activation = await runClientActivationNotification(automations.clientActivationNotification || {});

  return results;
}
