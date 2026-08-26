import mongoose from "mongoose";
const supplementSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  description: { type: String, trim: true },
  price: { type: Number, required: true },
  costPerUnit: { type: Number, default: 0 },
  stock: { type: Number, default: 0, min: 0 },
  reorderThreshold: { type: Number, default: 10 },
  unit: { type: String, default: "units" },
  isActive: { type: Boolean, default: true },
}, { timestamps: true });
export default mongoose.model("Supplement", supplementSchema);
