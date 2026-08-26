import mongoose from "mongoose";
const stocktakeSchema = new mongoose.Schema({
  performedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  notes: { type: String, default: "" },
  items: [{ supplement: { type: mongoose.Schema.Types.ObjectId, ref: "Supplement" }, name: String, expected: Number, counted: Number, discrepancy: Number }],
}, { timestamps: true });
export default mongoose.model("Stocktake", stocktakeSchema);
