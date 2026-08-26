import mongoose from "mongoose";

export const CATALOGUE_ITEM_TYPES = [
  "product",
  "service",
  "program",
  "membership",
  "package",
  "add_on",
];

export const BILLING_TYPES = ["one_time", "recurring"];
export const BILLING_INTERVALS = ["day", "week", "month", "year", "custom"];

const componentSchema = new mongoose.Schema(
  {
    item: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "CatalogueItem",
      required: true,
    },
    quantity: { type: Number, default: 1, min: 1 },
  },
  { _id: false }
);

const catalogueItemSchema = new mongoose.Schema(
  {
    // Human-facing fields are editable. References elsewhere should use _id.
    name: {
      type: String,
      required: [true, "Catalogue item name is required"],
      trim: true,
      maxlength: [120, "Catalogue item name cannot exceed 120 characters"],
    },
    slug: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      immutable: true,
      match: [/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Catalogue item slug is invalid"],
    },
    type: {
      type: String,
      enum: CATALOGUE_ITEM_TYPES,
      required: [true, "Catalogue item type is required"],
      index: true,
    },
    sku: { type: String, trim: true, uppercase: true, maxlength: 80 },
    shortDescription: { type: String, trim: true, maxlength: 300, default: "" },
    description: { type: String, trim: true, maxlength: 5000, default: "" },

    // Base commercial terms. Transactional models will snapshot these later.
    price: { type: Number, required: true, min: 0 },
    currency: {
      type: String,
      default: "NGN",
      uppercase: true,
      trim: true,
      match: [/^[A-Z]{3}$/, "Currency must be a three-letter ISO code"],
    },
    billing: {
      type: {
        type: String,
        enum: BILLING_TYPES,
        default: "one_time",
      },
      interval: {
        type: String,
        enum: [...BILLING_INTERVALS, null],
        default: null,
      },
      intervalCount: { type: Number, min: 1, default: 1 },
      cycleDays: { type: Number, min: 1, default: null },
    },

    // Useful for current Core/Plus/VIP-style programs and future services.
    durationWeeks: { type: Number, min: 0, default: null },

    // Product/inventory fields. These do not replace Supplement yet.
    inventory: {
      trackInventory: { type: Boolean, default: false },
      stock: { type: Number, min: 0, default: 0 },
      reorderThreshold: { type: Number, min: 0, default: 0 },
      costPerUnit: { type: Number, min: 0, default: 0 },
      unit: { type: String, trim: true, default: "units", maxlength: 40 },
    },

    // Behaviour flags used by later workflow integrations.
    fulfillment: {
      requiresFulfillment: { type: Boolean, default: false },
    },
    booking: {
      requiresBooking: { type: Boolean, default: false },
    },

    // Package/add-on relationships are stored now but not wired into checkout yet.
    components: { type: [componentSchema], default: [] },
    eligibleAddOns: [
      { type: mongoose.Schema.Types.ObjectId, ref: "CatalogueItem" },
    ],

    isActive: { type: Boolean, default: true, index: true },
    isPublic: { type: Boolean, default: false, index: true },
    isFeatured: { type: Boolean, default: false, index: true },
    sortOrder: { type: Number, default: 100 },

    // Migration bridge for existing Pricing/Supplement records. Not used yet.
    legacySource: {
      sourceType: {
        type: String,
        enum: ["pricing_program", "supplement", null],
        default: null,
      },
      sourceKey: { type: String, trim: true, default: null },
      sourceId: { type: mongoose.Schema.Types.ObjectId, default: null },
    },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

catalogueItemSchema.pre("validate", function (next) {
  if (this.billing?.type === "one_time") {
    this.billing.interval = null;
    this.billing.cycleDays = null;
  }

  if (this.billing?.type === "recurring" && !this.billing.interval) {
    this.invalidate("billing.interval", "Recurring catalogue items require a billing interval.");
  }

  if (this.billing?.interval !== "custom") {
    this.billing.cycleDays = null;
  } else if (this.billing?.type === "recurring" && !this.billing.cycleDays) {
    this.invalidate("billing.cycleDays", "Custom recurring billing requires cycleDays.");
  }

  next();
});

catalogueItemSchema.index({ type: 1, isActive: 1, sortOrder: 1, name: 1 });
catalogueItemSchema.index({ isPublic: 1, isActive: 1, sortOrder: 1, name: 1 });
catalogueItemSchema.index(
  {
    "legacySource.sourceType": 1,
    "legacySource.sourceId": 1,
    "legacySource.sourceKey": 1,
  },
  {
    unique: true,
    partialFilterExpression: {
      "legacySource.sourceType": { $type: "string" },
      "legacySource.sourceId": { $type: "objectId" },
      "legacySource.sourceKey": { $type: "string" },
    },
  }
);
catalogueItemSchema.index(
  { sku: 1 },
  {
    unique: true,
    partialFilterExpression: { sku: { $type: "string", $gt: "" } },
  }
);

export default mongoose.model("CatalogueItem", catalogueItemSchema);
