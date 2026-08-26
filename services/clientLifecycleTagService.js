import CrmContact from "../models/CrmContact.js";
import CrmTag from "../models/CrmTag.js";
import {
  automationTagDefinition,
  automationTagLifecycleMode,
  CLIENT_LIFECYCLE_MILESTONE_TAG_KEYS,
  CLIENT_ONBOARDING_TAG_KEYS,
  CLIENT_PROGRAM_TAG_KEYS,
  CLIENT_STATUS_TAG_KEYS,
  STAGE_MANAGED_TAG_KEYS,
} from "./crmTagAutomationPolicy.js";
import { dispatchCrmTagChange } from "./crmTagWorkflowService.js";

async function ensureTagDefinition(key) {
  const definition = automationTagDefinition(key);
  if (!definition) return;

  await CrmTag.findOneAndUpdate(
    { key },
    {
      $setOnInsert: {
        key,
        name: definition.name,
        normalizedName: definition.name.trim().toLowerCase(),
        category: definition.category,
        description: definition.description,
        active: true,
      },
      $set: {
        automationManaged: true,
        automationRule: definition.automationRule,
        lifecycleMode: automationTagLifecycleMode(key),
      },
    },
    {
      upsert: true,
      new: true,
      setDefaultsOnInsert: true,
    }
  );
}

function onboardingTagFor(client) {
  const onboarding = client?.onboarding || {};
  const values = [
    onboarding.loggedWeight === true,
    onboarding.tickedMeal === true,
    onboarding.bookedCall === true,
    onboarding.joinedGroup === true,
  ];

  const completed = values.filter(Boolean).length;
  if (completed === 0) return "onboarding_not_started";
  if (completed === values.length) return "onboarding_completed";
  return "onboarding_in_progress";
}

function programTagFor(client) {
  if (client?.program === "core") return "core_client";
  if (client?.program === "plus") return "plus_client";
  if (client?.program === "vip") return "vip_client";
  return null;
}

function statusTagFor(client) {
  if (client?.status === "active") return "active_client";
  if (client?.status === "paused") return "paused_client";
  if (client?.status === "completed") return "completed_client";
  if (client?.status === "cancelled") return "cancelled_client";
  return null;
}

export async function syncClientLifecycleTags(
  client,
  {
    milestones = [],
    actorUserId = undefined,
  } = {}
) {
  if (!client?._id) return null;

  const contact = await CrmContact.findOne({
    client: client._id,
    isArchived: false,
  });

  if (!contact) return null;

  const isActivatedClient =
    client.reconciled === true &&
    client.accountStage !== "preview";

  const desiredCurrent = isActivatedClient
    ? [
        programTagFor(client),
        statusTagFor(client),
        onboardingTagFor(client),
      ].filter(Boolean)
    : [];

  const requestedMilestones = milestones.filter((key) =>
    CLIENT_LIFECYCLE_MILESTONE_TAG_KEYS.includes(key)
  );

  const definitions = [...new Set([...desiredCurrent, ...requestedMilestones])];
  await Promise.all(definitions.map(ensureTagDefinition));

  const managedCurrent = new Set([
    ...(isActivatedClient ? STAGE_MANAGED_TAG_KEYS : []),
    ...CLIENT_PROGRAM_TAG_KEYS,
    ...CLIENT_STATUS_TAG_KEYS,
    ...CLIENT_ONBOARDING_TAG_KEYS,
  ]);

  const beforeTags = [...(contact.tags || [])];
  const nextTags = beforeTags.filter(
    (tag) => !managedCurrent.has(tag)
  );

  for (const tag of desiredCurrent) {
    if (!nextTags.includes(tag)) nextTags.push(tag);
  }

  for (const tag of requestedMilestones) {
    if (!nextTags.includes(tag)) nextTags.push(tag);
  }

  const before = [...beforeTags].sort();
  const after = [...nextTags].sort();

  if (JSON.stringify(before) === JSON.stringify(after)) {
    return contact;
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
      actorName: "System (client lifecycle)",
    });
  }

  for (const tag of added) {
    await dispatchCrmTagChange({
      contact,
      tag,
      change: "added",
      actorUserId,
      actorName: "System (client lifecycle)",
    });
  }

  return contact;
}
