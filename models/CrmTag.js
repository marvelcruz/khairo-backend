import mongoose from "mongoose";

export const CRM_TAG_CATEGORIES = [
  "source",
  "interest",
  "behavior",
  "payment",
  "onboarding",
  "operational",
  "relationship",
  "campaign",
  "other",
];

export const CRM_TAG_LIFECYCLE_MODES = [
  "manual",
  "permanent",
  "current_state",
  "conditional",
  "workflow_limited",
];

const crmTagSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      maxlength: 60,
      unique: true,
      immutable: true,
      index: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 80,
    },
    normalizedName: {
      type: String,
      required: true,
      lowercase: true,
      maxlength: 80,
      unique: true,
      index: true,
    },
    category: {
      type: String,
      enum: CRM_TAG_CATEGORIES,
      default: "other",
      index: true,
    },
    description: {
      type: String,
      trim: true,
      maxlength: 300,
      default: "",
    },
    aliases: [{
      type: String,
      trim: true,
      lowercase: true,
      maxlength: 80,
    }],
    active: {
      type: Boolean,
      default: true,
      index: true,
    },
    automationManaged: {
      type: Boolean,
      default: false,
      index: true,
    },
    automationRule: {
      type: String,
      trim: true,
      maxlength: 120,
      default: "",
    },
    lifecycleMode: {
      type: String,
      enum: CRM_TAG_LIFECYCLE_MODES,
      default: "manual",
      index: true,
    },
    removeOnStages: [{
      type: String,
      trim: true,
      maxlength: 60,
    }],
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
  },
  { timestamps: true }
);

crmTagSchema.index({
  category: 1,
  active: 1,
  name: 1,
});
crmTagSchema.index({ lifecycleMode: 1, removeOnStages: 1 });

export default mongoose.model(
  "CrmTag",
  crmTagSchema
);
