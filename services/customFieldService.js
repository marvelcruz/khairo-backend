import mongoose from "mongoose";
import CustomFieldDefinition from "../models/CustomFieldDefinition.js";
import CustomFieldValue from "../models/CustomFieldValue.js";

export const CUSTOM_FIELD_ENTITY_TYPES = ["crm_contact", "application", "client"];
export const CUSTOM_FIELD_TYPES = ["text", "long_text", "number", "date", "boolean", "select", "multi_select", "email", "phone"];

export function slugifyFieldKey(input = "") {
  const cleaned = String(input)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64);
  if (!cleaned) return "custom_field";
  return /^[a-z]/.test(cleaned) ? cleaned : `field_${cleaned}`.slice(0, 64);
}

export function normalizeOptions(options = []) {
  const seen = new Set();
  return (Array.isArray(options) ? options : [])
    .map((item) => {
      if (typeof item === "string") {
        const value = item.trim();
        return { value, label: value };
      }
      const value = String(item?.value ?? item?.label ?? "").trim();
      const label = String(item?.label ?? item?.value ?? "").trim();
      return { value, label };
    })
    .filter((item) => item.value && item.label && !seen.has(item.value) && seen.add(item.value));
}

function isBlank(value) {
  return value === undefined || value === null || value === "" || (Array.isArray(value) && value.length === 0);
}

export function normalizeFieldValue(definition, rawValue) {
  if (isBlank(rawValue)) {
    if (definition.required) throw new Error(`${definition.label} is required.`);
    return null;
  }

  switch (definition.type) {
    case "number": {
      const number = Number(rawValue);
      if (!Number.isFinite(number)) throw new Error(`${definition.label} must be a valid number.`);
      return number;
    }
    case "boolean": {
      if (typeof rawValue === "boolean") return rawValue;
      if (rawValue === "true" || rawValue === "1" || rawValue === 1) return true;
      if (rawValue === "false" || rawValue === "0" || rawValue === 0) return false;
      throw new Error(`${definition.label} must be yes or no.`);
    }
    case "date": {
      const value = String(rawValue).trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(new Date(`${value}T00:00:00Z`).getTime())) {
        throw new Error(`${definition.label} must be a valid date.`);
      }
      return value;
    }
    case "email": {
      const value = String(rawValue).trim().toLowerCase();
      if (!/^\S+@\S+\.\S+$/.test(value)) throw new Error(`${definition.label} must be a valid email address.`);
      return value;
    }
    case "select": {
      const value = String(rawValue).trim();
      const allowed = new Set((definition.options || []).map((option) => option.value));
      if (!allowed.has(value)) throw new Error(`${definition.label} contains an invalid option.`);
      return value;
    }
    case "multi_select": {
      const values = Array.isArray(rawValue) ? rawValue.map((item) => String(item).trim()).filter(Boolean) : [];
      const allowed = new Set((definition.options || []).map((option) => option.value));
      if (values.some((value) => !allowed.has(value))) throw new Error(`${definition.label} contains an invalid option.`);
      return [...new Set(values)];
    }
    case "phone":
      return String(rawValue).trim().slice(0, 80);
    case "long_text":
      return String(rawValue).trim().slice(0, 5000);
    case "text":
    default:
      return String(rawValue).trim().slice(0, 500);
  }
}

export async function getCustomFieldsForEntity(entityType, { includeInactive = false } = {}) {
  if (!CUSTOM_FIELD_ENTITY_TYPES.includes(entityType)) throw new Error("Invalid custom-field record type.");
  const query = { entityTypes: entityType };
  if (!includeInactive) query.active = true;
  return CustomFieldDefinition.find(query).sort({ sortOrder: 1, label: 1 }).lean();
}

export async function getCustomFieldValues(entityType, entityId) {
  if (!CUSTOM_FIELD_ENTITY_TYPES.includes(entityType)) throw new Error("Invalid custom-field record type.");
  if (!mongoose.isValidObjectId(entityId)) throw new Error("Invalid record id.");
  const rows = await CustomFieldValue.find({ entityType, entityId }).lean();
  return Object.fromEntries(rows.map((row) => [row.field.toString(), row.value]));
}

export async function saveCustomFieldValues({ entityType, entityId, values, userId }) {
  if (!CUSTOM_FIELD_ENTITY_TYPES.includes(entityType)) throw new Error("Invalid custom-field record type.");
  if (!mongoose.isValidObjectId(entityId)) throw new Error("Invalid record id.");
  if (!values || typeof values !== "object" || Array.isArray(values)) throw new Error("Custom field values must be an object.");

  const fieldIds = Object.keys(values);
  if (!fieldIds.length) return getCustomFieldValues(entityType, entityId);

  const definitions = await CustomFieldDefinition.find({
    _id: { $in: fieldIds },
    entityTypes: entityType,
    active: true,
  });
  const byId = new Map(definitions.map((definition) => [definition._id.toString(), definition]));

  if (fieldIds.some((fieldId) => !byId.has(fieldId))) throw new Error("One or more custom fields are unavailable for this record.");

  for (const fieldId of fieldIds) {
    const definition = byId.get(fieldId);
    const normalized = normalizeFieldValue(definition, values[fieldId]);
    if (normalized === null) {
      await CustomFieldValue.deleteOne({ entityType, entityId, field: definition._id });
    } else {
      await CustomFieldValue.updateOne(
        { entityType, entityId, field: definition._id },
        { $set: { value: normalized, updatedBy: userId } },
        { upsert: true }
      );
    }
  }

  return getCustomFieldValues(entityType, entityId);
}

export async function copyCustomFieldValues({ fromType, fromId, toType, toId, userId }) {
  if (!CUSTOM_FIELD_ENTITY_TYPES.includes(fromType) || !CUSTOM_FIELD_ENTITY_TYPES.includes(toType)) return;
  if (!mongoose.isValidObjectId(fromId) || !mongoose.isValidObjectId(toId)) return;

  const sourceRows = await CustomFieldValue.find({ entityType: fromType, entityId: fromId }).lean();
  if (!sourceRows.length) return;

  const fieldIds = sourceRows.map((row) => row.field);
  const eligible = await CustomFieldDefinition.find({
    _id: { $in: fieldIds },
    active: true,
    entityTypes: { $all: [fromType, toType] },
  }).select("_id").lean();
  const allowed = new Set(eligible.map((field) => field._id.toString()));

  await Promise.all(
    sourceRows
      .filter((row) => allowed.has(row.field.toString()))
      .map((row) =>
        CustomFieldValue.updateOne(
          { entityType: toType, entityId: toId, field: row.field },
          { $setOnInsert: { value: row.value, updatedBy: userId } },
          { upsert: true }
        )
      )
  );
}
