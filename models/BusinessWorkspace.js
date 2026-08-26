import mongoose from "mongoose";

const businessWorkspaceSchema = new mongoose.Schema(
  {
    workspaceKey: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
      maxlength: 80,
    },
    profile: {
      displayName: { type: String, trim: true, default: "", maxlength: 120 },
      email: { type: String, trim: true, lowercase: true, default: "", maxlength: 180 },
      phone: { type: String, trim: true, default: "", maxlength: 80 },
      website: { type: String, trim: true, default: "", maxlength: 300 },
    },
    branding: {
      publicName: { type: String, trim: true, default: "", maxlength: 120 },
      primaryColor: {
        type: String,
        default: "#EC008C",
        match: /^#[0-9A-Fa-f]{6}$/,
      },
      logoUrl: { type: String, trim: true, default: "", maxlength: 1000 },
    },
    domain: {
      mode: { type: String, enum: ["platform", "custom"], default: "platform" },
      hostname: { type: String, trim: true, lowercase: true, default: "", maxlength: 255 },
      verified: { type: Boolean, default: false },
    },
    payments: {
      provider: { type: String, enum: ["paystack"], default: "paystack" },
      enabled: { type: Boolean, default: false },
    },
    setup: {
      steps: {
        business: { type: Boolean, default: false },
        brand: { type: Boolean, default: false },
        domain: { type: Boolean, default: false },
        payments: { type: Boolean, default: false },
        email: { type: Boolean, default: false },
        social: { type: Boolean, default: false },
        staff: { type: Boolean, default: false },
        productsServices: { type: Boolean, default: false },
        test: { type: Boolean, default: false },
      },
      completedAt: { type: Date, default: null },
    },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

export default mongoose.model("BusinessWorkspace", businessWorkspaceSchema);
