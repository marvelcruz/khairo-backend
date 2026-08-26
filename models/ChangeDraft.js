import mongoose from "mongoose";

const changeDraftSchema = new mongoose.Schema(
  {
    entityType: { type: String, default: "Client", trim: true },
    entityId: { type: mongoose.Schema.Types.ObjectId, required: true, refPath: "entityType" },
    title: { type: String, required: true, trim: true },
    changes: { type: mongoose.Schema.Types.Mixed, required: true },
    note: { type: String, trim: true },
    status: { type: String, enum: ["pending", "finalized", "rejected"], default: "pending" },
    submittedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    finalizedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    finalizedAt: { type: Date },
  },
  { timestamps: true }
);

changeDraftSchema.index({ entityType: 1, entityId: 1, status: 1 });

export default mongoose.model("ChangeDraft", changeDraftSchema);
