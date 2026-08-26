import Client from "../models/Client.js";
import CrmActivity from "../models/CrmActivity.js";
import CrmContact from "../models/CrmContact.js";
import CrmOpportunity from "../models/CrmOpportunity.js";
import CrmTag from "../models/CrmTag.js";
import Order from "../models/Order.js";
import Payment from "../models/Payment.js";
import {
  automaticStageTags,
  automationTagDefinition,
  CRM_CURRENT_STAGE_TAGS,
  CRM_STAGE_MILESTONE_TAGS,
  STAGE_MANAGED_TAG_KEYS,
} from "./crmTagAutomationPolicy.js";
import { syncClientLifecycleTags } from "./clientLifecycleTagService.js";

async function ensureTagDefinition(tagKey) {
  const definition = automationTagDefinition(tagKey);
  if (!definition) return;

  await CrmTag.findOneAndUpdate(
    { key: tagKey },
    {
      $setOnInsert: {
        key: tagKey,
        name: definition.name,
        normalizedName: definition.name.trim().toLowerCase(),
        category: definition.category,
        description: definition.description,
        active: true,
      },
      $set: {
        automationManaged: true,
        automationRule: definition.automationRule,
      },
    },
    {
      upsert: true,
      new: true,
      setDefaultsOnInsert: true,
    }
  );
}

async function contactsWhoReachedStage(stage) {
  const [current, entered, exited] = await Promise.all([
    CrmOpportunity.distinct("contact", { stage }),
    CrmActivity.distinct("contact", {
      type: "stage_change",
      "metadata.to": stage,
    }),
    CrmActivity.distinct("contact", {
      type: "stage_change",
      "metadata.from": stage,
    }),
  ]);

  return [
    ...new Set(
      [...current, ...entered, ...exited]
        .filter(Boolean)
        .map((value) => String(value))
    ),
  ];
}

export async function backfillCrmStageMilestones() {
  const entries = Object.entries(CRM_STAGE_MILESTONE_TAGS);
  await Promise.all(entries.map(([, tagKey]) => ensureTagDefinition(tagKey)));

  const summary = {
    stages: entries.length,
    matched: 0,
    changed: 0,
  };

  for (const [stage, tagKey] of entries) {
    const contactIds = await contactsWhoReachedStage(stage);
    summary.matched += contactIds.length;
    if (!contactIds.length) continue;

    const contacts = await CrmContact.find({
      _id: { $in: contactIds },
      isArchived: false,
      tags: { $ne: tagKey },
    }).select("_id");

    if (!contacts.length) continue;

    const idsToBackfill = contacts.map((contact) => contact._id);

    await CrmContact.updateMany(
      { _id: { $in: idsToBackfill } },
      { $addToSet: { tags: tagKey } }
    );

    const existingAuditRows = await CrmActivity.distinct("contact", {
      contact: { $in: idsToBackfill },
      type: "system",
      "metadata.event": "crm_milestone_backfilled",
      "metadata.tag": tagKey,
    });
    const alreadyAudited = new Set(existingAuditRows.map((value) => String(value)));
    const definition = automationTagDefinition(tagKey);

    const auditRows = idsToBackfill
      .filter((contactId) => !alreadyAudited.has(String(contactId)))
      .map((contactId) => ({
        contact: contactId,
        type: "system",
        subject: "CRM milestone backfilled",
        body: `${definition?.name || tagKey} added as a permanent audit milestone from existing CRM stage history.`,
        metadata: {
          event: "crm_milestone_backfilled",
          tag: tagKey,
          stage,
          permanent: true,
          source: "existing_stage_history",
        },
      }));

    if (auditRows.length) {
      await CrmActivity.insertMany(auditRows, { ordered: false });
    }

    summary.changed += idsToBackfill.length;
  }

  return summary;
}

async function backfillCurrentCrmStageTags() {
  await Promise.all(
    Object.values(CRM_CURRENT_STAGE_TAGS).map(ensureTagDefinition)
  );

  const opportunities = await CrmOpportunity.find({
    status: { $in: ["open", "lost"] },
  })
    .select("contact stage status updatedAt")
    .sort({ updatedAt: -1 })
    .lean();

  const latestByContact = new Map();
  for (const opportunity of opportunities) {
    const key = String(opportunity.contact);
    if (!latestByContact.has(key)) latestByContact.set(key, opportunity);
  }

  let changed = 0;

  for (const opportunity of latestByContact.values()) {
    const contact = await CrmContact.findOne({
      _id: opportunity.contact,
      isArchived: false,
      lifecycleStage: { $ne: "client" },
    });

    if (!contact) continue;

    const desired = automaticStageTags(opportunity.stage);
    const managed = new Set(STAGE_MANAGED_TAG_KEYS);
    const nextTags = (contact.tags || []).filter((tag) => !managed.has(tag));

    for (const tag of desired) {
      await ensureTagDefinition(tag);
      if (!nextTags.includes(tag)) nextTags.push(tag);
    }

    const before = [...(contact.tags || [])].sort();
    const after = [...nextTags].sort();
    if (JSON.stringify(before) === JSON.stringify(after)) continue;

    contact.tags = nextTags;
    contact.lastActivityAt = new Date();
    await contact.save();
    changed += 1;
  }

  return { matched: latestByContact.size, changed };
}

async function backfillActivatedClientTags() {
  const clients = await Client.find({
    isArchived: { $ne: true },
    reconciled: true,
    accountStage: { $ne: "preview" },
  });

  let changed = 0;

  for (const client of clients) {
    const before = await CrmContact.findOne({
      client: client._id,
      isArchived: false,
    })
      .select("tags")
      .lean();

    if (!before) continue;

    const [hasSuccessfulPayment, hasOrder] = await Promise.all([
      Payment.exists({ client: client._id, status: "success" }),
      Order.exists({ client: client._id }),
    ]);

    const milestones = [
      "client_activated",
      ...(hasSuccessfulPayment ? ["payment_completed"] : []),
      ...(hasOrder ? ["order_created"] : []),
      ...(client.assignedDoctor ? ["doctor_assigned"] : []),
      ...(client.assignedCoach ? ["coach_assigned"] : []),
    ];

    const after = await syncClientLifecycleTags(client, { milestones });
    if (!after) continue;

    const beforeTags = [...(before.tags || [])].sort();
    const afterTags = [...(after.tags || [])].sort();
    if (JSON.stringify(beforeTags) !== JSON.stringify(afterTags)) changed += 1;
  }

  return { matched: clients.length, changed };
}

export async function backfillCrmLifecycleTags() {
  // These passes touch the same CRM contact tag arrays, so run them in order.
  // Milestones first, then current sales stage, then activated-client state.
  const milestones = await backfillCrmStageMilestones();
  const currentStages = await backfillCurrentCrmStageTags();
  const clients = await backfillActivatedClientTags();

  return {
    milestones,
    currentStages,
    clients,
    changed:
      milestones.changed +
      currentStages.changed +
      clients.changed,
  };
}

// Backward-compatible export used by server startup.
export const backfillQualifiedLeadMilestones = backfillCrmLifecycleTags;
