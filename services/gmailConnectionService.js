import ConnectionAccount from "../models/ConnectionAccount.js";
import {
  decryptConnectionSecret,
  encryptConnectionSecret,
} from "./connectionCredentialService.js";

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GMAIL_SEND_URL = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send";
const REFRESH_EARLY_MS = 2 * 60 * 1000;

async function gmailConnection() {
  return ConnectionAccount.findOne({
    workspaceKey: "business",
    provider: "google_gmail",
    status: "connected",
  }).select("+accessTokenEncrypted +refreshTokenEncrypted");
}

async function refreshAccessToken(account) {
  const refreshToken = decryptConnectionSecret(account.refreshTokenEncrypted);
  const clientId = String(process.env.GOOGLE_OAUTH_CLIENT_ID || "").trim();
  const clientSecret = String(process.env.GOOGLE_OAUTH_CLIENT_SECRET || "").trim();

  if (!refreshToken || !clientId || !clientSecret) {
    const error = new Error("Reconnect Gmail in KhairoDietClinic Setup.");
    error.code = "GMAIL_RECONNECT_REQUIRED";
    throw error;
  }

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });

  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const data = await response.json().catch(() => ({}));

  if (!response.ok || !data.access_token) {
    account.status = "error";
    account.lastError =
      data?.error_description || "Gmail needs to be reconnected.";
    await account.save();

    const error = new Error("Gmail needs to be reconnected in KhairoDietClinic Setup.");
    error.code = "GMAIL_RECONNECT_REQUIRED";
    throw error;
  }

  account.accessTokenEncrypted = encryptConnectionSecret(data.access_token);
  account.tokenExpiresAt = data.expires_in
    ? new Date(Date.now() + Number(data.expires_in) * 1000)
    : null;
  account.lastCheckedAt = new Date();
  account.lastError = "";
  await account.save();

  return data.access_token;
}

async function accessToken(account) {
  const expiresAt = account.tokenExpiresAt?.getTime?.() || 0;
  const current = decryptConnectionSecret(account.accessTokenEncrypted);

  if (current && (!expiresAt || expiresAt - Date.now() > REFRESH_EARLY_MS)) {
    return current;
  }

  return refreshAccessToken(account);
}

function encodeHeader(value) {
  const text = String(value || "");
  return `=?UTF-8?B?${Buffer.from(text, "utf8").toString("base64")}?=`;
}

function mimeMessage({ to, subject, text, html }) {
  const boundary = `khairo_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const plain = String(text || "").trim() || String(html || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  const rich = String(html || "").trim() || `<p>${plain.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</p>`;

  return [
    `To: ${to}`,
    `Subject: ${encodeHeader(subject)}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary=\"${boundary}\"`,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    plain,
    "",
    `--${boundary}`,
    "Content-Type: text/html; charset=UTF-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    rich,
    "",
    `--${boundary}--`,
    "",
  ].join("\r\n");
}

export async function isConnectedGmailAvailable() {
  const account = await gmailConnection();
  return Boolean(account);
}

export async function sendConnectedGmail({ to, subject, html, text }) {
  const account = await gmailConnection();
  if (!account) {
    const error = new Error("Gmail is not connected.");
    error.code = "GMAIL_NOT_CONNECTED";
    throw error;
  }

  const token = await accessToken(account);
  const raw = Buffer.from(
    mimeMessage({ to, subject, text, html }),
    "utf8"
  ).toString("base64url");

  const response = await fetch(GMAIL_SEND_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ raw }),
  });
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const message =
      data?.error?.message || "Gmail could not send this message.";
    account.lastError = message;
    account.lastCheckedAt = new Date();
    if (response.status === 401) account.status = "error";
    await account.save();

    const error = new Error(message);
    error.status = 502;
    throw error;
  }

  account.lastCheckedAt = new Date();
  account.lastError = "";
  await account.save();

  return {
    provider: "gmail",
    id: data.id || "",
    threadId: data.threadId || "",
  };
}
