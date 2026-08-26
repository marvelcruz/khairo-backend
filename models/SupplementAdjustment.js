import mongoose from "mongoose";
const adjustmentSchema = new mongoose.Schema({
  supplement: { type: mongoose.Schema.Types.ObjectId, ref: "Supplement", required: true },
  type: { type: String, enum: ["add", "remove", "set"], required: true },
  quantity: { type: Number, required: true },
  category: { type: String, enum: ["restock", "sold", "sent_to_client", "damaged", "expired", "lost", "other", "correction"], default: "correction" },
  client: { type: mongoose.Schema.Types.ObjectId, ref: "Client" },
  order: { type: mongoose.Schema.Types.ObjectId, ref: "Order" },
  reason: { type: String, trim: true },
  adjustedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
}, { timestamps: true });
export default mongoose.model("SupplementAdjustment", adjustmentSchema);
