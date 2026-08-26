import AuditLog from "../models/AuditLog.js";
import ClientMessage from "../models/ClientMessage.js";
import CrmContact from "../models/CrmContact.js";
import CrmTag from "../models/CrmTag.js";
import { dispatchCrmTagChange } from "./crmTagWorkflowService.js";

const STREAK_RECOGNITION = {
  tracking_streak_7: {
    days: 7,
    message: "7 days in a row — great consistency. Keep building on it.",
  },
  tracking_streak_14: {
    days: 14,
    message: "14 days in a row — excellent consistency. You are building a strong routine.",
  },
  tracking_streak_30: {
    days: 30,
    message: "30 days in a row — outstanding consistency. That is a meaningful milestone. Keep going.",
  },
};

const RECOVERY_TAG = {
  key: "engagement_recovered",
  name: "Engagement Recovered",
  description: "Permanent milestone showing that the client recovered from an engagement-attention episode.",
  automationRule: "milestone:engagement_recovered",
};

async function sendPortalRecognition(client, body) {
  await ClientMessage.create({
    client: client._id,
    senderType: "staff",
    senderName: "KhairoDietClinic Team",
    category: "general",
    body,
    readByClient: false,
    readByStaff: true,
  });
}

export async function recognizeTrackingMilestone(client, addedTags = []) {
  if (!client?._id || !Array.isArray(addedTags)) return null;

  const milestones = addedTags
    .map((tag) => ({ tag, definition: STREAK_RECOGNITION[tag] }))
    .filter((item) => item.definition)
    .sort((a, b) => b.definition.days - a.definition.days);

  if (!milestones.length) return null;

  const highest = milestones[0];
  const auditDetails = highest.tag;
  const alreadySent = await AuditLog.findOne({
    action: "Sent tracking milestone recognition",
    entityType: "Client",
    entityId: String(client._id),
    details: auditDetails,
  }).lean();

  if (alreadySent) return { sent: false, tag: highest.tag };

  await sendPortalRecognition(client, highest.definition.message);
  await AuditLog.create({
    user: null,
    userName: "System (recognition)",
    action: "Sent tracking milestone recognition",
    entityType: "Client",
    entityId: String(client._id),
    details: auditDetails,
  });

  return { sent: true, tag: highest.tag };
}

async function ensureRecoveryTag() {
  await CrmTag.findOneAndUpdate(
    { key: RECOVERY_TAG.key },
    {
      $setOnInsert: {
        key: RECOVERY_TAG.key,
        name: RECOVERY_TAG.name,
        normalizedName: RECOVERY_TAG.name.trim().toLowerCase(),
        category: "behavior",
        description: RECOVERY_TAG.description,
        active: true,
      },
      $set: {
        automationManaged: true,
        automationRule: RECOVERY_TAG.automationRule,
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
}

export async function recognizeEngagementRecovery(client) {
  if (!client?._id) return null;

  await ensureRecoveryTag();

  const contact = await CrmContact.findOne({
    client: client._id,
    isArchived: false,
  });

  let tagAdded = false;
  if (contact && !(contact.tags || []).includes(RECOVERY_TAG.key)) {
    contact.tags = [...new Set([...(contact.tags || []), RECOVERY_TAG.key])];
    contact.lastActivityAt = new Date();
    await contact.save();
    tagAdded = true;

    await dispatchCrmTagChange({
      contact,
      tag: RECOVERY_TAG.key,
      change: "added",
      actorName: "System (recognition)",
    });
  }

  await sendPortalRecognition(
    client,
    "Nice work getting back on track. Your recent KhairoDietClinic activity is current again — keep building from here."
  );

  await AuditLog.create({
    user: null,
    userName: "System (recognition)",
    action: "Sent engagement recovery recognition",
    entityType: "Client",
    entityId: String(client._id),
    details: tagAdded ? "Engagement Recovered milestone added." : "Repeat recovery episode recognized.",
  });

  return { sent: true, tagAdded };
}
