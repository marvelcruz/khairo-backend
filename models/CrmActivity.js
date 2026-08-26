import mongoose from "mongoose";

const crmActivitySchema = new mongoose.Schema(
  {
    contact: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "CrmContact",
      required: true,
      index: true,
    },
    opportunity: { type: mongoose.Schema.Types.ObjectId, ref: "CrmOpportunity" },
    type: {
      type: String,
      enum: [
        "note",
        "call",
        "email",
        "whatsapp",
        "meeting",
        "task",
        "stage_change",
        "application",
        "system",
      ],
      default: "note",
    },
    subject: { type: String, trim: true, maxlength: 180 },
    body: { type: String, trim: true, required: true, maxlength: 5000 },
    dueAt: { type: Date },
    completedAt: { type: Date },
    assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

crmActivitySchema.index({ contact: 1, createdAt: -1 });
crmActivitySchema.index({ opportunity: 1, createdAt: -1 });
crmActivitySchema.index({ type: 1, dueAt: 1, completedAt: 1 });
crmActivitySchema.index({ assignedTo: 1, dueAt: 1, completedAt: 1 });

export default mongoose.model("CrmActivity", crmActivitySchema);
