import Client from "../models/Client.js";
import CrmContact from "../models/CrmContact.js";
import CrmOpportunity from "../models/CrmOpportunity.js";
import CrmActivity from "../models/CrmActivity.js";
import { addCrmActivity } from "./crmService.js";
import { isEmailConfigured, sendEmail } from "../utils/mailer.js";

const DAY = 24 * 60 * 60 * 1000;

function startAt(client) {
  return client.programStartedAt || client.startDate;
}

async function sendClientWeek3Reminder({ client, contact, opportunity }) {
  const existing = await CrmActivity.exists({
    contact: contact._id,
    "metadata.event": "week3_review_client_reminder",
    "metadata.clientId": String(client._id),
  });
  if (existing) return;

  let delivery = "skipped";
  let error = "";

  if (contact.email && isEmailConfigured()) {
    try {
      await sendEmail({
        to: contact.email,
        subject: "Your Khairo Diet Clinic Week 3 check-in is here",
        text: `Hi ${client.fullName},\n\nYou've completed 3 weeks of your Khairo Diet Clinic program. It's time for your Week 3 review. Please keep an eye out for your coach's check-in, or contact us if you need anything.\n\n— Khairo Diet Clinic`,
        html: `<p>Hi ${client.fullName},</p><p>You've completed 3 weeks of your Khairo Diet Clinic program. It's time for your Week 3 review.</p><p>Please keep an eye out for your coach's check-in, or contact us if you need anything.</p><p>— Khairo Diet Clinic</p>`,
      });
      delivery = "delivered";
    } catch (err) {
      delivery = "failed";
      error = err?.message || String(err);
    }
  }

  await addCrmActivity({
    contact,
    opportunity,
    type: "system",
    subject: "Week 3 client reminder processed",
    body: `Client reminder processed. Email: ${delivery}${error ? `. Error: ${error.slice(0, 300)}` : ""}.`,
    metadata: {
      event: "week3_review_client_reminder",
      clientId: String(client._id),
      emailDelivery: delivery,
    },
  });
}

async function createCoachWeek3Reminder({ client, contact, opportunity }) {
  const existing = await CrmActivity.exists({
    contact: contact._id,
    type: "task",
    completedAt: { $exists: false },
    "metadata.event": "week3_review_coach_reminder",
    "metadata.clientId": String(client._id),
  });
  if (existing) return;

  await addCrmActivity({
    contact,
    opportunity,
    type: "task",
    subject: "Coach Week 3 reminder",
    body: `Remind and support ${client.fullName} for their Week 3 review.`,
    dueAt: new Date(),
    assignedTo: client.assignedCoach || contact.assignedTo,
    metadata: {
      event: "week3_review_coach_reminder",
      clientId: String(client._id),
    },
  });
}

async function createMissedWeek3Escalation({ client, contact, opportunity, dueAt, now }) {
  const overdueMs = now.getTime() - new Date(dueAt).getTime();
  if (overdueMs < 3 * DAY) return;

  const existing = await CrmActivity.exists({
    contact: contact._id,
    type: "task",
    completedAt: { $exists: false },
    "metadata.event": "week3_review_missed_escalation",
    "metadata.clientId": String(client._id),
  });
  if (existing) return;

  await addCrmActivity({
    contact,
    opportunity,
    type: "task",
    subject: "Week 3 review missed escalation",
    body: `${client.fullName}'s Week 3 review is overdue by more than 3 days. Escalate for immediate attention.`,
    dueAt: now,
    assignedTo: client.assignedCoach || contact.assignedTo,
    metadata: {
      event: "week3_review_missed_escalation",
      clientId: String(client._id),
    },
  });
}

export async function ensureWeek3ReviewTasks() {
  const cutoff = new Date(Date.now() - 21 * DAY);
  const clients = await Client.find({
    isArchived: false,
    status: "active",
    accountStage: "active",
    "week3Review.completed": { $ne: true },
    $or: [
      { programStartedAt: { $lte: cutoff } },
      { programStartedAt: { $exists: false }, startDate: { $lte: cutoff } },
      { programStartedAt: null, startDate: { $lte: cutoff } },
    ],
  }).limit(250);

  const result = { due: clients.length, created: 0, existing: 0, missingCrm: 0 };

  for (const client of clients) {
    const contact = await CrmContact.findOne({ client: client._id, isArchived: false });
    if (!contact) {
      result.missingCrm += 1;
      continue;
    }

    const existing = await CrmActivity.exists({
      contact: contact._id,
      type: "task",
      completedAt: { $exists: false },
      "metadata.event": "week3_review_due",
      "metadata.clientId": String(client._id),
    });

    const opportunity = await CrmOpportunity.findOne({ contact: contact._id }).sort({ updatedAt: -1 });
    const start = startAt(client);
    const dueAt = start ? new Date(new Date(start).getTime() + 21 * DAY) : new Date();
    const now = new Date();

    if (!existing) {
      await addCrmActivity({
        contact,
        opportunity,
        type: "task",
        subject: "Complete Week 3 review",
        body: `Complete the Week 3 review for ${client.fullName}.`,
        dueAt,
        assignedTo: client.assignedCoach || contact.assignedTo,
        metadata: {
          event: "week3_review_due",
          clientId: String(client._id),
          dueAt,
        },
      });

      client.week3Review = {
        ...(client.week3Review?.toObject?.() || client.week3Review || {}),
        taskCreatedAt: now,
      };
      await client.save();
      result.created += 1;
    } else {
      result.existing += 1;
    }

    await sendClientWeek3Reminder({ client, contact, opportunity });
    await createCoachWeek3Reminder({ client, contact, opportunity });
    await createMissedWeek3Escalation({ client, contact, opportunity, dueAt, now });
  }

  return result;
}
