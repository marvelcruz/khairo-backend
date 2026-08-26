import mongoose from "mongoose";

const websiteContentSchema = new mongoose.Schema(
  {
    pageKey: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      index: true,
    },
    sectionKey: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      index: true,
    },
    label: { type: String, trim: true, default: "" },
    type: {
      type: String,
      enum: ["text", "textarea", "richtext", "image", "link", "boolean", "json"],
      default: "text",
    },
    draftValue: { type: mongoose.Schema.Types.Mixed, default: "" },
    publishedValue: { type: mongoose.Schema.Types.Mixed, default: "" },
    status: {
      type: String,
      enum: ["draft", "published"],
      default: "draft",
      index: true,
    },
    order: { type: Number, default: 0 },
    group: { type: String, trim: true, default: "" },
    description: { type: String, trim: true, default: "" },
    publishedAt: Date,
    publishedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

websiteContentSchema.index(
  { pageKey: 1, sectionKey: 1 },
  { unique: true }
);

export default mongoose.model("WebsiteContent", websiteContentSchema);
