import mongoose from "mongoose";

const connectionAccountSchema = new mongoose.Schema(
  {
    workspaceKey: {
      type: String,
      required: true,
      trim: true,
      default: "business",
      index: true,
    },
    provider: {
      type: String,
      required: true,
      enum: [
        "google_gmail",
        "google_business",
        "instagram",
        "facebook",
        "whatsapp",
        "linkedin",
        "tiktok",
      ],
    },
    status: {
      type: String,
      enum: ["connected", "needs_selection", "error", "disconnected"],
      default: "disconnected",
    },
    displayName: { type: String, trim: true, default: "" },
    externalAccountId: { type: String, trim: true, default: "" },
    scopes: [{ type: String, trim: true }],
    accessTokenEncrypted: { type: String, default: "", select: false },
    refreshTokenEncrypted: { type: String, default: "", select: false },
    tokenExpiresAt: { type: Date, default: null },
    connectedAt: { type: Date, default: null },
    lastCheckedAt: { type: Date, default: null },
    lastError: { type: String, trim: true, default: "", maxlength: 1000 },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
    connectedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

connectionAccountSchema.index(
  { workspaceKey: 1, provider: 1 },
  { unique: true }
);

export default mongoose.model("ConnectionAccount", connectionAccountSchema);
