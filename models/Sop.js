import mongoose from "mongoose";

export const SOP_CATEGORIES = [
  "sales",
  "onboarding",
  "appointments",
  "clinical",
  "payments",
  "memberships",
  "retention",
  "marketing",
  "staff",
  "operations",
  "compliance",
  "management",
];

export const SOP_STEP_TYPES = [
  "human",
  "automated",
  "approval",
  "ai_assisted",
];

const sopStepSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 180 },
    instruction: { type: String, required: true, trim: true, maxlength: 2000 },
    type: { type: String, enum: SOP_STEP_TYPES, default: "human" },
  },
  { _id: true }
);

const sopSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 180 },
    category: { type: String, enum: SOP_CATEGORIES, required: true, index: true },
    purpose: { type: String, trim: true, maxlength: 1200, default: "" },
    whenToUse: { type: String, trim: true, maxlength: 1200, default: "" },
    owner: { type: String, trim: true, maxlength: 120, default: "Staff" },
    status: {
      type: String,
      enum: ["draft", "active", "archived"],
      default: "draft",
      index: true,
    },
    steps: {
      type: [sopStepSchema],
      validate: {
        validator(value) {
          return Array.isArray(value) && value.length <= 40;
        },
        message: "An SOP can contain up to 40 steps.",
      },
      default: [],
    },
    exceptionGuidance: { type: String, trim: true, maxlength: 3000, default: "" },
    linkedWorkflows: [{ type: mongoose.Schema.Types.ObjectId, ref: "WorkflowDefinition" }],
    tags: [{ type: String, trim: true, lowercase: true, maxlength: 60 }],
    version: { type: Number, min: 1, default: 1 },
    lastReviewedAt: { type: Date, default: null },
    reviewDueAt: { type: Date, default: null },
    starterKey: { type: String, trim: true },
    sortOrder: { type: Number, default: 100 },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

sopSchema.index({ status: 1, category: 1, sortOrder: 1, title: 1 });
sopSchema.index(
  { starterKey: 1 },
  { unique: true, partialFilterExpression: { starterKey: { $type: "string" } } }
);

export default mongoose.model("Sop", sopSchema);
