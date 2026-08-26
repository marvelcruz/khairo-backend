import mongoose from "mongoose";

const schema = new mongoose.Schema(
  {
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
    displayName: {
      type: String,
      required: true,
      trim: true,
    },
    handle: {
      type: String,
      default: "",
      trim: true,
    },
    externalAccountId: {
      type: String,
      default: "",
      trim: true,
    },
    status: {
      type: String,
      enum: [
        "setup_required",
        "connected",
        "disconnected",
        "error",
      ],
      default: "setup_required",
    },
    lastSyncedAt: {
      type: Date,
      default: null,
    },
    connectedAt: {
      type: Date,
      default: null,
    },
    accessTokenEncrypted: {
      type: String,
      default: "",
      select: false,
    },
    tokenExpiresAt: {
      type: Date,
      default: null,
    },
    lastTokenRefreshAt: {
      type: Date,
      default: null,
    },
    connectionError: {
      type: String,
      default: "",
      trim: true,
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
  "SocialAccount",
  schema
);
