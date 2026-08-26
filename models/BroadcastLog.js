import mongoose from "mongoose";

const broadcastLogSchema = new mongoose.Schema({
  sentBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  segment: { type: String, required: true },
  message: { type: String, required: true },
  recipientCount: { type: Number, required: true },
  recipients: [{ clientId: mongoose.Schema.Types.ObjectId, name: String, phone: String }],
}, { timestamps: true });

export default mongoose.model("BroadcastLog", broadcastLogSchema);
