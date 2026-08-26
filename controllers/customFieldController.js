import mongoose from "mongoose";
import Application from "../models/Application.js";
import Client from "../models/Client.js";
import CrmContact from "../models/CrmContact.js";
import CustomFieldDefinition from "../models/CustomFieldDefinition.js";
import CustomFieldValue from "../models/CustomFieldValue.js";
import { logAudit } from "../utils/auditLogger.js";
import {
  CUSTOM_FIELD_ENTITY_TYPES,
  CUSTOM_FIELD_TYPES,
  getCustomFieldValues,
  getCustomFieldsForEntity,
  normalizeOptions,
  saveCustomFieldValues,
  slugifyFieldKey,
} from "../services/customFieldService.js";

function rolesFor(user) {
  return user?.roles || (user?.role ? [user.role] : []);
}

function hasPermission(user, permission) {
  return rolesFor(user).includes("admin") || (Array.isArray(user?.permissions) && user.permissions.includes(permission));
}

function permissionForEntity(entityType) {
  return {
    crm_contact: "view_crm",
    application: "view_requests",
    client: "view_clients",
  }[entityType];
}

function roleAllowedForEntity(user, entityType, write = false) {
  const roles = rolesFor(user);
  if (roles.includes("admin")) return true;
  const allowed = write
    ? { crm_contact: ["sales"], application: ["sales"], client: ["coach"] }
    : { crm_contact: ["sales", "staff", "coach"], application: ["sales", "coach"], client: ["coach", "staff"] };
  return (allowed[entityType] || []).some((role) => roles.includes(role));
}

async function assertRecordExists(entityType, entityId) {
  if (!mongoose.isValidObjectId(entityId)) return false;
  const model = entityType === "crm_contact" ? CrmContact : entityType === "application" ? Application : Client;
  return Boolean(await model.exists({ _id: entityId }));
}

export const listCustomFieldDefinitions = async (req, res, next) => {
  try {
    const { entityType, includeInactive } = req.query;
    if (entityType && !CUSTOM_FIELD_ENTITY_TYPES.includes(entityType)) {
      return res.status(400).json({ success: false, message: "Invalid record type." });
    }

    const isAdmin = rolesFor(req.user).includes("admin");
    if (!entityType && !isAdmin) return res.status(403).json({ success: false, message: "Only Admin can manage the custom field library." });
    if (entityType) {
      const permission = permissionForEntity(entityType);
      if (!roleAllowedForEntity(req.user, entityType, false) || !hasPermission(req.user, permission)) return res.status(403).json({ success: false, message: "You do not have access to these custom fields." });
    }
    const query = entityType ? { entityTypes: entityType } : {};
    if (!(isAdmin && includeInactive === "true")) query.active = true;

    const fields = await CustomFieldDefinition.find(query).sort({ sortOrder: 1, label: 1 }).lean();
    res.status(200).json({ success: true, fields });
  } catch (err) {
    next(err);
  }
};

export const createCustomFieldDefinition = async (req, res, next) => {
  try {
    const { label, key, description = "", placeholder = "", type, entityTypes, required = false, active = true, options = [] } = req.body;
    if (!label || !type || !Array.isArray(entityTypes) || !entityTypes.length) {
      return res.status(400).json({ success: false, message: "Label, field type, and at least one record type are required." });
    }
    if (!CUSTOM_FIELD_TYPES.includes(type)) return res.status(400).json({ success: false, message: "Invalid custom field type." });
    if (entityTypes.some((value) => !CUSTOM_FIELD_ENTITY_TYPES.includes(value))) return res.status(400).json({ success: false, message: "Invalid record type." });

    const normalizedOptions = normalizeOptions(options);
    if (["select", "multi_select"].includes(type) && normalizedOptions.length < 1) {
      return res.status(400).json({ success: false, message: "Dropdown and multi-select fields need at least one option." });
    }

    let normalizedKey = slugifyFieldKey(key || label);
    let suffix = 2;
    while (await CustomFieldDefinition.exists({ key: normalizedKey })) {
      normalizedKey = `${slugifyFieldKey(key || label).slice(0, 58)}_${suffix++}`;
    }

    const highest = await CustomFieldDefinition.findOne({}).sort({ sortOrder: -1 }).select("sortOrder").lean();
    const field = await CustomFieldDefinition.create({
      key: normalizedKey,
      label: String(label).trim(),
      description,
      placeholder,
      type,
      entityTypes: [...new Set(entityTypes)],
      required: Boolean(required),
      active: Boolean(active),
      sortOrder: Number(highest?.sortOrder || 0) + 10,
      options: normalizedOptions,
      createdBy: req.user._id,
      updatedBy: req.user._id,
    });

    await logAudit(req, "Created custom field", "CustomFieldDefinition", field._id.toString(), field.label);
    res.status(201).json({ success: true, field });
  } catch (err) {
    if (err?.code === 11000) return res.status(409).json({ success: false, message: "A custom field with that key already exists." });
    next(err);
  }
};

export const updateCustomFieldDefinition = async (req, res, next) => {
  try {
    const field = await CustomFieldDefinition.findById(req.params.id);
    if (!field) return res.status(404).json({ success: false, message: "Custom field not found." });

    const editable = ["label", "description", "placeholder", "required", "active", "entityTypes"];
    for (const key of editable) if (req.body[key] !== undefined) field[key] = req.body[key];

    if (req.body.type !== undefined && req.body.type !== field.type) {
      const hasValues = await CustomFieldValue.exists({ field: field._id });
      if (hasValues) return res.status(409).json({ success: false, message: "Field type cannot be changed after values have been saved." });
      if (!CUSTOM_FIELD_TYPES.includes(req.body.type)) return res.status(400).json({ success: false, message: "Invalid custom field type." });
      field.type = req.body.type;
    }

    if (req.body.options !== undefined) field.options = normalizeOptions(req.body.options);
    if (["select", "multi_select"].includes(field.type) && field.options.length < 1) {
      return res.status(400).json({ success: false, message: "Dropdown and multi-select fields need at least one option." });
    }
    if (!Array.isArray(field.entityTypes) || !field.entityTypes.length || field.entityTypes.some((value) => !CUSTOM_FIELD_ENTITY_TYPES.includes(value))) {
      return res.status(400).json({ success: false, message: "Choose at least one valid record type." });
    }

    field.updatedBy = req.user._id;
    await field.save();
    await logAudit(req, "Updated custom field", "CustomFieldDefinition", field._id.toString(), field.label);
    res.status(200).json({ success: true, field });
  } catch (err) {
    next(err);
  }
};

export const reorderCustomFieldDefinitions = async (req, res, next) => {
  try {
    const ids = Array.isArray(req.body.ids) ? req.body.ids : [];
    if (!ids.length || ids.some((id) => !mongoose.isValidObjectId(id))) {
      return res.status(400).json({ success: false, message: "A valid field order is required." });
    }
    await Promise.all(ids.map((id, index) => CustomFieldDefinition.updateOne({ _id: id }, { $set: { sortOrder: (index + 1) * 10, updatedBy: req.user._id } })));
    await logAudit(req, "Reordered custom fields", "CustomFieldDefinition", "", `${ids.length} fields`);
    const fields = await CustomFieldDefinition.find({}).sort({ sortOrder: 1, label: 1 }).lean();
    res.status(200).json({ success: true, fields });
  } catch (err) {
    next(err);
  }
};

export const getEntityCustomFields = async (req, res, next) => {
  try {
    const { entityType, entityId } = req.params;
    if (!CUSTOM_FIELD_ENTITY_TYPES.includes(entityType)) return res.status(400).json({ success: false, message: "Invalid record type." });
    if (!roleAllowedForEntity(req.user, entityType, false) || !hasPermission(req.user, permissionForEntity(entityType))) return res.status(403).json({ success: false, message: "You do not have access to this record." });
    if (!(await assertRecordExists(entityType, entityId))) return res.status(404).json({ success: false, message: "Record not found." });

    const [fields, values] = await Promise.all([
      getCustomFieldsForEntity(entityType),
      getCustomFieldValues(entityType, entityId),
    ]);
    res.status(200).json({ success: true, fields, values });
  } catch (err) {
    next(err);
  }
};

export const updateEntityCustomFields = async (req, res, next) => {
  try {
    const { entityType, entityId } = req.params;
    if (!CUSTOM_FIELD_ENTITY_TYPES.includes(entityType)) return res.status(400).json({ success: false, message: "Invalid record type." });
    if (!roleAllowedForEntity(req.user, entityType, true) || !hasPermission(req.user, permissionForEntity(entityType))) return res.status(403).json({ success: false, message: "You do not have permission to edit these custom fields." });
    if (!(await assertRecordExists(entityType, entityId))) return res.status(404).json({ success: false, message: "Record not found." });

    const values = await saveCustomFieldValues({ entityType, entityId, values: req.body.values, userId: req.user._id });
    await logAudit(req, "Updated custom field values", entityType, entityId, `${Object.keys(req.body.values || {}).length} field(s)`);
    res.status(200).json({ success: true, values });
  } catch (err) {
    if (err?.message && !String(err.message).includes("Mongo")) return res.status(400).json({ success: false, message: err.message });
    next(err);
  }
};
