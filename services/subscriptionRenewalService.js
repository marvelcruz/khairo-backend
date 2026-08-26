import Subscription from "../models/Subscription.js";
import { isEmailConfigured, sendEmail } from "../utils/mailer.js";

const DAY = 24 * 60 * 60 * 1000;

export async function runSubscriptionRenewalReminders() {
  if (!isEmailConfigured()) {
    return { skipped: true, reason: "email_not_configured" };
  }

  const now = Date.now();
  const endThreshold = new Date(now + 3 * DAY);

  const subscriptions = await Subscription.find({
    status: { $in: ["active", "grace_period"] },
    autoRenew: true,
    currentPeriodEnd: { $gte: new Date(now), $lte: endThreshold },
  })
    .populate("client", "fullName email")
    .limit(300);

  const result = { scanned: subscriptions.length, sent: 0, skipped: 0, failed: 0 };

  for (const subscription of subscriptions) {
    const client = subscription.client;
    if (!client?.email) {
      result.skipped += 1;
      continue;
    }

    subscription.renewalRemindersSent = subscription.renewalRemindersSent || {};

    const daysLeft = Math.ceil(
      (new Date(subscription.currentPeriodEnd).getTime() - now) / DAY
    );

    let flag = null;
    if (daysLeft <= 3 && daysLeft > 1 && !subscription.renewalRemindersSent.day27) {
      flag = "day27";
    } else if (daysLeft <= 1 && !subscription.renewalRemindersSent.day29) {
      flag = "day29";
    }

    if (!flag) {
      result.skipped += 1;
      continue;
    }

    const endDate = new Date(subscription.currentPeriodEnd).toLocaleDateString("en-NG", {
      timeZone: "Africa/Lagos",
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
    });

    try {
      await sendEmail({
        to: client.email,
        subject: "Your KhairoDietClinic programme renews soon",
        text: `Hi ${client.fullName},\n\nYour current KhairoDietClinic programme period ends on ${endDate}. We'll be in touch to help you continue or choose the next best step.\n\n— KhairoDietClinic`,
        html: `<p>Hi ${client.fullName},</p><p>Your current KhairoDietClinic programme period ends on <strong>${endDate}</strong>.</p><p>We'll be in touch to help you continue or choose the next best step.</p><p>— KhairoDietClinic</p>`,
      });

      subscription.renewalRemindersSent[flag] = true;
      await subscription.save();
      result.sent += 1;
    } catch (error) {
      result.failed += 1;
      console.error(
        `Renewal reminder failed for subscription ${subscription._id}:`,
        error?.message || error
      );
    }
  }

  return result;
}
