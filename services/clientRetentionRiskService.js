import mongoose from "mongoose";
import Client from "../models/Client.js";
import CrmContact from "../models/CrmContact.js";
import CrmTag from "../models/CrmTag.js";
import { dispatchCrmTagChange } from "./crmTagWorkflowService.js";
import { syncClientRetentionResponses } from "./clientRetentionResponseService.js";

export const CLIENT_RETENTION_RISK_TAG_KEYS = [
  "weekly_checkin_overdue",
  "progress_photo_overdue",
  "portal_inactive_7d",
  "engagement_attention_needed",
  "engagement_high_risk",
];

const DEFINITIONS = {
  weekly_checkin_overdue: {
    name: "Weekly Check-in Overdue",
    description: "Current-state tag when an active client has gone at least 7 days without an official weekly check-in.",
    automationRule: "risk:weekly_checkin_overdue",
  },
  progress_photo_overdue: {
    name: "Progress Photo Overdue",
    description: "Current-state tag when an active client has gone at least 14 days without a progress photo.",
    automationRule: "risk:progress_photo_overdue",
  },
  portal_inactive_7d: {
    name: "Portal Inactive: 7+ Days",
    description: "Current-state tag when an active portal client has not logged in for at least 7 days.",
    automationRule: "risk:portal_inactive_7d",
  },
  engagement_attention_needed: {
    name: "Engagement Attention Needed",
    description: "Umbrella current-state tag when at least one reliable client-engagement risk signal is present.",
    automationRule: "risk:engagement_attention_needed",
  },
  engagement_high_risk: {
    name: "Engagement High Risk",
    description: "Current-state tag when two or more reliable client-engagement risk signals are present at the same time.",
    automationRule: "risk:engagement_high_risk",
  },
};

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEKLY_CHECKIN_DAYS = 7;
const PROGRESS_PHOTO_DAYS = 14;
const PORTAL_INACTIVE_DAYS = 7;

async function ensureDefinitions() {
  await Promise.all(
    Object.entries(DEFINITIONS).map(([key, definition]) =>
      CrmTag.findOneAndUpdate(
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
            lifecycleMode: "conditional",
            removeOnStages: [],
          },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      )
    )
  );
}

function daysSince(value, now) {
  if (!value) return Infinity;
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return Infinity;
  return Math.floor((now.getTime() - timestamp) / DAY_MS);
}

function latestCheckInDate(client) {
  const checkIns = Array.isArray(client.checkIns) ? client.checkIns : [];
  if (!checkIns.length) return client.programStartedAt || client.startDate;
  return checkIns.reduce((latest, checkIn) => {
    const current = new Date(checkIn.date || 0);
    if (!Number.isFinite(current.getTime())) return latest;
    if (!latest || current > latest) return current;
    return latest;
  }, null);
}

async function latestProgressPhotos(clientIds) {
  const result = new Map();
  if (!mongoose.connection.db || !clientIds.length) return result;

  try {
    const rows = await mongoose.connection.db
      .collection("clientProgressPhotos.files")
      .aggregate([
        {
          $match: {
            "metadata.clientId": { $in: clientIds.map(String) },
          },
        },
        { $sort: { uploadDate: -1 } },
        {
          $group: {
            _id: "$metadata.clientId",
            uploadDate: { $first: "$uploadDate" },
          },
        },
      ])
      .toArray();

    for (const row of rows) {
      result.set(String(row._id), row.uploadDate);
    }
  } catch (error) {
    console.error("Could not read progress photo dates for retention risk scan:", error?.message || error);
  }

  return result;
}

function programReferenceDate(client) {
  return client.programStartedAt || client.startDate || client.createdAt;
}

function withinActiveProgram(client, now) {
  if (client.programEndsAt && new Date(client.programEndsAt).getTime() < now.getTime()) {
    return false;
  }
  const start = programReferenceDate(client);
  if (start && new Date(start).getTime() > now.getTime()) return false;
  return true;
}

export async function refreshClientRetentionRiskTags({ now = new Date() } = {}) {
  await ensureDefinitions();

  const clients = await Client.find({
    isArchived: { $ne: true },
    status: "active",
    reconciled: true,
    portalActive: true,
    accountStage: { $ne: "preview" },
  })
    .select(
      "_id fullName email phone startDate createdAt programStartedAt programEndsAt portalLastLogin checkIns"
    )
    .lean();

  if (!clients.length) {
    return {
      clients: 0,
      contactsChanged: 0,
      tagsAdded: 0,
      tagsRemoved: 0,
      attentionNeeded: 0,
      highRisk: 0,
      nudgesSent: 0,
      alertsOpened: 0,
      alertsResolved: 0,
    };
  }

  const clientIds = clients.map((client) => client._id);
  const [contacts, photoDates] = await Promise.all([
    CrmContact.find({
      client: { $in: clientIds },
      isArchived: false,
    }),
    latestProgressPhotos(clientIds),
  ]);

  const contactByClient = new Map(
    contacts.map((contact) => [String(contact.client), contact])
  );

  let contactsChanged = 0;
  let tagsAdded = 0;
  let tagsRemoved = 0;
  let attentionNeeded = 0;
  let highRisk = 0;
  let nudgesSent = 0;
  let alertsOpened = 0;
  let alertsResolved = 0;

  for (const client of clients) {
    if (!withinActiveProgram(client, now)) continue;

    const clientId = String(client._id);
    const contact = contactByClient.get(clientId);
    if (!contact) continue;

    const desiredRiskTags = [];
    const riskSignals = [];

    const checkInReference = latestCheckInDate(client);
    if (daysSince(checkInReference, now) >= WEEKLY_CHECKIN_DAYS) {
      desiredRiskTags.push("weekly_checkin_overdue");
      riskSignals.push("weekly_checkin_overdue");
    }

    const photoReference = photoDates.get(clientId) || programReferenceDate(client);
    if (daysSince(photoReference, now) >= PROGRESS_PHOTO_DAYS) {
      desiredRiskTags.push("progress_photo_overdue");
      riskSignals.push("progress_photo_overdue");
    }

    const portalReference = client.portalLastLogin || programReferenceDate(client);
    if (daysSince(portalReference, now) >= PORTAL_INACTIVE_DAYS) {
      desiredRiskTags.push("portal_inactive_7d");
      riskSignals.push("portal_inactive_7d");
    }

    const existingTags = new Set(contact.tags || []);
    if (
      existingTags.has("daily_tracking_missed") ||
      existingTags.has("tracking_streak_broken")
    ) {
      riskSignals.push("daily_tracking_missed");
    }

    if (riskSignals.length > 0) {
      desiredRiskTags.push("engagement_attention_needed");
      attentionNeeded += 1;
    }
    if (new Set(riskSignals).size >= 2) {
      desiredRiskTags.push("engagement_high_risk");
      highRisk += 1;
    }

    const beforeTags = [...(contact.tags || [])];
    const wasAttentionNeeded = beforeTags.includes("engagement_attention_needed");
    const preserved = beforeTags.filter(
      (tag) => !CLIENT_RETENTION_RISK_TAG_KEYS.includes(tag)
    );
    const nextTags = [...new Set([...preserved, ...desiredRiskTags])];

    const beforeSorted = [...beforeTags].sort();
    const afterSorted = [...nextTags].sort();
    const tagsChanged = JSON.stringify(beforeSorted) !== JSON.stringify(afterSorted);

    if (tagsChanged) {
      const beforeSet = new Set(beforeTags);
      const afterSet = new Set(nextTags);
      const added = nextTags.filter((tag) => !beforeSet.has(tag));
      const removed = beforeTags.filter((tag) => !afterSet.has(tag));

      contact.tags = nextTags;
      contact.lastActivityAt = new Date();
      await contact.save();

      contactsChanged += 1;
      tagsAdded += added.length;
      tagsRemoved += removed.length;

      for (const tag of removed) {
        await dispatchCrmTagChange({
          contact,
          tag,
          change: "removed",
          actorName: "System (retention risk)",
        });
      }
      for (const tag of added) {
        await dispatchCrmTagChange({
          contact,
          tag,
          change: "added",
          actorName: "System (retention risk)",
        });
      }
    }

    try {
      const response = await syncClientRetentionResponses({
        client,
        riskSignals,
        now,
        wasAttentionNeeded,
      });

      if (response?.nudgeChannels?.length) nudgesSent += 1;
      if (response?.alert?.opened) alertsOpened += 1;
      if (response?.alert?.resolved) alertsResolved += 1;
    } catch (error) {
      console.error(`Retention response sync failed for client ${client._id}:`, error?.message || error);
    }
  }

  return {
    clients: clients.length,
    contactsChanged,
    tagsAdded,
    tagsRemoved,
    attentionNeeded,
    highRisk,
    nudgesSent,
    alertsOpened,
    alertsResolved,
  };
}
