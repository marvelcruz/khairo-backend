import mongoose from "mongoose";

const metricsSchema = new mongoose.Schema(
  {
    impressions: { type: Number, default: 0, min: 0 },
    reach: { type: Number, default: 0, min: 0 },
    likes: { type: Number, default: 0, min: 0 },
    comments: { type: Number, default: 0, min: 0 },
    shares: { type: Number, default: 0, min: 0 },
    saves: { type: Number, default: 0, min: 0 },
    clicks: { type: Number, default: 0, min: 0 },
    leads: { type: Number, default: 0, min: 0 },
    conversions: { type: Number, default: 0, min: 0 },
  },
  { _id: false }
);

const schema = new mongoose.Schema(
  {
    account: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SocialAccount",
      default: null,
    },
    provider: {
      type: String,
      enum: [
        "instagram",
        "facebook",
        "linkedin",
        "tiktok",
        "google_business",
        "other",
      ],
      required: true,
      index: true,
    },
    externalPostId: {
      type: String,
      default: "",
    },
    externalUrl: {
      type: String,
      default: "",
      trim: true,
    },
    mediaUrl: {
      type: String,
      default: "",
      trim: true,
    },
    title: {
      type: String,
      default: "",
      trim: true,
    },
    caption: {
      type: String,
      required: true,
      trim: true,
    },
    format: {
      type: String,
      enum: [
        "image",
        "carousel",
        "video",
        "reel",
        "story",
        "text",
        "link",
        "other",
      ],
      default: "image",
    },
    topic: {
      type: String,
      default: "",
      trim: true,
    },
    status: {
      type: String,
      enum: [
        "draft",
        "approved",
        "scheduled",
        "published",
      ],
      default: "draft",
      index: true,
    },
    scheduledFor: {
      type: Date,
      default: null,
    },
    publishedAt: {
      type: Date,
      default: null,
    },
    metrics: {
      type: metricsSchema,
      default: () => ({}),
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    approvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    approvedAt: {
      type: Date,
      default: null,
    },
    isArchived: {
      type: Boolean,
      default: false,
      index: true,
    },
  },
  { timestamps: true }
);

export default mongoose.model(
  "SocialPost",
  schema
);
