import mongoose from "mongoose";
import CustomFieldDefinition from "../models/CustomFieldDefinition.js";
import { normalizeFieldValue, saveCustomFieldValues } from "./customFieldService.js";

export const STANDARD_FORM_FIELDS = {
  firstName: { label: "First name", type: "text" },
  lastName: { label: "Last name", type: "text" },
  fullName: { label: "Full name", type: "text" },
  email: { label: "Email", type: "email" },
  phone: { label: "Phone", type: "phone" },
  programInterest: {
    label: "Program interest",
    type: "select",
    options: [
      { value: "core", label: "Core" },
      { value: "plus", label: "Plus" },
      { value: "vip", label: "VIP" },
      { value: "not_sure", label: "Not sure yet" },
    ],
  },
  goals: { label: "Goals", type: "long_text" },
  healthNotes: { label: "Health notes", type: "long_text" },
  startTimeline: {
    label: "When would you ideally like to get started?",
    type: "select",
    options: [
      { value: "asap", label: "As soon as possible" },
      { value: "within_2_weeks", label: "Within 2 weeks" },
      { value: "within_a_month", label: "Within a month" },
      { value: "exploring", label: "I am still exploring" },
    ],
  },
  readyToSpeak: {
    label: "Are you ready to speak with a KhairoDietClinic team member about the next step?",
    type: "select",
    options: [
      { value: "yes", label: "Yes" },
      { value: "questions", label: "I have a few questions first" },
      { value: "not_yet", label: "Not yet" },
    ],
  },
};

export function slugifyForm(input = "") {
  const value = String(input)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  if (!value) return "khairo-form";
  return value.length < 2 ? `${value}-form` : value;
}

export async function hydrateForm(formDoc) {
  const form = formDoc.toObject ? formDoc.toObject() : { ...formDoc };
  const customIds = (form.elements || [])
    .filter((element) => element.kind === "field" && element.source === "custom" && element.customField)
    .map((element) => element.customField);
  const customFields = customIds.length
    ? await CustomFieldDefinition.find({ _id: { $in: customIds }, active: true }).lean()
    : [];
  const customMap = new Map(customFields.map((field) => [field._id.toString(), field]));

  form.elements = (form.elements || []).map((element) => {
    if (element.kind !== "field") return element;
    if (element.source === "standard") {
      const standard = STANDARD_FORM_FIELDS[element.standardKey];
      return { ...element, fieldDefinition: standard ? { key: element.standardKey, ...standard } : null };
    }
    const custom = element.customField ? customMap.get(String(element.customField)) : null;
    return { ...element, fieldDefinition: custom || null };
  });
  return form;
}

export async function validateAndNormalizeAnswers(form, rawAnswers = {}) {
  if (!rawAnswers || typeof rawAnswers !== "object" || Array.isArray(rawAnswers)) {
    throw new Error("Form responses must be an object.");
  }

  const hydrated = await hydrateForm(form);
  const answers = {};
  const customValues = {};
  const standardValues = {};

  for (const element of hydrated.elements || []) {
    if (element.kind !== "field") continue;
    const key = String(element._id);
    const raw = rawAnswers[key];
    const definition = element.fieldDefinition;
    if (!definition) throw new Error(`${element.label || "A form field"} is no longer available.`);

    const effective = {
      ...definition,
      label: element.label || definition.label || "Field",
      placeholder: element.placeholder || definition.placeholder || "",
      description: element.helpText || definition.description || "",
      required: Boolean(element.required),
    };
    const normalized = normalizeFieldValue(effective, raw);
    answers[key] = normalized;

    if (element.source === "custom" && element.customField) customValues[String(element.customField)] = normalized;
    if (element.source === "standard" && element.standardKey) standardValues[element.standardKey] = normalized;
  }

  return { answers, customValues, standardValues, hydrated };
}

export async function persistLinkedCustomValues({ form, entityType, entityId, customValues, userId }) {
  if (!entityType || !entityId || form.targetEntityType === "none") return;
  if (entityType !== form.targetEntityType) throw new Error("This form cannot be attached to that record type.");
  if (!mongoose.isValidObjectId(entityId)) throw new Error("Invalid record id.");
  const values = Object.fromEntries(Object.entries(customValues).filter(([, value]) => value !== null));
  if (!Object.keys(values).length) return;
  await saveCustomFieldValues({ entityType, entityId, values, userId });
}
