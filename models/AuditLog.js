import mongoose from "mongoose";

const auditLogSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    userName: { type: String, required: true },
    action: { type: String, required: true }, // e.g., "Created client", "Added exercise"
    entityType: { type: String }, // e.g., "Client", "Staff", "Payment"
    entityId: { type: String },
    details: { type: String },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

export default mongoose.model("AuditLog", auditLogSchema);
