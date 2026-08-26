import mongoose from "mongoose";

const formElementSchema = new mongoose.Schema(
  {
    kind: { type: String, enum: ["field", "heading", "paragraph"], required: true },
    source: { type: String, enum: ["standard", "custom"], default: undefined },
    standardKey: {
      type: String,
      enum: ["fullName", "firstName", "lastName", "email", "phone", "programInterest", "goals", "healthNotes", "startTimeline", "readyToSpeak"],
      default: undefined,
    },
    customField: { type: mongoose.Schema.Types.ObjectId, ref: "CustomFieldDefinition", default: undefined },
    label: { type: String, trim: true, maxlength: 160, default: "" },
    text: { type: String, trim: true, maxlength: 1200, default: "" },
    helpText: { type: String, trim: true, maxlength: 500, default: "" },
    placeholder: { type: String, trim: true, maxlength: 200, default: "" },
    required: { type: Boolean, default: false },
  },
  { _id: true }
);

const formDefinitionSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 160 },
    slug: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^[a-z0-9][a-z0-9-]{1,79}$/, "Form link must use lowercase letters, numbers, and hyphens."],
    },
    description: { type: String, trim: true, maxlength: 800, default: "" },
    status: { type: String, enum: ["draft", "published"], default: "draft" },
    visibility: { type: String, enum: ["internal", "public"], default: "internal" },
    targetEntityType: {
      type: String,
      enum: ["none", "crm_contact", "application", "client"],
      default: "none",
    },
    publicAction: {
      type: String,
      enum: ["submission_only", "create_crm_lead"],
      default: "submission_only",
    },
    submitLabel: { type: String, trim: true, maxlength: 80, default: "Submit" },
    confirmationTitle: { type: String, trim: true, maxlength: 160, default: "Thank you" },
    confirmationMessage: {
      type: String,
      trim: true,
      maxlength: 1000,
      default: "Your response has been received.",
    },
    elements: { type: [formElementSchema], default: [] },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    publishedAt: { type: Date },
  },
  { timestamps: true }
);

formDefinitionSchema.index({ status: 1, visibility: 1, updatedAt: -1 });

export default mongoose.model("FormDefinition", formDefinitionSchema);
