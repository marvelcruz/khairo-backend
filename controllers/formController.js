import mongoose from "mongoose";
import Application from "../models/Application.js";
import Client from "../models/Client.js";
import CrmContact from "../models/CrmContact.js";
import CustomFieldDefinition from "../models/CustomFieldDefinition.js";
import FormDefinition from "../models/FormDefinition.js";
import FormSubmission from "../models/FormSubmission.js";
import { logAudit } from "../utils/auditLogger.js";
import { upsertCrmLead } from "../services/crmService.js";
import {
  hydrateForm,
  persistLinkedCustomValues,
  slugifyForm,
  validateAndNormalizeAnswers,
} from "../services/formService.js";
import { dispatchWorkflowEvent } from "../services/workflowService.js";

const ENTITY_MODELS = { crm_contact: CrmContact, application: Application, client: Client };
const VISIBILITIES = ["internal", "public"];
const STATUSES = ["draft", "published"];
const TARGETS = ["none", "crm_contact", "application", "client"];
const ACTIONS = ["submission_only", "create_crm_lead"];
const ELEMENT_KINDS = ["field", "heading", "paragraph"];
const STANDARD_KEYS = ["fullName", "firstName", "lastName", "email", "phone", "programInterest", "goals", "healthNotes", "startTimeline", "readyToSpeak"];

function rolesFor(user) { return user?.roles || (user?.role ? [user.role] : []); }
function hasPermission(user, permission) { return rolesFor(user).includes("admin") || (Array.isArray(user?.permissions) && user.permissions.includes(permission)); }
function permissionForEntity(entityType) { return { crm_contact: "view_crm", application: "view_requests", client: "view_clients" }[entityType]; }
function canSubmitForEntity(user, entityType) {
  if (rolesFor(user).includes("admin")) return true;
  const allowed = { crm_contact: ["sales"], application: ["sales"], client: ["coach"] };
  return (allowed[entityType] || []).some((role) => rolesFor(user).includes(role)) && hasPermission(user, permissionForEntity(entityType));
}

function standardLeadFullName(values = {}) {
  const legacy = String(values.fullName || "").trim();
  if (legacy) return legacy;
  return [String(values.firstName || "").trim(), String(values.lastName || "").trim()]
    .filter(Boolean).join(" ").trim();
}

function cleanElement(element = {}) {
  if (!ELEMENT_KINDS.includes(element.kind)) throw new Error("Invalid form element.");
  if (element.kind !== "field") {
    const text = String(element.text || element.label || "").trim();
    if (!text) throw new Error("Headings and instructions cannot be empty.");
    return { ...(mongoose.isValidObjectId(element._id) ? { _id: element._id } : {}), kind: element.kind, text };
  }
  if (!["standard", "custom"].includes(element.source)) throw new Error("Choose a valid field source.");
  if (element.source === "standard" && !STANDARD_KEYS.includes(element.standardKey)) throw new Error("Invalid standard field.");
  if (element.source === "custom" && !mongoose.isValidObjectId(element.customField)) throw new Error("Invalid custom field.");
  return {
    ...(mongoose.isValidObjectId(element._id) ? { _id: element._id } : {}),
    kind: "field",
    source: element.source,
    ...(element.source === "standard" ? { standardKey: element.standardKey } : { customField: element.customField }),
    label: String(element.label || "").trim().slice(0, 160),
    helpText: String(element.helpText || "").trim().slice(0, 500),
    placeholder: String(element.placeholder || "").trim().slice(0, 200),
    required: Boolean(element.required),
  };
}

async function normalizeElements(elements = [], targetEntityType = "none") {
  if (!Array.isArray(elements)) throw new Error("Form fields must be an array.");
  if (elements.length > 80) throw new Error("A form can contain up to 80 elements.");
  const cleaned = elements.map(cleanElement);
  const customIds = cleaned.filter((e) => e.kind === "field" && e.source === "custom").map((e) => e.customField);
  if (customIds.length) {
    const customQuery = { _id: { $in: customIds }, active: true };
    if (targetEntityType !== "none") customQuery.entityTypes = targetEntityType;
    const found = await CustomFieldDefinition.countDocuments(customQuery);
    if (found !== new Set(customIds.map(String)).size) throw new Error(targetEntityType === "none" ? "One or more custom fields are unavailable." : "One or more custom fields are not available for this record type.");
  }
  return cleaned;
}

async function uniqueSlug(input, excludeId) {
  const base = slugifyForm(input);
  let slug = base;
  let suffix = 2;
  while (await FormDefinition.exists({ slug, ...(excludeId ? { _id: { $ne: excludeId } } : {}) })) {
    slug = `${base.slice(0, 74)}-${suffix++}`;
  }
  return slug;
}

async function assertEntity(entityType, entityId) {
  const Model = ENTITY_MODELS[entityType];
  if (!Model || !mongoose.isValidObjectId(entityId)) return false;
  return Boolean(await Model.exists({ _id: entityId }));
}

export async function listForms(req, res, next) {
  try {
    const forms = await FormDefinition.aggregate([
      { $sort: { updatedAt: -1 } },
      { $lookup: { from: "formsubmissions", localField: "_id", foreignField: "form", as: "submissions" } },
      { $addFields: { submissionCount: { $size: "$submissions" } } },
      { $project: { submissions: 0 } },
    ]);
    res.json({ success: true, forms });
  } catch (err) { next(err); }
}

export async function getForm(req, res, next) {
  try {
    const form = await FormDefinition.findById(req.params.id);
    if (!form) return res.status(404).json({ success: false, message: "Form not found." });
    res.json({ success: true, form: await hydrateForm(form) });
  } catch (err) { next(err); }
}

export async function createForm(req, res, next) {
  try {
    const {
      name, description = "", visibility = "internal", targetEntityType = "none",
      publicAction = "submission_only", submitLabel = "Submit", confirmationTitle = "Thank you",
      confirmationMessage = "Your response has been received.", elements = [],
    } = req.body;
    if (!String(name || "").trim()) return res.status(400).json({ success: false, message: "Form name is required." });
    if (!VISIBILITIES.includes(visibility) || !TARGETS.includes(targetEntityType) || !ACTIONS.includes(publicAction)) {
      return res.status(400).json({ success: false, message: "Invalid form settings." });
    }
    if (publicAction === "create_crm_lead" && targetEntityType !== "crm_contact") {
      return res.status(400).json({ success: false, message: "CRM lead creation requires CRM contacts as the target record." });
    }
    const form = await FormDefinition.create({
      name: String(name).trim(),
      slug: await uniqueSlug(req.body.slug || name),
      description, visibility, targetEntityType, publicAction, submitLabel,
      confirmationTitle, confirmationMessage,
      elements: await normalizeElements(elements, targetEntityType),
      createdBy: req.user._id, updatedBy: req.user._id,
    });
    await logAudit(req, "Created form", "FormDefinition", form._id.toString(), form.name);
    res.status(201).json({ success: true, form: await hydrateForm(form) });
  } catch (err) { next(err); }
}

export async function updateForm(req, res, next) {
  try {
    const form = await FormDefinition.findById(req.params.id);
    if (!form) return res.status(404).json({ success: false, message: "Form not found." });
    const editable = ["name", "description", "visibility", "targetEntityType", "publicAction", "submitLabel", "confirmationTitle", "confirmationMessage"];
    for (const key of editable) if (req.body[key] !== undefined) form[key] = req.body[key];
    if (!VISIBILITIES.includes(form.visibility) || !TARGETS.includes(form.targetEntityType) || !ACTIONS.includes(form.publicAction)) {
      return res.status(400).json({ success: false, message: "Invalid form settings." });
    }
    if (form.publicAction === "create_crm_lead" && form.targetEntityType !== "crm_contact") {
      return res.status(400).json({ success: false, message: "CRM lead creation requires CRM contacts as the target record." });
    }
    if (req.body.slug !== undefined) form.slug = await uniqueSlug(req.body.slug || form.name, form._id);
    form.elements = await normalizeElements(req.body.elements !== undefined ? req.body.elements : form.elements, form.targetEntityType);
    form.updatedBy = req.user._id;
    await form.save();
    await logAudit(req, "Updated form", "FormDefinition", form._id.toString(), form.name);
    res.json({ success: true, form: await hydrateForm(form) });
  } catch (err) { next(err); }
}

export async function setFormStatus(req, res, next) {
  try {
    const form = await FormDefinition.findById(req.params.id);
    if (!form) return res.status(404).json({ success: false, message: "Form not found." });
    const status = req.body.status;
    if (!STATUSES.includes(status)) return res.status(400).json({ success: false, message: "Invalid form status." });
    if (status === "published" && !(form.elements || []).some((element) => element.kind === "field")) {
      return res.status(400).json({ success: false, message: "Add at least one field before publishing." });
    }
    form.status = status;
    form.publishedAt = status === "published" ? new Date() : undefined;
    form.updatedBy = req.user._id;
    await form.save();
    await logAudit(req, status === "published" ? "Published form" : "Unpublished form", "FormDefinition", form._id.toString(), form.name);
    res.json({ success: true, form: await hydrateForm(form) });
  } catch (err) { next(err); }
}

export async function getAvailableForms(req, res, next) {
  try {
    const entityType = req.params.entityType;
    if (!ENTITY_MODELS[entityType]) return res.status(400).json({ success: false, message: "Invalid record type." });
    if (!canSubmitForEntity(req.user, entityType)) return res.status(403).json({ success: false, message: "You do not have permission to complete forms for this record type." });
    const forms = await FormDefinition.find({ status: "published", visibility: "internal", targetEntityType: entityType }).sort({ name: 1 }).lean();
    res.json({ success: true, forms });
  } catch (err) { next(err); }
}

export async function getRunnableForm(req, res, next) {
  try {
    const form = await FormDefinition.findById(req.params.id);
    if (!form || form.status !== "published" || form.visibility !== "internal") return res.status(404).json({ success: false, message: "Published internal form not found." });
    if (form.targetEntityType !== "none" && !canSubmitForEntity(req.user, form.targetEntityType)) return res.status(403).json({ success: false, message: "You do not have permission to use this form." });
    res.json({ success: true, form: await hydrateForm(form) });
  } catch (err) { next(err); }
}

export async function getPublicForm(req, res, next) {
  try {
    const form = await FormDefinition.findOne({ slug: req.params.slug, status: "published", visibility: "public" });
    if (!form) return res.status(404).json({ success: false, message: "Form not found." });
    res.json({ success: true, form: await hydrateForm(form) });
  } catch (err) { next(err); }
}

async function createSubmission({ req, form, rawAnswers, entityType, entityId, publicSubmission }) {
  const { answers, customValues, standardValues, hydrated } = await validateAndNormalizeAnswers(form, rawAnswers);
  let linkedType = entityType;
  let linkedId = entityId;

  if (publicSubmission && form.publicAction === "create_crm_lead") {
    const fullName = standardLeadFullName(standardValues);
    const email = String(standardValues.email || "").trim();
    const phone = String(standardValues.phone || "").trim();
    if (!fullName || (!email && !phone)) throw new Error("Full name and either email or phone are required for this form.");
    const result = await upsertCrmLead({
      fullName, email, phone, source: `form:${form.slug}`,
      programInterest: standardValues.programInterest || "not_sure",
      message: standardValues.goals || "",
    });
    linkedType = "crm_contact";
    linkedId = result.contact._id;
  }

  if (linkedType || linkedId) {
    if (!linkedType || !linkedId) throw new Error("Both record type and record id are required.");
    if (form.targetEntityType === "none" || linkedType !== form.targetEntityType) throw new Error("This form cannot be attached to that record type.");
    if (!(await assertEntity(linkedType, linkedId))) throw new Error("Linked record not found.");
  }

  if (linkedType && linkedId) {
    await persistLinkedCustomValues({ form, entityType: linkedType, entityId: linkedId, customValues, userId: req.user?._id });
  }

  const submission = await FormSubmission.create({
    form: form._id, formName: form.name, formSlug: form.slug, visibility: form.visibility,
    entityType: linkedType || undefined, entityId: linkedId || undefined,
    answers,
    schemaSnapshot: (hydrated.elements || []).map((element) => ({
      id: String(element._id), kind: element.kind, label: element.label || element.fieldDefinition?.label || "", text: element.text || "",
      type: element.fieldDefinition?.type || "", source: element.source || "", standardKey: element.standardKey || "", customField: element.customField ? String(element.customField) : "",
    })),
    submittedBy: req.user?._id,
    submitterName: req.user?.name || String(standardValues.fullName || ""),
    source: publicSubmission ? "public_form" : "internal_form",
  });

  dispatchWorkflowEvent({
    type: "form_submitted",
    eventKey: `form_submitted:${submission._id}`,
    formId: form._id,
    submissionId: submission._id,
    entityType: linkedType,
    entityId: linkedId,
    actorUserId: req.user?._id,
    actorName: req.user?.name || String(standardValues.fullName || "Public form"),
    data: {
      formId: String(form._id),
      formName: form.name,
      visibility: form.visibility,
      source: submission.source,
      programInterest: standardValues.programInterest || "",
    },
  }).catch((error) => console.error("Workflow form trigger failed:", error.message));

  return submission;
}

export async function submitInternalForm(req, res, next) {
  try {
    const form = await FormDefinition.findById(req.params.id);
    if (!form || form.status !== "published" || form.visibility !== "internal") return res.status(404).json({ success: false, message: "Published internal form not found." });
    if (form.targetEntityType !== "none" && !canSubmitForEntity(req.user, form.targetEntityType)) return res.status(403).json({ success: false, message: "You do not have permission to use this form." });
    const submission = await createSubmission({ req, form, rawAnswers: req.body.answers, entityType: req.body.entityType, entityId: req.body.entityId, publicSubmission: false });
    await logAudit(req, "Submitted form", "FormSubmission", submission._id.toString(), form.name);
    res.status(201).json({ success: true, submission });
  } catch (err) {
    if (err?.message && !String(err.message).includes("Mongo")) return res.status(400).json({ success: false, message: err.message });
    next(err);
  }
}

export async function submitPublicForm(req, res, next) {
  try {
    const form = await FormDefinition.findOne({ slug: req.params.slug, status: "published", visibility: "public" });
    if (!form) return res.status(404).json({ success: false, message: "Form not found." });
    const submission = await createSubmission({ req, form, rawAnswers: req.body.answers, publicSubmission: true });
    res.status(201).json({ success: true, submissionId: submission._id, confirmationTitle: form.confirmationTitle, confirmationMessage: form.confirmationMessage });
  } catch (err) {
    if (err?.message && !String(err.message).includes("Mongo")) return res.status(400).json({ success: false, message: err.message });
    next(err);
  }
}

export async function listFormSubmissions(req, res, next) {
  try {
    const query = {};
    const entityType = req.query.entityType;
    const entityId = req.query.entityId;
    if (entityType || entityId) {
      if (!ENTITY_MODELS[entityType] || !mongoose.isValidObjectId(entityId)) return res.status(400).json({ success: false, message: "A valid linked record is required." });
      if (!canSubmitForEntity(req.user, entityType)) return res.status(403).json({ success: false, message: "You do not have permission to view these form responses." });
      query.entityType = entityType; query.entityId = entityId;
    } else if (!rolesFor(req.user).includes("admin")) {
      return res.status(403).json({ success: false, message: "Only Admin can view all form responses." });
    }
    if (req.query.formId) {
      if (!mongoose.isValidObjectId(req.query.formId)) return res.status(400).json({ success: false, message: "Invalid form id." });
      query.form = req.query.formId;
    }
    const submissions = await FormSubmission.find(query).sort({ createdAt: -1 }).limit(200).lean();
    res.json({ success: true, submissions });
  } catch (err) { next(err); }
}
