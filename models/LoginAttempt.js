import mongoose from "mongoose";

const loginAttemptSchema = new mongoose.Schema(
  {
    _id: {
      type: String,
    },
    attempts: {
      type: Number,
      default: 0,
      min: 0,
    },
    windowStartedAt: {
      type: Date,
      required: true,
    },
    lockedUntil: {
      type: Date,
      default: null,
    },
    expiresAt: {
      type: Date,
      required: true,
    },
  },
  {
    versionKey: false,
  }
);

// Remove abandoned limiter records automatically after their protection window.
loginAttemptSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const LoginAttempt =
  mongoose.models.LoginAttempt ||
  mongoose.model("LoginAttempt", loginAttemptSchema);

export default LoginAttempt;
