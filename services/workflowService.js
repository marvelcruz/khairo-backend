import { resolveCrmTagKey } from "./crmTagService.js";
import { PROGRAM_VALUES } from "../utils/programTaxonomy.js";
import mongoose from "mongoose";
import Application from "../models/Application.js";
import Client from "../models/Client.js";
import ClientMessage from "../models/ClientMessage.js";
import CrmActivity from "../models/CrmActivity.js";
import CrmContact from "../models/CrmContact.js";
import CrmOpportunity, { CRM_STAGE_VALUES } from "../models/CrmOpportunity.js";
import CrmTag from "../models/CrmTag.js";
import FormDefinition from "../models/FormDefinition.js";
import User from "../models/User.js";
import WorkflowDefinition, {
  WORKFLOW_ACTION_TYPES,
  WORKFLOW_TRIGGER_TYPES,
} from "../models/WorkflowDefinition.js";
import WorkflowRun from "../models/WorkflowRun.js";
import { addCrmActivity, ensureOpenOpportunity } from "./crmService.js";
import { isEmailConfigured, sendEmail } from "../utils/mailer.js";
import { isPushConfigured, sendPushToUser } from "./pushService.js";

const PROGRAMS = PROGRAM_VALUES;
const MAX_TEMPLATE_LENGTH = 5000;

function asString(value = "") {
  return String(value ?? "").trim();
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function normalizeDays(value, label) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 365) {
    throw new Error(`${label} must be a whole number between 0 and 365.`);
  }
  return parsed;
}

function validateObjectId(value, label) {
  if (!mongoose.isValidObjectId(value)) throw new Error(`${label} is invalid.`);
  return String(value);
}

function validateTagFilter(value, label) {
  if (value === undefined || value === null || value === "") return;
  const tag = asString(value);
  if (!tag || tag.length > 60) throw new Error(`${label} must be 1–60 characters.`);
}

export function validateWorkflowInput(payload = {}) {
  const name = asString(payload.name);
  if (!name) throw new Error("Workflow name is required.");
  if (name.length > 160) throw new Error("Workflow name is too long.");

  const description = asString(payload.description);
  if (description.length > 800) throw new Error("Workflow description is too long.");

  const mode = ["live", "test"].includes(payload.mode) ? payload.mode : "live";
  const isTemplate = Boolean(payload.isTemplate);
  const templateCategory = asString(payload.templateCategory).slice(0, 80);

  const trigger = asObject(payload.trigger);
  if (!WORKFLOW_TRIGGER_TYPES.includes(trigger.type)) throw new Error("Choose a valid workflow trigger.");
  const triggerConfig = asObject(trigger.config);

  if (trigger.type === "crm_stage_changed") {
    if (triggerConfig.toStage && !CRM_STAGE_VALUES.includes(triggerConfig.toStage)) throw new Error("Choose a valid destination CRM stage.");
    if (triggerConfig.fromStage && !CRM_STAGE_VALUES.includes(triggerConfig.fromStage)) throw new Error("Choose a valid starting CRM stage.");
  }

  if (trigger.type === "crm_tag_changed") {
    validateTagFilter(triggerConfig.tag, "Tag-change trigger tag");
    const change = asString(triggerConfig.change || "either").toLowerCase();
    if (!["either", "added", "removed"].includes(change)) {
      throw new Error("Tag-change trigger must use added, removed, or either.");
    }
  }

  validateTagFilter(triggerConfig.requiredTag, "Required tag filter");
  validateTagFilter(triggerConfig.excludedTag, "Excluded tag filter");

  if (trigger.type === "form_submitted" && triggerConfig.formId) {
    validateObjectId(triggerConfig.formId, "Form filter");
  }
  if (trigger.type === "form_submitted" && triggerConfig.allowedCurrentStages !== undefined) {
    if (!Array.isArray(triggerConfig.allowedCurrentStages)) {
      throw new Error("Allowed current stages must be an array.");
    }
    for (const stage of triggerConfig.allowedCurrentStages) {
      if (!CRM_STAGE_VALUES.includes(stage)) {
        throw new Error("Choose valid allowed current CRM stages.");
      }
    }
  }
  if (["crm_lead_created", "application_submitted", "client_activated"].includes(trigger.type) && triggerConfig.programInterest && !PROGRAMS.includes(triggerConfig.programInterest)) {
    throw new Error("Choose a valid program filter.");
  }

  const actions = Array.isArray(payload.actions) ? payload.actions : [];
  if (!actions.length) throw new Error("Add at least one workflow action.");
  if (actions.length > 12) throw new Error("A workflow can contain up to 12 actions.");

  const normalizedActions = actions.map((item, index) => {
    const action = asObject(item);
    if (!WORKFLOW_ACTION_TYPES.includes(action.type)) throw new Error(`Action ${index + 1} has an invalid type.`);
    const config = asObject(action.config);

    if (action.type === "add_note") {
      const body = asString(config.body);
      if (!body) throw new Error(`Action ${index + 1}: note text is required.`);
      if (body.length > MAX_TEMPLATE_LENGTH) throw new Error(`Action ${index + 1}: note text is too long.`);
    }
    if (action.type === "create_task") {
      const body = asString(config.body);
      if (!body) throw new Error(`Action ${index + 1}: task details are required.`);
      if (body.length > MAX_TEMPLATE_LENGTH) throw new Error(`Action ${index + 1}: task details are too long.`);
      normalizeDays(config.dueInDays ?? 1, `Action ${index + 1}: task due days`);
    }
    if (action.type === "set_stage") {
      if (!CRM_STAGE_VALUES.includes(config.stage)) throw new Error(`Action ${index + 1}: choose a valid CRM stage.`);
    }
    if (action.type === "set_follow_up") {
      normalizeDays(config.daysFromNow ?? 1, `Action ${index + 1}: follow-up days`);
      const hour = Number(config.hour ?? 10);
      if (!Number.isInteger(hour) || hour < 0 || hour > 23) throw new Error(`Action ${index + 1}: follow-up hour must be 0–23.`);
    }
    if (action.type === "assign_owner") {
      validateObjectId(config.userId, `Action ${index + 1}: assignee`);
    }
    if (action.type === "add_tag" || action.type === "remove_tag") {
      const tag = asString(config.tag);
      if (!tag || tag.length > 60) throw new Error(`Action ${index + 1}: tag must be 1–60 characters.`);
    }
    if (action.type === "send_email") {
      const subject = asString(config.subject);
      const body = asString(config.body);
      if (!subject) throw new Error(`Action ${index + 1}: email subject is required.`);
      if (subject.length > 180) throw new Error(`Action ${index + 1}: email subject is too long.`);
      if (!body) throw new Error(`Action ${index + 1}: email body is required.`);
      if (body.length > MAX_TEMPLATE_LENGTH) throw new Error(`Action ${index + 1}: email body is too long.`);
    }
    if (action.type === "wait") {
  const durationMinutes = Number(config.durationMinutes);
  if (!Number.isInteger(durationMinutes) || durationMinutes < 1 || durationMinutes > 10080) {
    throw new Error(`Action ${index + 1}: wait duration must be 1-10080 minutes.`);
  }
}
if (action.type === "send_portal_message") {
      const body = asString(config.body);
      if (!body) throw new Error(`Action ${index + 1}: portal message is required.`);
      if (body.length > 3000) throw new Error(`Action ${index + 1}: portal message is too long.`);
    }

    const condition = action.condition ? asObject(action.condition) : {};
    const retryConfig = action.retry ? asObject(action.retry) : {};
    const maxAttempts = Number.isInteger(retryConfig.maxAttempts)
      ? Math.min(3, Math.max(1, retryConfig.maxAttempts))
      : 1;
    const delayMinutes = Number.isInteger(retryConfig.delayMinutes)
      ? Math.min(60, Math.max(0, retryConfig.delayMinutes))
      : 0;

    if (retryConfig.maxAttempts !== undefined && String(retryConfig.maxAttempts) !== String(maxAttempts)) {
      throw new Error(`Action ${index + 1}: retry attempts must be between 1 and 3.`);
    }
    if (retryConfig.delayMinutes !== undefined && String(retryConfig.delayMinutes) !== String(delayMinutes)) {
      throw new Error(`Action ${index + 1}: retry delay must be between 0 and 60 minutes.`);
    }

    if (condition.requiredTags !== undefined) {
      if (!Array.isArray(condition.requiredTags)) throw new Error(`Action ${index + 1}: requiredTags must be an array.`);
      if (condition.requiredTags.length > 8) throw new Error(`Action ${index + 1}: use no more than 8 requiredTags.`);
      for (const tag of condition.requiredTags) {
        validateTagFilter(tag, `Action ${index + 1}: requiredTags tag`);
      }
    }

    if (condition.excludedTags !== undefined) {
      if (!Array.isArray(condition.excludedTags)) throw new Error(`Action ${index + 1}: excludedTags must be an array.`);
      if (condition.excludedTags.length > 8) throw new Error(`Action ${index + 1}: use no more than 8 excludedTags.`);
      for (const tag of condition.excludedTags) {
        validateTagFilter(tag, `Action ${index + 1}: excludedTags tag`);
      }
    }

    if (condition.programInterest !== undefined && !PROGRAMS.includes(condition.programInterest)) {
      throw new Error(`Action ${index + 1}: choose a valid program condition.`);
    }

    if (condition.stage !== undefined && !CRM_STAGE_VALUES.includes(condition.stage)) {
      throw new Error(`Action ${index + 1}: choose a valid CRM stage condition.`);
    }

    return {
      type: action.type,
      config,
      ...(Object.keys(condition).length ? { condition } : {}),
      ...(maxAttempts > 1 || delayMinutes > 0
        ? {
            retry: {
              maxAttempts,
              delayMinutes,
            },
          }
        : {}),
    };
  });

  return {
    name,
    description,
    mode,
    isTemplate,
    ...(templateCategory ? { templateCategory } : {}),
    trigger: { type: trigger.type, config: triggerConfig },
    actions: normalizedActions,
  };
}

function triggerMatches(workflow, event) {
  const config = asObject(workflow.trigger?.config);
  const data = asObject(event.data);
  if (workflow.trigger?.type !== event.type) return false;

  if (event.type === "crm_stage_changed") {
    if (config.toStage && config.toStage !== data.toStage) return false;
    if (config.fromStage && config.fromStage !== data.fromStage) return false;
  }

  if (event.type === "crm_tag_changed") {
    const configuredTag = asString(config.tag).toLowerCase();
    const eventTag = asString(data.tag).toLowerCase();
    const change = asString(config.change || "either").toLowerCase();
    if (configuredTag && configuredTag !== eventTag) return false;
    if (change !== "either" && change !== asString(data.change).toLowerCase()) return false;
  }

  if (event.type === "form_submitted" && config.formId && String(config.formId) !== String(event.formId || data.formId || "")) return false;
  if (config.programInterest && config.programInterest !== data.programInterest) return false;
  if (event.type === "crm_lead_created" && config.source && asString(config.source).toLowerCase() !== asString(data.source).toLowerCase()) return false;
  return true;
}

async function resolveContext(event) {
  let contact = null;
  let opportunity = null;

  if (event.contactId && mongoose.isValidObjectId(event.contactId)) {
    contact = await CrmContact.findOne({ _id: event.contactId, isArchived: false });
  }
  if (!contact && event.applicationId && mongoose.isValidObjectId(event.applicationId)) {
    contact = await CrmContact.findOne({ application: event.applicationId, isArchived: false });
  }
  if (!contact && event.clientId && mongoose.isValidObjectId(event.clientId)) {
    contact = await CrmContact.findOne({ client: event.clientId, isArchived: false });
  }
  if (!contact && event.entityType === "crm_contact" && mongoose.isValidObjectId(event.entityId)) {
    contact = await CrmContact.findOne({ _id: event.entityId, isArchived: false });
  }
  if (!contact && event.entityType === "application" && mongoose.isValidObjectId(event.entityId)) {
    contact = await CrmContact.findOne({ application: event.entityId, isArchived: false });
  }
  if (!contact && event.entityType === "client" && mongoose.isValidObjectId(event.entityId)) {
    contact = await CrmContact.findOne({ client: event.entityId, isArchived: false });
  }

  if (event.opportunityId && mongoose.isValidObjectId(event.opportunityId)) {
    opportunity = await CrmOpportunity.findById(event.opportunityId);
  }
  if (!opportunity && contact) {
    opportunity = await ensureOpenOpportunity(contact, { createdBy: event.actorUserId, reopen: contact.lifecycleStage !== "client" });
  }

  return { contact, opportunity };
}

async function resolveConfiguredTag(value, { activeOnly = false } = {}) {
  const requested = asString(value);
  if (!requested) return "";
  try {
    return await resolveCrmTagKey(requested, { activeOnly });
  } catch {
    return requested.toLowerCase();
  }
}

async function contextTagFiltersMatch(triggerConfig, contact) {
  if (!contact) return true;
  const tags = new Set(contact.tags || []);

  const requiredTag = await resolveConfiguredTag(triggerConfig.requiredTag, {
    activeOnly: false,
  });
  if (requiredTag && !tags.has(requiredTag)) return false;

  const excludedTag = await resolveConfiguredTag(triggerConfig.excludedTag, {
    activeOnly: false,
  });
  if (excludedTag && tags.has(excludedTag)) return false;

  return true;
}

async function actionConditionMatches(condition, context) {
  const config = asObject(condition);
  if (!Object.keys(config).length) return true;

  const contact = context.contact;
  const opportunity = context.opportunity;
  const data = asObject(context.event.data);

  const requiredTags = Array.isArray(config.requiredTags) ? config.requiredTags : [];
  const excludedTags = Array.isArray(config.excludedTags) ? config.excludedTags : [];
  const tags = new Set(contact?.tags || []);

  for (const raw of requiredTags) {
    const tag = await resolveConfiguredTag(raw, { activeOnly: false });
    if (tag && !tags.has(tag)) return false;
  }

  for (const raw of excludedTags) {
    const tag = await resolveConfiguredTag(raw, { activeOnly: false });
    if (tag && tags.has(tag)) return false;
  }

  if (config.programInterest) {
    const program =
      contact?.programInterest ||
      data.programInterest ||
      opportunity?.programInterest ||
      "";
    if (String(program).toLowerCase() !== String(config.programInterest).toLowerCase()) {
      return false;
    }
  }

  if (config.stage) {
    const currentStage = opportunity?.stage || data.toStage || "";
    if (String(currentStage).toLowerCase() !== String(config.stage).toLowerCase()) {
      return false;
    }
  }

  return true;
}

function templateValues({ event, contact, opportunity }) {
  const data = asObject(event.data);
  return {
    "contact.name": contact?.fullName || "",
    "contact.email": contact?.email || "",
    "contact.phone": contact?.phone || "",
    "contact.program": contact?.programInterest || data.programInterest || "",
    "contact.tags": (contact?.tags || []).join(", "),
    "opportunity.stage": opportunity?.stage || data.toStage || "",
    "stage.from": data.fromStage || "",
    "stage.to": data.toStage || "",
    "tag.name": data.tag || "",
    "tag.change": data.change || "",
    "form.name": data.formName || "",
    "application.name": data.applicationName || contact?.fullName || "",
    "client.name": data.clientName || contact?.fullName || "",
  };
}

function renderTemplate(value, context) {
  const map = templateValues(context);
  return asString(value).replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (_, key) => (key in map ? String(map[key]) : ""));
}

function nextLocalDate(daysFromNow, hour = 10) {
  const result = new Date();
  result.setDate(result.getDate() + daysFromNow);
  result.setHours(hour, 0, 0, 0);
  return result;
}

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function executeAction(action, context, workflow) {
  const { event, contact, opportunity } = context;
  const config = asObject(action.config);
  const requiresCrm = ["add_note", "create_task", "set_stage", "set_follow_up", "assign_owner", "add_tag", "remove_tag", "send_email", "send_portal_message", "notify_staff"].includes(action.type);
  if (requiresCrm && !contact) {
    throw new Error("This action needs a linked CRM contact, but the trigger did not resolve one.");
  }
  const requiresOpportunity = ["add_note", "create_task", "set_stage", "set_follow_up", "assign_owner"].includes(action.type);
  if (requiresOpportunity && !opportunity) {
    throw new Error("This action needs a linked CRM opportunity, but the trigger did not resolve one.");
  }

  if (action.type === "add_note") {
    const body = renderTemplate(config.body, context);
    await addCrmActivity({
      contact,
      opportunity,
      type: "note",
      subject: asString(config.subject) || `Workflow: ${workflow.name}`,
      body,
      assignedTo: contact.assignedTo,
      createdBy: event.actorUserId,
      metadata: { workflowId: String(workflow._id), workflowName: workflow.name },
    });
    return `Added CRM note: ${body.slice(0, 120)}`;
  }

  if (action.type === "create_task") {
    const days = normalizeDays(config.dueInDays ?? 1, "Task due days");
    const dueAt = nextLocalDate(days, Number(config.hour ?? 10));
    const body = renderTemplate(config.body, context);
    await addCrmActivity({
      contact,
      opportunity,
      type: "task",
      subject: asString(config.subject) || `Workflow task: ${workflow.name}`,
      body,
      dueAt,
      assignedTo: opportunity.assignedTo || contact.assignedTo,
      createdBy: event.actorUserId,
      metadata: { workflowId: String(workflow._id), workflowName: workflow.name },
    });
    return `Created CRM task due ${dueAt.toISOString()}`;
  }

  if (action.type === "set_stage") {
    const stage = config.stage;
    if (!CRM_STAGE_VALUES.includes(stage)) throw new Error("Workflow stage action is invalid.");
    const previous = opportunity.stage;

    if (previous !== stage) opportunity.stageEnteredAt = new Date();
    opportunity.stage = stage;

    if (stage === "lost") {
      opportunity.status = "lost";
      opportunity.closedAt = new Date();
    } else if (opportunity.status === "lost") {
      opportunity.status = "open";
      opportunity.closedAt = undefined;
      opportunity.lostReason = "";
    }
    opportunity.updatedBy = event.actorUserId;
    await opportunity.save();
    if (previous !== stage) {
      await addCrmActivity({
        contact,
        opportunity,
        type: "stage_change",
        subject: "Pipeline stage changed by workflow",
        body: `Stage moved from ${previous} to ${stage} by ${workflow.name}.`,
        createdBy: event.actorUserId,
        metadata: { from: previous, to: stage, workflowId: String(workflow._id) },
      });
    }
    return previous === stage ? `CRM stage already ${stage}` : `Moved CRM stage ${previous} → ${stage}`;
  }

  if (action.type === "set_follow_up") {
    const days = normalizeDays(config.daysFromNow ?? 1, "Follow-up days");
    const followUp = nextLocalDate(days, Number(config.hour ?? 10));
    opportunity.nextFollowUpAt = followUp;
    opportunity.updatedBy = event.actorUserId;
    await opportunity.save();
    return `Set follow-up for ${followUp.toISOString()}`;
  }

  if (action.type === "assign_owner") {
    const userId = validateObjectId(config.userId, "Assignee");
    const user = await User.findOne({ _id: userId, isActive: true }).select("name roles");
    if (!user) throw new Error("Workflow assignee no longer exists or is inactive.");
    contact.assignedTo = user._id;
    contact.updatedBy = event.actorUserId;
    await contact.save();
    opportunity.assignedTo = user._id;
    opportunity.updatedBy = event.actorUserId;
    await opportunity.save();
    return `Assigned CRM record to ${user.name}`;
  }

  if (action.type === "add_tag") {
    const requested = asString(config.tag);
    if (!requested) throw new Error("Workflow tag is empty.");
    const tag = await resolveCrmTagKey(requested, { activeOnly: true });
    const existed = contact.tags.includes(tag);
    if (!existed) {
      contact.tags.push(tag);
      contact.updatedBy = event.actorUserId;
      await contact.save();
    }
    return existed ? `CRM tag already present: ${tag}` : `Added CRM tag: ${tag}`;
  }

  if (action.type === "remove_tag") {
    const requested = asString(config.tag);
    if (!requested) throw new Error("Workflow tag is empty.");
    const tag = await resolveCrmTagKey(requested, { activeOnly: false });
    const existed = contact.tags.includes(tag);
    if (existed) {
      contact.tags = contact.tags.filter((value) => value !== tag);
      contact.updatedBy = event.actorUserId;
      await contact.save();
    }
    return existed ? `Removed CRM tag: ${tag}` : `CRM tag was not present: ${tag}`;
  }

  if (action.type === "send_email") {
    if (!contact.email) throw new Error("CRM contact does not have an email address.");
    if (!isEmailConfigured()) throw new Error("Email is not configured.");
    const subject = renderTemplate(config.subject, context);
    const body = renderTemplate(config.body, context);
    const html = `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;line-height:1.6;color:#18181b;white-space:pre-wrap;">${escapeHtml(body)}</div>`;
    await sendEmail({ to: contact.email, subject, html, text: body });
    await CrmActivity.create({
      contact: contact._id,
      opportunity: opportunity?._id,
      type: "email",
      subject,
      body,
      createdBy: event.actorUserId,
      metadata: { workflowId: String(workflow._id), workflowName: workflow.name, automated: true },
    });
    return `Sent workflow email to ${contact.email}`;
  }

  if (action.type === "send_portal_message") {
    if (!contact.client || !mongoose.isValidObjectId(contact.client)) {
      throw new Error("CRM contact is not linked to a Khairo Diet Clinic client portal account.");
    }
    const client = await Client.findOne({ _id: contact.client, isArchived: { $ne: true } }).select("_id portalActive").lean();
    if (!client || client.portalActive !== true) {
      throw new Error("Linked client portal is not active.");
    }
    const body = renderTemplate(config.body, context);
    const category = ["general", "plan", "appointment", "billing", "technical", "help"].includes(config.category)
      ? config.category
      : "general";
    await ClientMessage.create({
      client: client._id,
      senderType: "staff",
      senderName: asString(config.senderName) || "Khairo Diet Clinic Team",
      category,
      body,
      readByClient: false,
      readByStaff: true,
    });
    return "Sent workflow portal message";
  }

  if (action.type === "notify_staff") {
    const recipientId = config.userId
      ? validateObjectId(config.userId, "Notification recipient")
      : opportunity?.assignedTo || contact.assignedTo;

    if (!recipientId) {
      throw new Error("This notification needs a recipient, but no owner or specific staff member is assigned.");
    }

    const user = await User.findOne({ _id: recipientId, isActive: true }).select("_id name email");
    if (!user) throw new Error("The notification recipient no longer exists or is inactive.");

    const subject = renderTemplate(asString(config.subject) || `Workflow: ${workflow.name}`, context);
    const body = renderTemplate(config.body, context);
    const delivery = { push: "skipped", email: "skipped" };

    if (isPushConfigured()) {
      try {
        const pushResult = await sendPushToUser(user._id, {
          title: subject,
          body,
          url: `/dashboard/crm${contact ? `?contact=${contact._id}` : ""}`,
        });
        delivery.push = pushResult.delivered > 0 ? "delivered" : "not_delivered";
      } catch (error) {
        delivery.push = "failed";
      }
    }

    if (user.email && isEmailConfigured()) {
      try {
        await sendEmail({
          to: user.email,
          subject,
          text: body,
          html: `<div style="font-family:sans-serif;line-height:1.6;color:#18181b;white-space:pre-wrap;">${escapeHtml(body)}</div>`,
        });
        delivery.email = "delivered";
      } catch (error) {
        delivery.email = "failed";
      }
    }

    if (delivery.push === "skipped" && delivery.email === "skipped") {
      throw new Error("No notification channel could be used. Configure email or push notifications.");
    }

    return `Staff notification sent to ${user.name}: push=${delivery.push}, email=${delivery.email}`;
  }

  throw new Error(`Unsupported workflow action ${action.type}.`);
}

async function createRun(workflow, event, context) {
  const doc = {
    workflow: workflow._id,
    workflowName: workflow.name,
    triggerType: event.type,
    ...(asString(event.eventKey) ? { eventKey: asString(event.eventKey) } : {}),
    contact: context.contact?._id,
    opportunity: context.opportunity?._id,
    application: event.applicationId,
    client: event.clientId,
    form: event.formId,
    submission: event.submissionId,
    actorUser: event.actorUserId,
    actorName: asString(event.actorName) || "System",
    eventSnapshot: asObject(event.data),
    status: "running",
    startedAt: new Date(),
  };
  try {
    return await WorkflowRun.create(doc);
  } catch (error) {
    if (error?.code === 11000 && doc.eventKey) return null;
    throw error;
  }
}

async function sendWorkflowFailureAlert(workflow, run) {
  const to = process.env.ADMIN_EMAIL || process.env.SEED_ADMIN_EMAIL;
  if (!to || !isEmailConfigured()) return;

  const failures = (run.steps || []).filter(
    (step) => step.status === "failed"
  );
  if (!failures.length) return;

  const failedText = failures
    .map((step) => `- ${step.actionType}: ${step.message}`)
    .join("\n");

  try {
    await sendEmail({
      to,
      subject: `Khairo Diet Clinic workflow failed: ${workflow.name}`,
      text: `Workflow "${workflow.name}" finished with status ${run.status}.\n\nFailed steps:\n${failedText}`,
      html: `<div style="font-family:sans-serif;background:#0a0a0a;padding:24px;color:#f5f5f5;"><div style="max-width:520px;margin:0 auto;background:#171717;border:1px solid #7f1d1d;border-radius:10px;padding:24px;"><h2 style="margin:0 0 8px;color:#fca5a5;">Workflow failed: ${workflow.name}</h2><p style="margin:0 0 12px;">Run ID: <strong>${run._id}</strong></p><ul style="padding-left:18px;margin:0;">${failures.map((step) => `<li style="margin-bottom:6px;"><strong>${step.actionType}</strong>: ${step.message}</li>`).join("")}</ul></div></div>`,
    });
  } catch (error) {
    console.error("Workflow failure alert email failed:", error?.message || error);
  }
}

export async function executeWorkflow(workflow, event, options = {}) {
  const context = await resolveContext(event);
  const triggerConfig = asObject(workflow.trigger?.config);

  if (!(await contextTagFiltersMatch(triggerConfig, context.contact))) {
    return { skipped: true, reason: "tag_filter_not_matched" };
  }

  const allowedCurrentStages = Array.isArray(triggerConfig.allowedCurrentStages)
    ? triggerConfig.allowedCurrentStages
    : [];

  if (
    allowedCurrentStages.length &&
    context.opportunity &&
    !allowedCurrentStages.includes(context.opportunity.stage)
  ) {
    return {
      skipped: true,
      reason: "current_stage_not_allowed",
      currentStage: context.opportunity.stage,
    };
  }

  const resumeRun = options.resumeRun || null;
  let run;
  let steps = [];
  let startIndex = 0;

  if (resumeRun) {
    run = resumeRun;
    steps = Array.isArray(run.steps) ? [...run.steps] : [];
    startIndex = Number(run.currentActionIndex || 0) + 1;
  } else {
    run = await createRun(workflow, event, context);
    if (!run) return { skipped: true, reason: "duplicate_event" };
    steps = [];
    startIndex = 0;
  }

  let failed = 0;

  for (let actionIndex = startIndex; actionIndex < (workflow.actions || []).length; actionIndex += 1) {
    const action = workflow.actions[actionIndex];

    if (action.type === "wait") {
      if (!resumeRun) {
        const durationMinutes = Number(asObject(action.config).durationMinutes);
        const safeMinutes = Math.min(10080, Math.max(1, durationMinutes || 1));
        run.waitUntil = new Date(Date.now() + safeMinutes * 60 * 1000);
        run.currentActionIndex = actionIndex;
        run.steps = steps;
        run.status = "waiting";
        run.completedAt = undefined;
        await run.save();
        return { waiting: true, run, context };
      }
      continue;
    }

    if (workflow.mode === "test") {
      steps.push({
        actionId: String(action._id || ""),
        actionType: action.type,
        status: "skipped",
        message: "Test mode: action execution skipped",
      });
      continue;
    }

    const actionCondition = asObject(action.condition);

    if (
      Object.keys(actionCondition).length &&
      !(await actionConditionMatches(actionCondition, { event, ...context }))
    ) {
      steps.push({
        actionId: String(action._id || ""),
        actionType: action.type,
        status: "skipped",
        message: "Condition not matched",
      });
      continue;
    }

    const retry = asObject(action.retry);
    const maxAttempts = Math.min(
      3,
      Math.max(1, Number.isInteger(retry.maxAttempts) ? retry.maxAttempts : 1)
    );
    const delayMinutes = Math.min(
      60,
      Math.max(0, Number.isInteger(retry.delayMinutes) ? retry.delayMinutes : 0)
    );

    let lastError = null;
    let completed = false;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const message = await executeAction(action, { event, ...context }, workflow);
        steps.push({
          actionId: String(action._id || ""),
          actionType: action.type,
          status: "success",
          message,
        });
        completed = true;
        break;
      } catch (error) {
        lastError = error;
        if (attempt < maxAttempts && delayMinutes > 0) {
          await new Promise((resolve) => setTimeout(resolve, delayMinutes * 60 * 1000));
        }
      }
    }

    if (!completed) {
      failed += 1;
      steps.push({
        actionId: String(action._id || ""),
        actionType: action.type,
        status: "failed",
        message: lastError?.message || String(lastError || "Action failed"),
      });
    }
  }

  run.steps = steps;
  run.completedAt = new Date();
  run.status = failed === 0 ? "success" : failed === steps.length ? "failed" : "partial";
  run.error = failed ? steps.filter((step) => step.status === "failed").map((step) => step.message).join(" | ").slice(0, 3000) : "";
  run.waitUntil = undefined;
  await run.save();

  workflow.lastRunAt = run.completedAt;
  workflow.runCount = Number(workflow.runCount || 0) + 1;
  if (run.status === "success") workflow.successCount = Number(workflow.successCount || 0) + 1;
  else workflow.failureCount = Number(workflow.failureCount || 0) + 1;
  await workflow.save();

  if (run.status === "failed" || run.status === "partial") {
    await sendWorkflowFailureAlert(workflow, run);
  }

  return { run, context };
}

export async function resumeWaitingWorkflowRuns() {
  const now = new Date();
  const runs = await WorkflowRun.find({
    status: "waiting",
    waitUntil: { $lte: now },
  })
    .populate("workflow")
    .limit(50);

  const result = { scanned: runs.length, resumed: 0, failed: 0 };

  for (const run of runs) {
    const workflow = run.workflow;
    if (!workflow || workflow.status !== "active") continue;

    const event = {
      type: run.triggerType,
      contactId: run.contact,
      opportunityId: run.opportunity,
      applicationId: run.application,
      clientId: run.client,
      formId: run.form,
      submissionId: run.submission,
      actorUserId: run.actorUser,
      actorName: run.actorName,
      data: run.eventSnapshot || {},
    };

    try {
      const res = await executeWorkflow(workflow, event, { resumeRun: run });
      if (!res?.waiting) result.resumed += 1;
    } catch (error) {
      result.failed += 1;
      console.error(`Failed to resume waiting workflow run ${run._id}:`, error?.message || error);
    }
  }

  return result;
}

export async function dispatchWorkflowEvent(event) {
  if (!event || !WORKFLOW_TRIGGER_TYPES.includes(event.type) || event.type === "manual") return [];
  const workflows = await WorkflowDefinition.find({ status: "active", "trigger.type": event.type });
  const results = [];
  for (const workflow of workflows) {
    if (!triggerMatches(workflow, event)) continue;
    try {
      results.push(await executeWorkflow(workflow, event));
    } catch (error) {
      console.error(`Workflow ${workflow.name} failed:`, error.message);
      results.push({ error });
    }
  }
  return results;
}

export async function runManualWorkflow(workflow, { contactId, actorUserId, actorName }) {
  if (workflow.trigger?.type !== "manual") throw new Error("Only workflows with the Manual trigger can be run manually.");
  validateObjectId(contactId, "CRM contact");
  return executeWorkflow(workflow, {
    type: "manual",
    eventKey: `manual:${workflow._id}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
    contactId,
    actorUserId,
    actorName,
    data: { manual: true },
  });
}

export async function workflowReferenceData() {
  const [users, forms, tags] = await Promise.all([
    User.find({ isActive: true, roles: { $in: ["admin", "sales", "staff", "coach"] } }).select("name roles").sort({ name: 1 }).lean(),
    FormDefinition.find({}).select("name status visibility").sort({ name: 1 }).lean(),
    CrmTag.find({}).select("key name active category automationManaged automationRule").sort({ category: 1, name: 1 }).lean(),
  ]);
  return { users, forms, tags, stages: CRM_STAGE_VALUES };
}

export async function linkedEntitySnapshot(event) {
  const result = {};
  if (event.applicationId && mongoose.isValidObjectId(event.applicationId)) result.application = await Application.findById(event.applicationId).select("fullName email programInterest program status").lean();
  if (event.clientId && mongoose.isValidObjectId(event.clientId)) result.client = await Client.findById(event.clientId).select("fullName email program status reconciled").lean();
  return result;
}
