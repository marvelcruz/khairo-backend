import mongoose from "mongoose";

const programSchema = new mongoose.Schema({
  key: { type: String, required: true },
  name: { type: String, required: true },
  price: { type: Number, required: true, default: 0 },
  weeks: { type: Number, default: 12 },
  popular: { type: Boolean, default: false },
}, { _id: false });

const pricingSchema = new mongoose.Schema({
  core: { type: Number, default: 35000 },
  plus: { type: Number, default: 55000 },
  vip: { type: Number, default: 85000 },
  consultationFee: { type: Number, default: 15000 },
  programs: { type: [programSchema], default: () => ([
    { key: "core", name: "Core", price: 35000, weeks: 8, popular: false },
    { key: "plus", name: "Plus", price: 55000, weeks: 12, popular: true },
    { key: "vip", name: "VIP", price: 85000, weeks: 12, popular: false },
  ]) },
  updatedAt: { type: Date, default: Date.now },
}, { strict: false });

export default mongoose.model("Pricing", pricingSchema);
