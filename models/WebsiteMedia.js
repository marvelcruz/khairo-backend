import mongoose from "mongoose";

const websiteMediaSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    url: { type: String, required: true, trim: true },
    alt: { type: String, trim: true, default: "" },
    category: { type: String, trim: true, default: "general" },
    archived: { type: Boolean, default: false, index: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

export default mongoose.model("WebsiteMedia", websiteMediaSchema);
