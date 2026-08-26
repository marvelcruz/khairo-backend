import mongoose from "mongoose";

const newsletterSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 180,
    },
    slug: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    excerpt: {
      type: String,
      trim: true,
      maxlength: 300,
      default: "",
    },
    logoUrl: {
      type: String,
      trim: true,
      maxlength: 1000,
      default: "",
    },
    content: {
      type: String,
      required: true,
      maxlength: 20000,
    },
    status: {
      type: String,
      enum: ["draft", "published"],
      default: "draft",
      index: true,
    },
    clientVisible: {
      type: Boolean,
      default: true,
    },
    publicVisible: {
      type: Boolean,
      default: true,
    },
    publishedAt: { type: Date },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

newsletterSchema.index({ status: 1, publishedAt: -1 });
newsletterSchema.index({ clientVisible: 1, status: 1, publishedAt: -1 });
newsletterSchema.index({ publicVisible: 1, status: 1, publishedAt: -1 });

export default mongoose.model("Newsletter", newsletterSchema);
