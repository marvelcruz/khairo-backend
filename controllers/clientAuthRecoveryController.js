import Client from "../models/Client.js";
import { syncClientPortalAccess } from "../utils/clientPortalAccess.js";
import {
  consumeRecoveryToken,
  findValidRecoveryToken,
  issueRecoveryToken,
} from "../services/authRecoveryService.js";

const GENERIC_RESET_MESSAGE =
  "If a KhairoDietClinic client account exists for that email, a secure reset link will be sent shortly.";
const GENERIC_ACTIVATION_MESSAGE =
  "If an eligible KhairoDietClinic client record exists for that email, a secure activation link will be sent shortly.";

export async function preventExistingClientPortalRegistration(req, res, next) {
  try {
    const email = String(req.body?.email || "").toLowerCase().trim();
    if (!email) return next();

    const existing = await Client.findOne({ email, isArchived: false }).select("_id portalActive");

    if (!existing) return next();

    return res.status(409).json({
      success: false,
      code: existing.portalActive ? "ACCOUNT_EXISTS" : "EXISTING_CLIENT_REQUIRES_ACTIVATION",
      message: existing.portalActive
        ? "An account already exists with this email. Please sign in."
        : "A KhairoDietClinic client record already exists for this email. Request a secure activation link instead.",
    });
  } catch (error) {
    next(error);
  }
}

export async function requestClientPasswordReset(req, res, next) {
  try {
    const email = String(req.body?.email || "").toLowerCase().trim();

    if (!email) {
      return res.status(400).json({ success: false, message: "Email is required." });
    }

    const client = await Client.findOne({
      email,
      isArchived: false,
      portalActive: true,
    });

    if (client) {
      await issueRecoveryToken({
        subjectType: "client",
        subjectId: client._id,
        purpose: "password_reset",
        email: client.email,
        displayName: client.fullName,
      });
    }

    return res.status(200).json({
      success: true,
      message: GENERIC_RESET_MESSAGE,
    });
  } catch (error) {
    next(error);
  }
}

export async function completeClientPasswordReset(req, res, next) {
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
      subjectType: "client",
      purpose: "password_reset",
    });

    if (!recovery) {
      return res.status(400).json({
        success: false,
        code: "INVALID_OR_EXPIRED_TOKEN",
        message: "This reset link is invalid or has expired. Request a new one.",
      });
    }

    const client = await Client.findOne({
      _id: recovery.subjectId,
      isArchived: false,
      portalActive: true,
    }).select("+password");

    if (!client) {
      return res.status(400).json({
        success: false,
        code: "INVALID_OR_EXPIRED_TOKEN",
        message: "This reset link is invalid or has expired. Request a new one.",
      });
    }

    client.password = newPassword;
    await client.save();
    await consumeRecoveryToken(recovery);

    return res.status(200).json({
      success: true,
      message: "Password updated. You can now sign in.",
    });
  } catch (error) {
    next(error);
  }
}

export async function requestClientActivation(req, res, next) {
  try {
    const email = String(req.body?.email || "").toLowerCase().trim();

    if (!email) {
      return res.status(400).json({ success: false, message: "Email is required." });
    }

    const client = await Client.findOne({
      email,
      isArchived: false,
      portalActive: false,
    });

    if (client) {
      await issueRecoveryToken({
        subjectType: "client",
        subjectId: client._id,
        purpose: "portal_activation",
        email: client.email,
        displayName: client.fullName,
      });
    }

    return res.status(200).json({
      success: true,
      message: GENERIC_ACTIVATION_MESSAGE,
    });
  } catch (error) {
    next(error);
  }
}

export async function completeClientActivation(req, res, next) {
  try {
    const token = String(req.body?.token || "").trim();
    const password = String(req.body?.password || "");

    if (!token || !password) {
      return res.status(400).json({
        success: false,
        message: "Activation token and password are required.",
      });
    }

    if (password.length < 8) {
      return res.status(400).json({
        success: false,
        message: "Password must be at least 8 characters.",
      });
    }

    const recovery = await findValidRecoveryToken({
      rawToken: token,
      subjectType: "client",
      purpose: "portal_activation",
    });

    if (!recovery) {
      return res.status(400).json({
        success: false,
        code: "INVALID_OR_EXPIRED_TOKEN",
        message: "This activation link is invalid or has expired. Request a new one.",
      });
    }

    const client = await Client.findOne({
      _id: recovery.subjectId,
      isArchived: false,
      portalActive: false,
    }).select("+password");

    if (!client) {
      return res.status(400).json({
        success: false,
        code: "INVALID_OR_EXPIRED_TOKEN",
        message: "This activation link is invalid or has expired. Request a new one.",
      });
    }

    client.password = password;
    client.portalActive = true;
    await client.save();
    await syncClientPortalAccess(client);
    await consumeRecoveryToken(recovery);

    return res.status(200).json({
      success: true,
      message: "Your KhairoDietClinic account is active. You can now sign in.",
    });
  } catch (error) {
    next(error);
  }
}
