import AuditLog from "../models/AuditLog.js";
import CrmContact from "../models/CrmContact.js";
import CrmTag from "../models/CrmTag.js";
import DailyLog from "../models/DailyLog.js";
import Client from "../models/Client.js";
import { dispatchCrmTagChange } from "./crmTagWorkflowService.js";
import { recognizeTrackingMilestone } from "./clientRecognitionService.js";
import { isEmailConfigured, sendEmail } from "../utils/mailer.js";

export const CLIENT_ENGAGEMENT_CURRENT_TAG_KEYS = [
  "daily_tracking_not_started",
  "daily_tracking_current",
  "daily_tracking_missed",
  "tracking_streak_active",
  "tracking_streak_broken",
];

const ENGAGEMENT_TAG_DEFINITIONS = {
  daily_tracking_not_started: {
    name: "Daily Tracking Not Started",
    description: "Current-state tag for an activated client who has not yet recorded a daily tracking entry.",
    automationRule: "engagement:daily_tracking_not_started",
  },
  daily_tracking_current: {
    name: "Daily Tracking Current",
    description: "Current-state tag while a client has a current daily tracking run.",
    automationRule: "engagement:daily_tracking_current",
  },
  daily_tracking_missed: {
    name: "Daily Tracking Missed",
    description: "Current-state tag when a previously tracking client has missed the latest completed tracking day.",
    automationRule: "engagement:daily_tracking_missed",
  },
  tracking_streak_active: {
    name: "Tracking Streak Active",
    description: "Current-state tag while the client has at least one consecutive tracked day in the current run.",
    automationRule: "engagement:tracking_streak_active",
  },
  tracking_streak_broken: {
    name: "Tracking Streak Broken",
    description: "Current-state tag when a previously active daily tracking run has been interrupted.",
    automationRule: "engagement:tracking_streak_broken",
  },
  tracking_started: {
    name: "Daily Tracking Started",
    description: "Permanent milestone showing that the client has recorded at least one daily tracking entry.",
    automationRule: "milestone:tracking_started",
  },
  meal_tracking_started: {
    name: "Meal Tracking Started",
    description: "Permanent milestone showing that the client has checked at least one meal-plan item.",
    automationRule: "milestone:meal_tracking_started",
  },
  workout_tracking_started: {
    name: "Workout Tracking Started",
    description: "Permanent milestone showing that the client has recorded a completed workout or exercise.",
    automationRule: "milestone:workout_tracking_started",
  },
  tracking_streak_3: {
    name: "Tracking Streak: 3 Days",
    description: "Permanent milestone showing that the client reached a 3-day daily tracking streak.",
    automationRule: "milestone:tracking_streak_3",
  },
  tracking_streak_7: {
    name: "Tracking Streak: 7 Days",
    description: "Permanent milestone showing that the client reached a 7-day daily tracking streak.",
    automationRule: "milestone:tracking_streak_7",
  },
  tracking_streak_14: {
    name: "Tracking Streak: 14 Days",
    description: "Permanent milestone showing that the client reached a 14-day daily tracking streak.",
    automationRule: "milestone:tracking_streak_14",
  },
  tracking_streak_30: {
    name: "Tracking Streak: 30 Days",
    description: "Permanent milestone showing that the client reached a 30-day daily tracking streak.",
    automationRule: "milestone:tracking_streak_30",
  },
};

function engagementTimezone() {
  return process.env.ENGAGEMENT_TIMEZONE || "Africa/Lagos";
}

export function dateKeyInTimezone(date = new Date(), timeZone = engagementTimezone()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function previousDateKey(key) {
  const date = new Date(`${key}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

async function ensureEngagementTag(key) {
  const definition = ENGAGEMENT_TAG_DEFINITIONS[key];
  if (!definition) return;

  await CrmTag.findOneAndUpdate(
    { key },
    {
      $setOnInsert: {
        key,
        name: definition.name,
        normalizedName: definition.name.trim().toLowerCase(),
        category: "behavior",
        description: definition.description,
        active: true,
      },
      $set: {
        automationManaged: true,
        automationRule: definition.automationRule,
        lifecycleMode: CLIENT_ENGAGEMENT_CURRENT_TAG_KEYS.includes(key)
          ? "conditional"
          : "permanent",
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
}

function dateIsInProgram(client, key) {
  const start = client?.programStartedAt || client?.startDate;
  if (start && dateKeyInTimezone(new Date(start)) > key) return false;

  if (client?.programEndsAt && dateKeyInTimezone(new Date(client.programEndsAt)) < key) {
    return false;
  }

  return true;
}

export async function getClientTrackingSnapshot(clientId, { todayKey } = {}) {
  const today = todayKey || dateKeyInTimezone();
  const yesterday = previousDateKey(today);
  const logs = await DailyLog.find({ client: clientId })
    .select("logDate completedMealItemIds completedExerciseIds workoutDone")
    .sort({ logDate: -1 })
    .limit(400)
    .lean();

  const loggedDates = new Set(logs.map((log) => log.logDate));
  const todayLogged = loggedDates.has(today);
  const yesterdayLogged = loggedDates.has(yesterday);
  const hasAnyTracking = logs.length > 0;

  let streak = 0;
  let cursor = todayLogged ? today : yesterday;
  while (loggedDates.has(cursor)) {
    streak += 1;
    cursor = previousDateKey(cursor);
  }

  const mealTrackingStarted = logs.some(
    (log) => Array.isArray(log.completedMealItemIds) && log.completedMealItemIds.length > 0
  );
  const workoutTrackingStarted = logs.some(
    (log) =>
      log.workoutDone === true ||
      (Array.isArray(log.completedExerciseIds) && log.completedExerciseIds.length > 0)
  );

  const currentTags = [];
  if (!hasAnyTracking) {
    currentTags.push("daily_tracking_not_started");
  } else if (streak > 0) {
    currentTags.push("daily_tracking_current", "tracking_streak_active");
  } else {
    currentTags.push("daily_tracking_missed", "tracking_streak_broken");
  }

  const milestones = [];
  if (hasAnyTracking) milestones.push("tracking_started");
  if (mealTrackingStarted) milestones.push("meal_tracking_started");
  if (workoutTrackingStarted) milestones.push("workout_tracking_started");
  if (streak >= 3) milestones.push("tracking_streak_3");
  if (streak >= 7) milestones.push("tracking_streak_7");
  if (streak >= 14) milestones.push("tracking_streak_14");
  if (streak >= 30) milestones.push("tracking_streak_30");

  return {
    today,
    yesterday,
    todayLogged,
    yesterdayLogged,
    hasAnyTracking,
    streak,
    currentTags,
    milestones,
  };
}

export async function syncClientEngagementTags(client, { todayKey, actorUserId } = {}) {
  if (!client?._id || client.reconciled !== true || client.accountStage === "preview") return null;

  const contact = await CrmContact.findOne({ client: client._id, isArchived: false });
  if (!contact) return null;

  const snapshot = await getClientTrackingSnapshot(client._id, { todayKey });
  const desired = [...snapshot.currentTags, ...snapshot.milestones];
  await Promise.all(desired.map(ensureEngagementTag));

  const beforeTags = [...(contact.tags || [])];
  const nextTags = beforeTags.filter((tag) => !CLIENT_ENGAGEMENT_CURRENT_TAG_KEYS.includes(tag));
  for (const tag of desired) {
    if (!nextTags.includes(tag)) nextTags.push(tag);
  }

  const before = [...beforeTags].sort();
  const after = [...nextTags].sort();
  if (JSON.stringify(before) === JSON.stringify(after)) {
    return { contact, snapshot, added: [], removed: [] };
  }

  const beforeSet = new Set(beforeTags);
  const afterSet = new Set(nextTags);
  const added = nextTags.filter((tag) => !beforeSet.has(tag));
  const removed = beforeTags.filter((tag) => !afterSet.has(tag));

  contact.tags = nextTags;
  if (actorUserId) contact.updatedBy = actorUserId;
  contact.lastActivityAt = new Date();
  await contact.save();

  for (const tag of removed) {
    await dispatchCrmTagChange({
      contact,
      tag,
      change: "removed",
      actorUserId,
      actorName: "System (engagement)",
    });
  }
  for (const tag of added) {
    await dispatchCrmTagChange({
      contact,
      tag,
      change: "added",
      actorUserId,
      actorName: "System (engagement)",
    });
  }

  try {
    await recognizeTrackingMilestone(client, added);
  } catch (error) {
    console.error(`Tracking milestone recognition failed for ${client._id}:`, error?.message || error);
  }

  return { contact, snapshot, added, removed };
}

async function sendWhatsAppText(client, text) {
  const token = process.env.WHATSAPP_TOKEN;
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const phone = String(client.phone || "").replace(/\D/g, "");
  if (!token || !phoneId || !phone) return false;

  const response = await fetch(`https://graph.facebook.com/v18.0/${phoneId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: phone,
      type: "text",
      text: { body: text },
    }),
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data?.error?.message || "WhatsApp check-in could not be sent.");
  }
  return true;
}

async function sendEmailNudge(client, text) {
  if (!client.email || !isEmailConfigured()) return false;
  const first = String(client.fullName || "there").trim().split(/\s+/)[0] || "there";
  const html = `<div style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;background:#0a0a0a;padding:32px;color:#f5f5f5;"><div style="max-width:520px;margin:0 auto;background:#171717;border:1px solid #262626;border-radius:8px;padding:32px;"><p style="margin:0 0 16px;">Hi ${first},</p><p style="margin:0;font-size:15px;line-height:1.6;color:#d4d4d4;">${text.replace(`Hi ${first}, `, "")}</p><p style="margin:24px 0 0;font-size:12px;color:#737373;">Khairo Diet Clinic</p></div></div>`;
  await sendEmail({
    to: client.email,
    subject: `Just checking in, ${first}`,
    html,
    text,
  });
  return true;
}

async function sendMissedTrackingNudge(client) {
  const first = String(client.fullName || "there").trim().split(/\s+/)[0] || "there";
  const text = `Hi ${first}, we noticed you didn't log your daily progress yesterday. Just checking in. How are you doing?`;
  const preferred = String(process.env.ENGAGEMENT_NUDGE_CHANNEL || "auto").trim().toLowerCase();

  if (preferred !== "email") {
    try {
      if (await sendWhatsAppText(client, text)) return "whatsapp";
    } catch (error) {
      console.error(`Engagement WhatsApp failed for ${client._id}:`, error?.message || error);
    }
  }

  if (await sendEmailNudge(client, text)) return "email";
  return "none";
}

export async function runDailyEngagementReview({ now = new Date(), sendNotifications = true } = {}) {
  const today = dateKeyInTimezone(now);
  const yesterday = previousDateKey(today);
  const clients = await Client.find({
    isArchived: { $ne: true },
    status: "active",
    reconciled: true,
    portalActive: true,
  });

  let reviewed = 0;
  let missed = 0;
  let nudgesSent = 0;
  let duplicatesSkipped = 0;

  for (const client of clients) {
    if (!dateIsInProgram(client, yesterday)) continue;
    reviewed += 1;

    try {
      const synced = await syncClientEngagementTags(client, { todayKey: today });
      const snapshot = synced?.snapshot || (await getClientTrackingSnapshot(client._id, { todayKey: today }));

      if (snapshot.yesterdayLogged || snapshot.todayLogged || !snapshot.hasAnyTracking) continue;
      missed += 1;
      if (!sendNotifications) continue;

      const auditDetails = `missedDate:${yesterday}`;
      const alreadySent = await AuditLog.findOne({
        action: { $regex: /^Sent missed tracking nudge/ },
        entityType: "Client",
        entityId: client._id.toString(),
        details: auditDetails,
      });
      if (alreadySent) {
        duplicatesSkipped += 1;
        continue;
      }

      const channel = await sendMissedTrackingNudge(client);
      if (channel === "none") continue;

      await AuditLog.create({
        user: null,
        userName: "System (engagement)",
        action: `Sent missed tracking nudge via ${channel}`,
        entityType: "Client",
        entityId: client._id.toString(),
        details: auditDetails,
      });
      nudgesSent += 1;
    } catch (error) {
      console.error(`Daily engagement review failed for client ${client._id}:`, error?.message || error);
    }
  }

  return { today, yesterday, reviewed, missed, nudgesSent, duplicatesSkipped };
}
