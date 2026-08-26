import Subscription from "../models/Subscription.js";
import Client from "../models/Client.js";
import CrmActivity from "../models/CrmActivity.js";
import CrmContact from "../models/CrmContact.js";
import { addCrmActivity } from "./crmService.js";
import { isEmailConfigured, sendEmail } from "../utils/mailer.js";

const DAY = 24 * 60 * 60 * 1000;
const DEFAULT_GRACE_DAYS = 3;

function graceDays() {
  const value = Number(process.env.SUBSCRIPTION_GRACE_DAYS || DEFAULT_GRACE_DAYS);
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_GRACE_DAYS;
}

async function notifyGracePeriod(subscription, client) {
  if (!client?.email || !isEmailConfigured()) return;

  const endDate = new Date(subscription.currentPeriodEnd).toLocaleDateString("en-NG", {
    timeZone: "Africa/Lagos",
    weekday: "short",
    month: "short",
    day: "numeric",
  });

  try {
    await sendEmail({
      to: client.email,
      subject: "Your Khairo Diet Clinic programme is now in grace period",
      text: `Hi ${client.fullName},\n\nYour Khairo Diet Clinic programme ended on ${endDate}. You are now in a short grace period. Complete a renewal payment to continue access without interruption.\n\nIf you have already paid, please ignore this message.\n\n- Khairo Diet Clinic`,
      html: `<p>Hi ${client.fullName},</p><p>Your Khairo Diet Clinic programme ended on <strong>${endDate}</strong>.</p><p>You are now in a short grace period. Complete a renewal payment to continue access without interruption.</p><p>If you have already paid, please ignore this message.</p><p>- Khairo Diet Clinic</p>`,
    });
  } catch (error) {
    console.error("Grace period notification failed:", error?.message || error);
  }
}

async function createGracePeriodTask(subscription, contact) {
  if (!contact) return;

  const existing = await CrmActivity.exists({
    contact: contact._id,
    type: "task",
    completedAt: { $exists: false },
    "metadata.event": "subscription_grace_period",
    "metadata.subscriptionId": String(subscription._id),
  });

  if (existing) return;

  await addCrmActivity({
    contact,
    opportunity: null,
    type: "task",
    subject: "Subscription in grace period",
    body: `${contact.fullName}'s subscription has entered grace period. Follow up and send a renewal payment link if needed.`,
    dueAt: new Date(),
    assignedTo: contact.assignedTo,
    metadata: {
      event: "subscription_grace_period",
      subscriptionId: String(subscription._id),
      currentPeriodEnd: subscription.currentPeriodEnd,
      gracePeriodEnd: subscription.gracePeriodEnd,
    },
  });
}

export async function runSubscriptionLifecycle() {
  const now = new Date();
  const result = {
    activeToGrace: 0,
    graceToExpired: 0,
    graceNotifications: 0,
    pausedClients: 0,
    errors: 0,
  };

  // 1) Active subscriptions whose period has ended -> grace period
  const endedActive = await Subscription.find({
    status: "active",
    currentPeriodEnd: { $lte: now },
  })
    .populate("client", "fullName email phone assignedCoach")
    .limit(250);

  for (const subscription of endedActive) {
    try {
      const client = subscription.client;
      const graceDays = graceDays();

      subscription.status = "grace_period";
      subscription.gracePeriodEnd = new Date(now.getTime() + graceDays * DAY);
      subscription.gracePeriodNotifiedAt = now;
      await subscription.save();

      if (client) {
        await notifyGracePeriod(subscription, client);
        result.graceNotifications += 1;

        const contact = await CrmContact.findOne({
          client: client._id,
          isArchived: false,
        }).lean();
        await createGracePeriodTask(subscription, contact);
      }

      result.activeToGrace += 1;
    } catch (error) {
      result.errors += 1;
      console.error("Active-to-grace lifecycle error:", subscription._id, error?.message || error);
    }
  }

  // 2) Grace period expired -> expired and pause client
  const graceEnded = await Subscription.find({
    status: "grace_period",
    gracePeriodEnd: { $lte: now },
  })
    .populate("client", "fullName email phone status accountStage")
    .limit(250);

  for (const subscription of graceEnded) {
    try {
      subscription.status = "expired";
      await subscription.save();

      const client = subscription.client;
      if (client) {
        if (client.status === "active") {
          client.status = "paused";
          result.pausedClients += 1;
        }
        if (client.accountStage === "active") {
          client.accountStage = "paused";
        }
        await client.save({ validateBeforeSave: false });
      }

      result.graceToExpired += 1;
    } catch (error) {
      result.errors += 1;
      console.error("Grace-to-expired lifecycle error:", subscription._id, error?.message || error);
    }
  }

  return result;
}
