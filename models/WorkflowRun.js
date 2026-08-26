import mongoose from "mongoose";

const workflowStepSchema = new mongoose.Schema(
  {
    actionId: { type: String, default: "" },
    actionType: { type: String, required: true },
    status: { type: String, enum: ["success", "failed", "skipped"], required: true },
    message: { type: String, trim: true, maxlength: 1000, default: "" },
  },
  { _id: false }
);

const workflowRunSchema = new mongoose.Schema(
  {
    workflow: { type: mongoose.Schema.Types.ObjectId, ref: "WorkflowDefinition", required: true, index: true },
    workflowName: { type: String, required: true, trim: true, maxlength: 160 },
    triggerType: { type: String, required: true, trim: true, maxlength: 80 },
    eventKey: { type: String, trim: true, maxlength: 240, default: undefined },
    status: { type: String, enum: ["running", "success", "partial", "failed", "skipped", "waiting"], default: "running", index: true },
    contact: { type: mongoose.Schema.Types.ObjectId, ref: "CrmContact" },
    opportunity: { type: mongoose.Schema.Types.ObjectId, ref: "CrmOpportunity" },
    application: { type: mongoose.Schema.Types.ObjectId, ref: "Application" },
    client: { type: mongoose.Schema.Types.ObjectId, ref: "Client" },
    form: { type: mongoose.Schema.Types.ObjectId, ref: "FormDefinition" },
    submission: { type: mongoose.Schema.Types.ObjectId, ref: "FormSubmission" },
    actorUser: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    actorName: { type: String, trim: true, maxlength: 160, default: "System" },
    eventSnapshot: { type: mongoose.Schema.Types.Mixed, default: {} },
    steps: { type: [workflowStepSchema], default: [] },
    error: { type: String, trim: true, maxlength: 3000, default: "" },
    startedAt: { type: Date, default: Date.now },
    waitUntil: { type: Date },
    currentActionIndex: { type: Number, default: 0 },
    completedAt: { type: Date },
  },
  { timestamps: true }
);

workflowRunSchema.index({ workflow: 1, eventKey: 1 }, { unique: true, sparse: true });
workflowRunSchema.index({ createdAt: -1, status: 1 });
workflowRunSchema.index({ contact: 1, createdAt: -1 });

export default mongoose.model("WorkflowRun", workflowRunSchema);
