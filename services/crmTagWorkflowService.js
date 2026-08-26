import WorkflowDefinition from "../models/WorkflowDefinition.js";
import { executeWorkflow } from "./workflowService.js";
import { resolveCrmTagKey } from "./crmTagService.js";

const MAX_TAG_EVENTS_PER_CONTACT_WINDOW = 20;
const TAG_EVENT_WINDOW_MS = 5000;
const contactEventWindows = new Map();

function asString(value = "") {
  return String(value ?? "").trim();
}

function allowTagEvent(contactId) {
  const key = String(contactId || "");
  const now = Date.now();
  const recent = (contactEventWindows.get(key) || []).filter(
    (time) => now - time < TAG_EVENT_WINDOW_MS
  );

  if (recent.length >= MAX_TAG_EVENTS_PER_CONTACT_WINDOW) {
    contactEventWindows.set(key, recent);
    return false;
  }

  recent.push(now);
  contactEventWindows.set(key, recent);
  return true;
}

async function workflowTagMatches(configuredTag, eventTag, change) {
  const requested = asString(configuredTag);
  if (!requested) return true;

  try {
    const resolved = await resolveCrmTagKey(requested, {
      activeOnly: change === "added",
    });
    return resolved === eventTag;
  } catch {
    return requested.toLowerCase() === String(eventTag || "").toLowerCase();
  }
}

export async function dispatchCrmTagChange({
  contact,
  tag,
  change,
  actorUserId,
  actorName,
}) {
  const contactId = contact?._id || contact;
  if (!contactId || !tag || !["added", "removed"].includes(change)) return [];

  if (!allowTagEvent(contactId)) {
    console.error(
      `CRM tag workflow safety stop for contact ${contactId}: too many tag events in ${TAG_EVENT_WINDOW_MS}ms.`
    );
    return [];
  }

  const workflows = await WorkflowDefinition.find({
    status: "active",
    "trigger.type": "crm_tag_changed",
  });

  const results = [];

  for (const workflow of workflows) {
    const config = workflow.trigger?.config || {};
    const configuredChange = asString(config.change || "either").toLowerCase();

    if (
      configuredChange &&
      configuredChange !== "either" &&
      configuredChange !== change
    ) {
      continue;
    }

    if (!(await workflowTagMatches(config.tag, tag, change))) continue;

    try {
      results.push(
        await executeWorkflow(workflow, {
          type: "crm_tag_changed",
          eventKey: `crm_tag_changed:${contactId}:${tag}:${change}:${Date.now()}`,
          contactId,
          actorUserId,
          actorName,
          data: {
            tag,
            change,
          },
        })
      );
    } catch (error) {
      console.error(`Tag workflow ${workflow.name} failed:`, error.message);
      results.push({ error });
    }
  }

  return results;
}
