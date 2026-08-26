import webpush from "web-push";
import PushSubscription from "../models/PushSubscription.js";

export const isPushConfigured = () =>
  Boolean(
    process.env.VAPID_PUBLIC_KEY &&
      process.env.VAPID_PRIVATE_KEY &&
      process.env.VAPID_SUBJECT
  );

export const getVapidPublicKey = () =>
  process.env.VAPID_PUBLIC_KEY || "";

function configureWebPush() {
  if (!isPushConfigured()) {
    const error = new Error(
      "Web Push is not configured. Add the VAPID environment variables."
    );
    error.status = 501;
    throw error;
  }

  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT,
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );
}

export async function savePushSubscription({
  userId,
  subscription,
  userAgent = "",
}) {
  const endpoint = String(subscription?.endpoint || "").trim();
  const p256dh = String(subscription?.keys?.p256dh || "").trim();
  const auth = String(subscription?.keys?.auth || "").trim();

  if (!endpoint || !p256dh || !auth) {
    const error = new Error("Invalid push subscription.");
    error.status = 400;
    throw error;
  }

  return PushSubscription.findOneAndUpdate(
    { endpoint },
    {
      user: userId,
      endpoint,
      keys: { p256dh, auth },
      userAgent: String(userAgent || "").slice(0, 500),
    },
    {
      upsert: true,
      new: true,
      runValidators: true,
      setDefaultsOnInsert: true,
    }
  );
}

export async function removePushSubscription({
  userId,
  endpoint,
}) {
  if (!endpoint) return;

  await PushSubscription.deleteOne({
    user: userId,
    endpoint: String(endpoint),
  });
}

export async function sendPushToUser(userId, payload) {
  configureWebPush();

  const subscriptions = await PushSubscription.find({
    user: userId,
  }).lean();

  if (!subscriptions.length) {
    return {
      attempted: 0,
      delivered: 0,
      failed: 0,
    };
  }

  let delivered = 0;
  let failed = 0;

  for (const subscription of subscriptions) {
    try {
      await webpush.sendNotification(
        {
          endpoint: subscription.endpoint,
          keys: subscription.keys,
        },
        JSON.stringify(payload),
        {
          TTL: 60 * 60,
          urgency: "high",
        }
      );

      delivered += 1;
    } catch (error) {
      failed += 1;

      if (
        error?.statusCode === 404 ||
        error?.statusCode === 410
      ) {
        await PushSubscription.deleteOne({
          _id: subscription._id,
        });
      }
    }
  }

  return {
    attempted: subscriptions.length,
    delivered,
    failed,
  };
}
