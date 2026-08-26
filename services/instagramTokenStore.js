import crypto from "crypto";
import mongoose from "mongoose";

import SocialAccount from "../models/SocialAccount.js";

const REFRESH_WINDOW_MS =
  10 * 24 * 60 * 60 * 1000;

const DEFAULT_LIFETIME_SECONDS =
  60 * 24 * 60 * 60;

function encryptionKey() {
  const raw =
    process.env.INSTAGRAM_TOKEN_ENCRYPTION_KEY ||
    process.env.INTEGRATION_TOKEN_ENCRYPTION_KEY ||
    process.env.JWT_SECRET;

  if (!raw) {
    throw new Error(
      "Secure Instagram connection storage is not configured."
    );
  }

  if (/^[a-f0-9]{64}$/i.test(raw)) {
    return Buffer.from(raw, "hex");
  }

  return crypto
    .createHash("sha256")
    .update(raw)
    .digest();
}

function encrypt(token) {
  const iv = crypto.randomBytes(12);

  const cipher = crypto.createCipheriv(
    "aes-256-gcm",
    encryptionKey(),
    iv
  );

  const ciphertext = Buffer.concat([
    cipher.update(token, "utf8"),
    cipher.final(),
  ]);

  const tag = cipher.getAuthTag();

  return [
    "v1",
    iv.toString("hex"),
    tag.toString("hex"),
    ciphertext.toString("hex"),
  ].join(":");
}

function decrypt(value) {
  const [version, ivHex, tagHex, dataHex] =
    String(value).split(":");

  if (
    version !== "v1" ||
    !ivHex ||
    !tagHex ||
    !dataHex
  ) {
    throw new Error(
      "Stored Instagram token is invalid."
    );
  }

  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    encryptionKey(),
    Buffer.from(ivHex, "hex")
  );

  decipher.setAuthTag(
    Buffer.from(tagHex, "hex")
  );

  return Buffer.concat([
    decipher.update(
      Buffer.from(dataHex, "hex")
    ),
    decipher.final(),
  ]).toString("utf8");
}

async function accountWithToken() {
  if (
    mongoose.connection.readyState !== 1
  ) {
    return null;
  }

  const connected = await SocialAccount.findOne({
    provider: "instagram",
    status: "connected",
    isArchived: false,
  }).select("+accessTokenEncrypted");

  if (connected) return connected;

  // Compatibility for the existing Khairo Diet Clinic connection during migration.
  return SocialAccount.findOne({
    provider: "instagram",
    isArchived: false,
  }).select("+accessTokenEncrypted");
}

export async function saveInstagramAccessToken(
  token,
  expiresInSeconds =
    DEFAULT_LIFETIME_SECONDS
) {
  if (!token) {
    throw new Error(
      "Instagram access token is required."
    );
  }

  const account =
    await accountWithToken();

  if (!account) {
    throw new Error(
      "Connected Instagram account not found."
    );
  }

  account.accessTokenEncrypted =
    encrypt(token);

  account.tokenExpiresAt =
    new Date(
      Date.now() +
        Number(expiresInSeconds) * 1000
    );

  account.lastTokenRefreshAt =
    new Date();

  account.status = "connected";
  account.connectionError = "";

  await account.save();

  return account;
}

export async function getInstagramAccessToken() {
  const account =
    await accountWithToken();

  if (
    account?.accessTokenEncrypted
  ) {
    return decrypt(
      account.accessTokenEncrypted
    );
  }

  const fallback =
    process.env.INSTAGRAM_ACCESS_TOKEN;

  if (!fallback) {
    throw new Error(
      "Instagram is not connected."
    );
  }

  return fallback;
}

export async function refreshInstagramAccessToken() {
  const token =
    await getInstagramAccessToken();

  const url = new URL(
    "https://graph.instagram.com/refresh_access_token"
  );

  url.searchParams.set(
    "grant_type",
    "ig_refresh_token"
  );

  url.searchParams.set(
    "access_token",
    token
  );

  const response = await fetch(url);

  const data = await response.json();

  if (
    !response.ok ||
    data.error
  ) {
    const message =
      data?.error?.message ||
      "Instagram token refresh failed.";

    const account =
      await accountWithToken();

    if (account) {
      account.connectionError =
        message;
      await account.save();
    }

    const error =
      new Error(message);

    error.instagramCode =
      data?.error?.code;

    throw error;
  }

  const refreshedToken =
    data.access_token || token;

  const expiresIn =
    Number(data.expires_in) ||
    DEFAULT_LIFETIME_SECONDS;

  await saveInstagramAccessToken(
    refreshedToken,
    expiresIn
  );

  return {
    refreshed: true,
    expiresIn,
  };
}

export async function maybeRefreshInstagramAccessToken() {
  const account =
    await accountWithToken();

  if (!account) {
    return {
      refreshed: false,
      reason: "no-account",
    };
  }

  if (!account.tokenExpiresAt) {
    return {
      refreshed: false,
      reason: "expiry-unknown",
    };
  }

  const remaining =
    account.tokenExpiresAt.getTime() -
    Date.now();

  if (remaining <= 0) {
    account.status = "error";
    account.connectionError =
      "Instagram authorization has expired. Reconnect Instagram.";

    await account.save();

    return {
      refreshed: false,
      expired: true,
    };
  }

  if (remaining > REFRESH_WINDOW_MS) {
    return {
      refreshed: false,
      reason: "not-due",
    };
  }

  try {
    return await refreshInstagramAccessToken();
  } catch (error) {
    // The existing token may still work
    // until its actual expiry date.
    return {
      refreshed: false,
      error: error.message,
    };
  }
}

export async function getInstagramConnectionState() {
  const account =
    await accountWithToken();

  if (!account) {
    return {
      connected: false,
      status: "setup_required",
    };
  }

  let daysRemaining = null;

  if (account.tokenExpiresAt) {
    daysRemaining =
      Math.max(
        0,
        Math.ceil(
          (
            account.tokenExpiresAt.getTime() -
            Date.now()
          ) /
            (24 * 60 * 60 * 1000)
        )
      );
  }

  return {
    connected:
      account.status === "connected",
    status: account.status,
    handle: account.handle,
    tokenExpiresAt:
      account.tokenExpiresAt,
    lastTokenRefreshAt:
      account.lastTokenRefreshAt,
    daysRemaining,
    connectionError:
      account.connectionError || "",
  };
}
