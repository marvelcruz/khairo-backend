import mongoose from "mongoose";

const authRecoveryTokenSchema = new mongoose.Schema(
  {
    subjectType: {
      type: String,
      enum: ["staff", "client"],
      required: true,
      index: true,
    },
    subjectId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      index: true,
    },
    purpose: {
      type: String,
      enum: ["password_reset", "portal_activation"],
      required: true,
      index: true,
    },
    tokenHash: {
      type: String,
      required: true,
      unique: true,
      index: true,
      select: false,
    },
    expiresAt: {
      type: Date,
      required: true,
      index: { expires: 0 },
    },
    usedAt: { type: Date },
  },
  { timestamps: true }
);

authRecoveryTokenSchema.index({ subjectType: 1, subjectId: 1, purpose: 1 });

export default mongoose.model("AuthRecoveryToken", authRecoveryTokenSchema);
