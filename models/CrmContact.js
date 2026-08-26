import mongoose from "mongoose";
import CrmTag from "./CrmTag.js";
import {
  automationTagDefinition,
  inferAutomaticSourceTag,
  normalizeAutomationTagKeys,
} from "../services/crmTagAutomationPolicy.js";

export const CRM_PREFERRED_CONTACT_METHOD_VALUES = [
  "whatsapp",
  "phone",
  "email",
  "no_preference",
];

export const CRM_WHATSAPP_MARKETING_CONSENT_VALUES = [
  "unknown",
  "opted_in",
  "opted_out",
];

const crmExternalIdentitySchema = new mongoose.Schema(
  {
    provider: {
      type: String,
      enum: ["instagram", "whatsapp"],
      required: true,
    },
    externalId: {
      type: String,
      trim: true,
      required: true,
      maxlength: 180,
    },
    username: { type: String, trim: true, default: "", maxlength: 160 },
    displayName: { type: String, trim: true, default: "", maxlength: 160 },
  },
  { _id: false }
);

async function ensureAutomationTagDefinition(key) {
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
      },
    },
    {
      upsert: true,
      new: true,
      setDefaultsOnInsert: true,
    }
  );
}

const crmContactSchema = new mongoose.Schema(
  {
    fullName: {
      type: String,
      required: [true, "Full name is required"],
      trim: true,
      maxlength: 160,
    },
    email: {
      type: String,
      trim: true,
      lowercase: true,
      match: [/^$|^\S+@\S+\.\S+$/, "Enter a valid email"],
      default: "",
    },
    phone: { type: String, trim: true, default: "", maxlength: 80 },
    phoneNormalized: { type: String, default: "", select: false },
    source: { type: String, trim: true, default: "manual", maxlength: 80 },
    sourceDetail: {
      type: String,
      trim: true,
      default: "",
      maxlength: 160,
    },
    externalIdentities: {
      type: [crmExternalIdentitySchema],
      default: [],
    },
    lastInboundInstagramAt: { type: Date },
    lastInboundWhatsAppAt: { type: Date },
    preferredContactMethod: {
      type: String,
      enum: CRM_PREFERRED_CONTACT_METHOD_VALUES,
      default: "no_preference",
    },
    whatsappMarketingConsent: {
      status: {
        type: String,
        enum: CRM_WHATSAPP_MARKETING_CONSENT_VALUES,
        default: "unknown",
      },
      updatedAt: { type: Date },
      source: { type: String, trim: true, default: "", maxlength: 160 },
      note: { type: String, trim: true, default: "", maxlength: 500 },
      updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    },
    programInterest: {
      type: String,
      enum: ["core", "plus", "vip", "not_sure"],
      default: "not_sure",
    },
    programInterestOffering: { type: mongoose.Schema.Types.ObjectId, ref: "CatalogueItem" },
    lifecycleStage: {
      type: String,
      enum: ["lead", "applicant", "client", "former_client"],
      default: "lead",
    },
    tags: [{ type: String, trim: true, maxlength: 60 }],
    assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    application: { type: mongoose.Schema.Types.ObjectId, ref: "Application" },
    client: { type: mongoose.Schema.Types.ObjectId, ref: "Client" },
    lastActivityAt: { type: Date },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    isArchived: { type: Boolean, default: false },
    archivedAt: { type: Date },
  },
  { timestamps: true }
);

crmContactSchema.index({ fullName: "text", email: "text", phone: "text" });

crmContactSchema.pre("validate", function (next) {
  this.phoneNormalized = String(this.phone || "").replace(/\D/g, "");

  const identityMap = new Map();
  for (const identity of this.externalIdentities || []) {
    const provider = String(identity?.provider || "").trim().toLowerCase();
    const externalId = String(identity?.externalId || "").trim();
    if (!provider || !externalId) continue;
    identityMap.set(`${provider}:${externalId}`, {
      provider,
      externalId,
      username: String(identity?.username || "").trim(),
      displayName: String(identity?.displayName || "").trim(),
    });
  }
  this.externalIdentities = [...identityMap.values()];

  this.tags = normalizeAutomationTagKeys(this.tags || []);

  const sourceTag = inferAutomaticSourceTag(this.source);
  if (sourceTag) {
    this.tags = [...new Set([...(this.tags || []), sourceTag])];
    this.$locals.automaticSourceTag = sourceTag;
  }

  next();
});

crmContactSchema.pre("save", async function () {
  const shouldTrackTags = this.isNew || this.isModified("tags");
  this.$locals.shouldTrackCrmTagChanges = shouldTrackTags;

  if (!shouldTrackTags) return;

  if (this.isNew) {
    this.$locals.previousCrmTags = [];
    return;
  }

  const previous = await this.constructor
    .findById(this._id)
    .select("tags")
    .lean();

  this.$locals.previousCrmTags = previous?.tags || [];
});

crmContactSchema.post("save", async function (doc) {
  try {
    if (doc.$locals.automaticSourceTag) {
      await ensureAutomationTagDefinition(doc.$locals.automaticSourceTag);
    }

    if (!doc.$locals.shouldTrackCrmTagChanges) return;

    const before = new Set(doc.$locals.previousCrmTags || []);
    const after = new Set(doc.tags || []);
    const added = [...after].filter((tag) => !before.has(tag));
    const removed = [...before].filter((tag) => !after.has(tag));

    if (!added.length && !removed.length) return;

    const { dispatchCrmTagChange } = await import(
      "../services/crmTagWorkflowService.js"
    );

    for (const tag of added) {
      await dispatchCrmTagChange({
        contact: doc,
        tag,
        change: "added",
        actorUserId: doc.updatedBy || doc.createdBy,
        actorName: "System",
      });
    }

    for (const tag of removed) {
      await dispatchCrmTagChange({
        contact: doc,
        tag,
        change: "removed",
        actorUserId: doc.updatedBy || doc.createdBy,
        actorName: "System",
      });
    }
  } catch (error) {
    console.error("CRM automatic tag processing failed:", error?.message || error);
  }
});

crmContactSchema.index({ email: 1, isArchived: 1 });
crmContactSchema.index({ phoneNormalized: 1, isArchived: 1 });
crmContactSchema.index({ assignedTo: 1, isArchived: 1 });
crmContactSchema.index({ lifecycleStage: 1, isArchived: 1 });
crmContactSchema.index({
  "externalIdentities.provider": 1,
  "externalIdentities.externalId": 1,
  isArchived: 1,
});

export default mongoose.model("CrmContact", crmContactSchema);
