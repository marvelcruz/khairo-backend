import crypto from "crypto";
import AuthRecoveryToken from "../models/AuthRecoveryToken.js";
import { isEmailConfigured, sendEmail } from "../utils/mailer.js";

const RESET_TTL_MS = 30 * 60 * 1000;
const ACTIVATION_TTL_MS = 24 * 60 * 60 * 1000;

function hashToken(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function appBaseUrl() {
  return String(process.env.CLIENT_URL || "").trim().replace(/\/$/, "");
}

function recoveryMessage({ purpose, displayName, link }) {
  const firstName = String(displayName || "").trim().split(/\s+/)[0] || "there";
  const safeName = escapeHtml(firstName);
  const safeLink = escapeHtml(link);

  if (purpose === "portal_activation") {
    return {
      subject: "Activate your Khairo Diet Clinic account",
      text:
        `Hi ${firstName},\n\nUse this secure link to activate your Khairo Diet Clinic account. The link expires in 24 hours:\n${link}\n\nIf you did not request this, you can ignore this email.\n\nKhairo Diet Clinic`,
      html:
        `<p>Hi ${safeName},</p><p>Use the secure link below to activate your Khairo Diet Clinic account. The link expires in 24 hours.</p><p><a href="${safeLink}">Activate my Khairo Diet Clinic account</a></p><p>If you did not request this, you can ignore this email.</p><p>Khairo Diet Clinic</p>`,
    };
  }

  return {
    subject: "Reset your Khairo Diet Clinic password",
    text:
      `Hi ${firstName},\n\nUse this secure link to reset your Khairo Diet Clinic password. The link expires in 30 minutes:\n${link}\n\nIf you did not request this, you can ignore this email.\n\nKhairo Diet Clinic`,
    html:
      `<p>Hi ${safeName},</p><p>Use the secure link below to reset your Khairo Diet Clinic password. The link expires in 30 minutes.</p><p><a href="${safeLink}">Reset my Khairo Diet Clinic password</a></p><p>If you did not request this, you can ignore this email.</p><p>Khairo Diet Clinic</p>`,
  };
}

function linkPath({ subjectType, purpose, rawToken }) {
  const encoded = encodeURIComponent(rawToken);

  if (subjectType === "staff") {
    return `/login/reset-password?token=${encoded}`;
  }

  if (purpose === "portal_activation") {
    return `/portal/activate?token=${encoded}`;
  }

  return `/portal/reset-password?token=${encoded}`;
}

export async function issueRecoveryToken({
  subjectType,
  subjectId,
  purpose,
  email,
  displayName,
}) {
  const baseUrl = appBaseUrl();

  if (!baseUrl || !isEmailConfigured() || !email) {
    return { status: "not_sent", reason: "delivery_not_configured" };
  }

  await AuthRecoveryToken.deleteMany({
    subjectType,
    subjectId,
    purpose,
    usedAt: { $exists: false },
  });

  const rawToken = crypto.randomBytes(32).toString("hex");
  const tokenHash = hashToken(rawToken);
  const ttlMs = purpose === "portal_activation" ? ACTIVATION_TTL_MS : RESET_TTL_MS;
  const expiresAt = new Date(Date.now() + ttlMs);

  const record = await AuthRecoveryToken.create({
    subjectType,
    subjectId,
    purpose,
    tokenHash,
    expiresAt,
  });

  const link = `${baseUrl}${linkPath({ subjectType, purpose, rawToken })}`;
  const message = recoveryMessage({ purpose, displayName, link });

  try {
    await sendEmail({
      to: email,
      subject: message.subject,
      text: message.text,
      html: message.html,
    });

    return { status: "sent" };
  } catch (error) {
    await AuthRecoveryToken.deleteOne({ _id: record._id }).catch(() => {});
    console.error("Recovery email delivery failed:", error?.message || error);
    return { status: "failed", reason: "delivery_failed" };
  }
}

export async function findValidRecoveryToken({ rawToken, subjectType, purpose }) {
  const tokenHash = hashToken(rawToken);

  if (!rawToken || !tokenHash) return null;

  return AuthRecoveryToken.findOne({
    subjectType,
    purpose,
    tokenHash,
    usedAt: { $exists: false },
    expiresAt: { $gt: new Date() },
  }).select("+tokenHash");
}

export async function consumeRecoveryToken(record) {
  if (!record) return;

  record.usedAt = new Date();
  await record.save();

  await AuthRecoveryToken.deleteMany({
    subjectType: record.subjectType,
    subjectId: record.subjectId,
    purpose: record.purpose,
    _id: { $ne: record._id },
  });
}
