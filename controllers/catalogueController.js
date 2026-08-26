import mongoose from "mongoose";
import CatalogueItem, {
  BILLING_INTERVALS,
  BILLING_TYPES,
  CATALOGUE_ITEM_TYPES,
} from "../models/CatalogueItem.js";
import { logAudit } from "../utils/auditLogger.js";

const EDITABLE_FIELDS = [
  "name",
  "type",
  "sku",
  "shortDescription",
  "description",
  "price",
  "currency",
  "billing",
  "durationWeeks",
  "inventory",
  "fulfillment",
  "booking",
  "components",
  "eligibleAddOns",
  "isPublic",
  "isFeatured",
  "sortOrder",
];

const PUBLIC_FIELDS = [
  "name",
  "slug",
  "type",
  "sku",
  "shortDescription",
  "description",
  "price",
  "currency",
  "billing",
  "durationWeeks",
  "fulfillment",
  "booking",
  "components",
  "eligibleAddOns",
  "isFeatured",
  "sortOrder",
].join(" ");

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 90) || "item";
}

async function uniqueSlug(name) {
  const base = slugify(name);
  let candidate = base;
  let suffix = 2;

  while (await CatalogueItem.exists({ slug: candidate })) {
    candidate = `${base.slice(0, 84)}-${suffix++}`;
  }

  return candidate;
}

function parseBoolean(value) {
  if (value === true || value === "true") return true;
  if (value === false || value === "false") return false;
  return undefined;
}

function validateBaseInput(body, { partial = false } = {}) {
  const errors = [];

  if (!partial || body.name !== undefined) {
    if (!String(body.name || "").trim()) errors.push("Name is required.");
  }
  if (!partial || body.type !== undefined) {
    if (!CATALOGUE_ITEM_TYPES.includes(body.type)) errors.push("Choose a valid catalogue item type.");
  }
  if (!partial || body.price !== undefined) {
    const price = Number(body.price);
    if (!Number.isFinite(price) || price < 0) errors.push("Price must be zero or greater.");
  }
  if (body.currency !== undefined && !/^[A-Za-z]{3}$/.test(String(body.currency))) {
    errors.push("Currency must be a three-letter ISO code.");
  }
  if (body.billing?.type !== undefined && !BILLING_TYPES.includes(body.billing.type)) {
    errors.push("Choose a valid billing type.");
  }
  if (
    body.billing?.interval !== undefined &&
    body.billing.interval !== null &&
    !BILLING_INTERVALS.includes(body.billing.interval)
  ) {
    errors.push("Choose a valid billing interval.");
  }
  if (body.billing?.type === "recurring" && !body.billing?.interval && !partial) {
    errors.push("Recurring catalogue items require a billing interval.");
  }
  if (body.billing?.interval === "custom") {
    const cycleDays = Number(body.billing?.cycleDays);
    if (!Number.isFinite(cycleDays) || cycleDays < 1) {
      errors.push("Custom recurring billing requires cycleDays of at least 1.");
    }
  }
  if (body.components !== undefined && !Array.isArray(body.components)) {
    errors.push("Package components must be an array.");
  }
  if (body.eligibleAddOns !== undefined && !Array.isArray(body.eligibleAddOns)) {
    errors.push("Eligible add-ons must be an array.");
  }

  return errors;
}

function cleanRelationshipIds(body) {
  const invalid = [];
  const componentIds = Array.isArray(body.components)
    ? body.components.map((entry) => entry?.item).filter(Boolean)
    : [];
  const addOnIds = Array.isArray(body.eligibleAddOns) ? body.eligibleAddOns : [];

  for (const id of [...componentIds, ...addOnIds]) {
    if (!mongoose.isValidObjectId(id)) invalid.push(id);
  }

  return { invalid, componentIds, addOnIds };
}

async function validateRelationships(body, currentItemId = null) {
  const { invalid, componentIds, addOnIds } = cleanRelationshipIds(body);
  if (invalid.length) return "One or more catalogue relationships are invalid.";

  const ids = [...new Set([...componentIds, ...addOnIds].map(String))];
  if (currentItemId && ids.includes(String(currentItemId))) {
    return "A catalogue item cannot contain or add itself.";
  }
  if (!ids.length) return null;

  const found = await CatalogueItem.countDocuments({ _id: { $in: ids }, isActive: true });
  if (found !== ids.length) return "One or more linked catalogue items do not exist or are archived.";
  return null;
}

function applyEditableFields(item, body) {
  const nestedFields = new Set(["billing", "inventory", "fulfillment", "booking"]);
  for (const field of EDITABLE_FIELDS) {
    if (body[field] === undefined || nestedFields.has(field)) continue;
    item[field] = body[field];
  }

  for (const field of nestedFields) {
    if (body[field] === undefined) continue;
    const current = item[field]?.toObject ? item[field].toObject() : (item[field] || {});
    item[field] = { ...current, ...body[field] };
  }

  if (item.name !== undefined) item.name = String(item.name).trim();
  if (item.sku !== undefined && item.sku !== null) item.sku = String(item.sku).trim().toUpperCase();
  if (item.sku === "") item.sku = undefined;
  if (item.currency !== undefined) item.currency = String(item.currency).trim().toUpperCase();
  if (item.price !== undefined) item.price = Number(item.price);
  if (item.durationWeeks === "" || item.durationWeeks === undefined) item.durationWeeks = null;
  else if (item.durationWeeks !== null) item.durationWeeks = Number(item.durationWeeks);
  if (item.sortOrder !== undefined) item.sortOrder = Number(item.sortOrder) || 0;

  if (item.components) {
    item.components = item.components.map((entry) => ({
      item: entry.item,
      quantity: Math.max(1, Number(entry.quantity) || 1),
    }));
  }

  if (item.eligibleAddOns) {
    item.eligibleAddOns = [...new Set(item.eligibleAddOns.map(String))];
  }
}

export const listCatalogueItems = async (req, res, next) => {
  try {
    const query = {};
    const status = String(req.query.status || "active");
    const visibility = String(req.query.visibility || "all");
    const type = String(req.query.type || "").trim();
    const q = String(req.query.q || "").trim();

    if (!["active", "archived", "all"].includes(status)) {
      return res.status(400).json({ success: false, message: "Invalid catalogue status filter." });
    }
    if (!["public", "private", "all"].includes(visibility)) {
      return res.status(400).json({ success: false, message: "Invalid catalogue visibility filter." });
    }
    if (type && !CATALOGUE_ITEM_TYPES.includes(type)) {
      return res.status(400).json({ success: false, message: "Invalid catalogue type filter." });
    }

    if (status === "active") query.isActive = true;
    if (status === "archived") query.isActive = false;
    if (visibility === "public") query.isPublic = true;
    if (visibility === "private") query.isPublic = false;
    if (type) query.type = type;
    if (q) {
      const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      query.$or = [
        { name: new RegExp(escaped, "i") },
        { sku: new RegExp(escaped, "i") },
        { description: new RegExp(escaped, "i") },
      ];
    }

    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
    const skip = (page - 1) * limit;

    const [items, total] = await Promise.all([
      CatalogueItem.find(query)
        .populate("components.item", "name slug type price currency isActive")
        .populate("eligibleAddOns", "name slug type price currency isActive")
        .sort({ sortOrder: 1, name: 1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      CatalogueItem.countDocuments(query),
    ]);

    res.status(200).json({
      success: true,
      items,
      pagination: {
        page,
        limit,
        total,
        pages: Math.max(1, Math.ceil(total / limit)),
      },
      types: CATALOGUE_ITEM_TYPES,
    });
  } catch (err) {
    next(err);
  }
};

export const getCatalogueItem = async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid catalogue item ID." });
    }

    const item = await CatalogueItem.findById(req.params.id)
      .populate("components.item", "name slug type price currency isActive")
      .populate("eligibleAddOns", "name slug type price currency isActive")
      .lean();

    if (!item) return res.status(404).json({ success: false, message: "Catalogue item not found." });
    res.status(200).json({ success: true, item });
  } catch (err) {
    next(err);
  }
};

export const getPublicCatalogue = async (req, res, next) => {
  try {
    const query = { isActive: true, isPublic: true };
    const type = String(req.query.type || "").trim();
    if (type) {
      if (!CATALOGUE_ITEM_TYPES.includes(type)) {
        return res.status(400).json({ success: false, message: "Invalid catalogue type filter." });
      }
      query.type = type;
    }

    const items = await CatalogueItem.find(query)
      .select(PUBLIC_FIELDS)
      .populate("components.item", PUBLIC_FIELDS)
      .populate("eligibleAddOns", PUBLIC_FIELDS)
      .sort({ sortOrder: 1, name: 1 })
      .lean();

    res.status(200).json({ success: true, items });
  } catch (err) {
    next(err);
  }
};

export const getPublicCatalogueItem = async (req, res, next) => {
  try {
    const item = await CatalogueItem.findOne({
      slug: String(req.params.slug || "").toLowerCase(),
      isActive: true,
      isPublic: true,
    })
      .select(PUBLIC_FIELDS)
      .populate("components.item", PUBLIC_FIELDS)
      .populate("eligibleAddOns", PUBLIC_FIELDS)
      .lean();

    if (!item) return res.status(404).json({ success: false, message: "Catalogue item not found." });
    res.status(200).json({ success: true, item });
  } catch (err) {
    next(err);
  }
};

export const createCatalogueItem = async (req, res, next) => {
  try {
    const errors = validateBaseInput(req.body);
    if (errors.length) return res.status(400).json({ success: false, message: errors.join(" ") });

    const relationshipError = await validateRelationships(req.body);
    if (relationshipError) return res.status(400).json({ success: false, message: relationshipError });

    const item = new CatalogueItem({
      slug: await uniqueSlug(req.body.name),
      createdBy: req.user._id,
      updatedBy: req.user._id,
    });
    applyEditableFields(item, req.body);
    await item.save();

    await logAudit(req, "Created catalogue item", "CatalogueItem", item._id.toString(), `${item.name} · ${item.type}`);
    res.status(201).json({ success: true, item });
  } catch (err) {
    next(err);
  }
};

export const updateCatalogueItem = async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid catalogue item ID." });
    }

    const item = await CatalogueItem.findById(req.params.id);
    if (!item) return res.status(404).json({ success: false, message: "Catalogue item not found." });

    const errors = validateBaseInput(req.body, { partial: true });
    if (errors.length) return res.status(400).json({ success: false, message: errors.join(" ") });

    const relationshipError = await validateRelationships(req.body, item._id);
    if (relationshipError) return res.status(400).json({ success: false, message: relationshipError });

    // slug is intentionally not editable. Renaming an offering does not break references.
    applyEditableFields(item, req.body);
    item.updatedBy = req.user._id;
    await item.save();

    await logAudit(req, "Updated catalogue item", "CatalogueItem", item._id.toString(), `${item.name} · ${item.type}`);
    res.status(200).json({ success: true, item });
  } catch (err) {
    next(err);
  }
};

export const archiveCatalogueItem = async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid catalogue item ID." });
    }

    const item = await CatalogueItem.findById(req.params.id);
    if (!item) return res.status(404).json({ success: false, message: "Catalogue item not found." });

    item.isActive = false;
    item.isPublic = false;
    item.updatedBy = req.user._id;
    await item.save();

    await logAudit(req, "Archived catalogue item", "CatalogueItem", item._id.toString(), item.name);
    res.status(200).json({ success: true, item });
  } catch (err) {
    next(err);
  }
};

export const restoreCatalogueItem = async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid catalogue item ID." });
    }

    const item = await CatalogueItem.findById(req.params.id);
    if (!item) return res.status(404).json({ success: false, message: "Catalogue item not found." });

    item.isActive = true;
    // Restoring does not automatically republish an item.
    item.updatedBy = req.user._id;
    await item.save();

    await logAudit(req, "Restored catalogue item", "CatalogueItem", item._id.toString(), item.name);
    res.status(200).json({ success: true, item });
  } catch (err) {
    next(err);
  }
};
