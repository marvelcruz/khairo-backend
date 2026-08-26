import mongoose from "mongoose";

export const WORKFLOW_TRIGGER_TYPES = [
  "crm_lead_created",
  "crm_stage_changed",
  "crm_tag_changed",
  "form_submitted",
  "application_submitted",
  "client_activated",
  "client_status_changed",
  "payment_success",
  "appointment_booked",
  "appointment_completed",
  "appointment_no_show",
  "manual",
];

export const WORKFLOW_ACTION_TYPES = [
  "add_note",
  "create_task",
  "set_stage",
  "set_follow_up",
  "assign_owner",
  "add_tag",
  "remove_tag",
  "send_email",
  "send_portal_message",
  "notify_staff",
  "wait",
];

const workflowActionSchema = new mongoose.Schema(
  {
    type: { type: String, enum: WORKFLOW_ACTION_TYPES, required: true },
    config: { type: mongoose.Schema.Types.Mixed, default: {} },
    condition: { type: mongoose.Schema.Types.Mixed, default: {} },
    retry: {
      maxAttempts: { type: Number, min: 1, max: 3, default: 1 },
      delayMinutes: { type: Number, min: 0, max: 60, default: 0 },
    },
  },
  { _id: true }
);

const workflowDefinitionSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 160 },
    description: { type: String, trim: true, maxlength: 800, default: "" },
    status: {
      type: String,
      enum: ["draft", "active", "paused"],
      default: "draft",
      index: true,
    },
    mode: {
      type: String,
      enum: ["live", "test"],
      default: "live",
    },
    isTemplate: { type: Boolean, default: false },
    templateCategory: { type: String, trim: true, maxlength: 80, default: "" },
    trigger: {
      type: { type: String, enum: WORKFLOW_TRIGGER_TYPES, required: true },
      config: { type: mongoose.Schema.Types.Mixed, default: {} },
    },
    actions: {
      type: [workflowActionSchema],
      validate: {
        validator(value) {
          return Array.isArray(value) && value.length <= 12;
        },
        message: "A workflow can contain up to 12 actions.",
      },
      default: [],
    },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    activatedAt: { type: Date },
    lastRunAt: { type: Date },
    runCount: { type: Number, min: 0, default: 0 },
    successCount: { type: Number, min: 0, default: 0 },
    failureCount: { type: Number, min: 0, default: 0 },
  },
  { timestamps: true }
);

workflowDefinitionSchema.index({ "trigger.type": 1, status: 1, updatedAt: -1 });
workflowDefinitionSchema.index({ status: 1, updatedAt: -1 });

export default mongoose.model("WorkflowDefinition", workflowDefinitionSchema);
