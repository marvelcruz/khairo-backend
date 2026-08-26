import mongoose from "mongoose";

const websiteContentVersionSchema = new mongoose.Schema(
  {
    contentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "WebsiteContent",
      required: true,
      index: true,
    },
    pageKey: { type: String, required: true, index: true },
    sectionKey: { type: String, required: true },
    value: { type: mongoose.Schema.Types.Mixed },
    action: {
      type: String,
      enum: ["publish", "restore"],
      required: true,
    },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

export default mongoose.model("WebsiteContentVersion", websiteContentVersionSchema);
