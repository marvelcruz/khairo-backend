import User from "../models/User.js";
import {
  consumeRecoveryToken,
  findValidRecoveryToken,
  issueRecoveryToken,
} from "../services/authRecoveryService.js";

const GENERIC_REQUEST_MESSAGE =
  "If an active Khairo Diet Clinic staff account exists for that email, a secure reset link will be sent shortly.";

export async function requestStaffPasswordReset(req, res, next) {
  try {
    const email = String(req.body?.email || "").toLowerCase().trim();

    if (!email) {
      return res.status(400).json({ success: false, message: "Email is required." });
    }

    const user = await User.findOne({ email, isActive: true });

    if (user) {
      await issueRecoveryToken({
        subjectType: "staff",
        subjectId: user._id,
        purpose: "password_reset",
        email: user.email,
        displayName: user.name,
      });
    }

    return res.status(200).json({
      success: true,
      message: GENERIC_REQUEST_MESSAGE,
    });
  } catch (error) {
    next(error);
  }
}

export async function completeStaffPasswordReset(req, res, next) {
  try {
    const token = String(req.body?.token || "").trim();
    const newPassword = String(req.body?.newPassword || "");

    if (!token || !newPassword) {
      return res.status(400).json({
        success: false,
        message: "Reset token and new password are required.",
      });
    }

    if (newPassword.length < 8) {
      return res.status(400).json({
        success: false,
        message: "Password must be at least 8 characters.",
      });
    }

    const recovery = await findValidRecoveryToken({
      rawToken: token,
      subjectType: "staff",
      purpose: "password_reset",
    });

    if (!recovery) {
      return res.status(400).json({
        success: false,
        code: "INVALID_OR_EXPIRED_TOKEN",
        message: "This reset link is invalid or has expired. Request a new one.",
      });
    }

    const user = await User.findOne({ _id: recovery.subjectId, isActive: true }).select("+password");

    if (!user) {
      return res.status(400).json({
        success: false,
        code: "INVALID_OR_EXPIRED_TOKEN",
        message: "This reset link is invalid or has expired. Request a new one.",
      });
    }

    user.password = newPassword;
    await user.save();
    await consumeRecoveryToken(recovery);

    return res.status(200).json({
      success: true,
      message: "Password updated. You can now sign in.",
    });
  } catch (error) {
    next(error);
  }
}
