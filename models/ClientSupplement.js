import mongoose from "mongoose";
const clientSupplementSchema = new mongoose.Schema({
  client: { type: mongoose.Schema.Types.ObjectId, ref: "Client", required: true },
  supplement: { type: mongoose.Schema.Types.ObjectId, ref: "Supplement", required: true },
  quantity: { type: Number, default: 1 },
  addedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  viaPortal: { type: Boolean, default: false },
}, { timestamps: true });
export default mongoose.model("ClientSupplement", clientSupplementSchema);
