import crypto from "crypto";
import jwt from "jsonwebtoken";
import { isEmailConfigured, sendEmail } from "../utils/mailer.js";
import { ensurePortalSignupFollowUp } from "../services/clientLeadFollowupService.js";
import User from "../models/User.js";
import Client from "../models/Client.js";
import { generateToken, sendTokenCookie } from "../utils/generateToken.js";

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo";
const APPLE_AUTH_URL = "https://appleid.apple.com/auth/authorize";
const APPLE_KEYS_URL = "https://appleid.apple.com/auth/keys";

const CLIENT_URL = String(process.env.CLIENT_URL || "http://localhost:3007")
  .split(",")[0]
  .trim()
  .replace(/\/$/, "");

const API_URL = String(process.env.BACKEND_URL || process.env.RENDER_EXTERNAL_URL || "").trim();

function redirectWithError(res, message) {
  return res.redirect(`${CLIENT_URL}/login?error=${encodeURIComponent(message)}`);
}

function redirectClientWithError(res, message) {
  return res.redirect(`${CLIENT_URL}/portal/login?error=${encodeURIComponent(message)}`);
}

function generateClientToken(clientId) {
  return jwt.sign(
    { id: clientId, type: "client" },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || "8h" }
  );
}

async function sendSocialClientWelcomeEmail(client) {
  if (!client?.email || !isEmailConfigured()) return;

  try {
    await sendEmail({
      to: client.email,
      subject: "Welcome to KhairoDietClinic",
      text: `Hi ${client.fullName},\n\nYour KhairoDietClinic portal account is ready.\n\nYou can sign in anytime using the Google or Apple option on the portal login page.\n\n— KhairoDietClinic`,
      html: `<div style="font-family:sans-serif;background:#0a0a0a;padding:32px;color:#f5f5f5;"><div style="max-width:480px;margin:0 auto;background:#171717;border:1px solid #262626;border-radius:14px;padding:28px;"><h2 style="margin:0 0 10px;color:#ff76c5;">Welcome to KhairoDietClinic</h2><p style="margin:0 0 12px;">Hi ${client.fullName},</p><p style="margin:0 0 12px;color:#d4d4d4;">Your KhairoDietClinic portal account is ready.</p><p style="margin:0;color:#d4d4d4;">You can sign in anytime using <strong>Google</strong> or <strong>Apple</strong> from the portal login page.</p><p style="margin-top:24px;color:#737373;font-size:12px;">— KhairoDietClinic</p></div></div>`,
    });
  } catch (error) {
    console.error("Social client welcome email failed:", error?.message || error);
  }
}

function sendClientTokenCookie(res, token) {
  const expiresDays = Number(process.env.COOKIE_EXPIRES_DAYS || 1);
  res.cookie("clientToken", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: String(process.env.COOKIE_SAME_SITE || "").trim().toLowerCase() || (process.env.NODE_ENV === "production" ? "none" : "lax"),
    maxAge: expiresDays * 24 * 60 * 60 * 1000,
  });
}

function needsProfilePhone(client) {
  const phone = String(client?.phone || "").replace(/\D/g, "");
  return !phone || phone === "0000000000";
}

async function googleProfile(code, redirectUri) {
  const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }).toString(),
  });

  const tokenData = await tokenRes.json().catch(() => ({}));
  if (!tokenRes.ok) {
    throw new Error(tokenData?.error_description || "Google token exchange failed.");
  }

  const userRes = await fetch(GOOGLE_USERINFO_URL, {
    headers: { Authorization: `Bearer ${tokenData.access_token}` },
  });
  const profile = await userRes.json().catch(() => ({}));
  if (!userRes.ok) {
    throw new Error("Google user profile request failed.");
  }

  return profile;
}

function jwkToPem(jwk) {
  const pubKey = crypto.createPublicKey({
    key: {
      kty: jwk.kty,
      n: jwk.n,
      e: jwk.e,
    },
    format: "jwk",
  });
  return pubKey.export({ type: "spki", format: "pem" });
}

async function verifyAppleIdentityToken(idToken) {
  const decodedHeader = jwt.decode(idToken, { complete: true });
  if (!decodedHeader?.header?.kid) {
    throw new Error("Apple id_token is invalid.");
  }

  const keysRes = await fetch(APPLE_KEYS_URL);
  const keysData = await keysRes.json().catch(() => ({}));
  const key = (keysData.keys || []).find((item) => item.kid === decodedHeader.header.kid);

  if (!key) {
    throw new Error("Apple signing key not found.");
  }

  const pem = jwkToPem(key);
  const decoded = jwt.verify(idToken, pem, {
    algorithms: ["RS256"],
    audience: process.env.APPLE_CLIENT_ID,
    issuer: "https://appleid.apple.com",
  });

  return decoded;
}

export const staffGoogleAuth = (req, res) => {
  const redirectUri = `${API_URL || process.env.BACKEND_URL || ""}/api/auth/google/callback`;
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid email profile",
    prompt: "select_account",
  });
  res.redirect(`${GOOGLE_AUTH_URL}?${params.toString()}`);
};

export const staffGoogleCallback = async (req, res) => {
  try {
    const { code } = req.query;
    if (!code) return redirectWithError(res, "Google sign-in was cancelled.");

    const profile = await googleProfile(code, `${API_URL}/api/auth/google/callback`);
    const email = String(profile.email || "").toLowerCase().trim();
    if (!email) return redirectWithError(res, "Google account did not return an email.");

    const user = await User.findOne({
      $or: [{ googleId: profile.sub }, { email }],
    }).select("+googleId");

    if (!user) return redirectWithError(res, "No staff account is linked to that Google account.");

    user.googleId = user.googleId || profile.sub;
    user.lastLogin = new Date();
    await user.save({ validateBeforeSave: false });

    const token = generateToken(user._id);
    sendTokenCookie(res, token);

    return res.redirect(`${CLIENT_URL}/dashboard`);
  } catch (error) {
    console.error("Staff Google callback error:", error.message);
    return redirectWithError(res, error.message);
  }
};

export const staffAppleAuth = (req, res) => {
  const params = new URLSearchParams({
    client_id: process.env.APPLE_CLIENT_ID,
    redirect_uri: `${API_URL}/api/auth/apple/callback`,
    response_type: "code id_token",
    scope: "name email",
    response_mode: "form_post",
  });
  res.redirect(`${APPLE_AUTH_URL}?${params.toString()}`);
};

export const staffAppleCallback = async (req, res) => {
  try {
    const { id_token } = req.body || {};
    if (!id_token) return redirectWithError(res, "Apple sign-in was cancelled.");

    const profile = await verifyAppleIdentityToken(id_token);
    const email = String(profile.email || "").toLowerCase().trim();
    const sub = String(profile.sub || "");

    const user = await User.findOne({
      $or: [{ appleId: sub }, email ? { email } : {}],
    }).select("+appleId");

    if (!user) return redirectWithError(res, "No staff account is linked to that Apple ID.");

    user.appleId = user.appleId || sub;
    user.lastLogin = new Date();
    await user.save({ validateBeforeSave: false });

    const token = generateToken(user._id);
    sendTokenCookie(res, token);

    return res.redirect(`${CLIENT_URL}/dashboard`);
  } catch (error) {
    console.error("Staff Apple callback error:", error.message);
    return redirectWithError(res, error.message);
  }
};

export const clientGoogleAuth = (req, res) => {
  const redirectUri = `${API_URL}/api/client-auth/google/callback`;
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid email profile",
    prompt: "select_account",
  });
  res.redirect(`${GOOGLE_AUTH_URL}?${params.toString()}`);
};

export const clientGoogleCallback = async (req, res) => {
  try {
    const { code } = req.query;
    if (!code) return redirectClientWithError(res, "Google sign-in was cancelled.");

    const profile = await googleProfile(code, `${API_URL}/api/client-auth/google/callback`);
    const email = String(profile.email || "").toLowerCase().trim();
    if (!email) return redirectClientWithError(res, "Google account did not return an email.");

    let client = await Client.findOne({
      $or: [{ googleId: profile.sub }, { email }],
    }).select("+googleId");

    let createdNew = false;

    if (!client) {
      client = await Client.create({
        fullName: profile.name || email.split("@")[0],
        email,
        phone: "0000000000",
        googleId: profile.sub,
        program: "not_sure",
        cycleWeeks: 8,
        password: crypto.randomBytes(16).toString("hex"),
        portalActive: true,
        accountStage: "preview",
        registeredFromPortal: true,
        reconciled: false,
      });
      createdNew = true;
    } else {
      client.googleId = client.googleId || profile.sub;
      if (!client.password) client.password = crypto.randomBytes(16).toString("hex");
    }

    client.portalLastLogin = new Date();
    await client.save({ validateBeforeSave: false });

    if (createdNew) {
      await sendSocialClientWelcomeEmail(client);
    }

    await ensurePortalSignupFollowUp(client);

    const token = generateClientToken(client._id);
    sendClientTokenCookie(res, token);

    const target = needsProfilePhone(client)
      ? "/portal/complete-profile"
      : "/portal";

    return res.redirect(`${CLIENT_URL}${target}`);
  } catch (error) {
    console.error("Client Google callback error:", error.message);
    return redirectClientWithError(res, error.message);
  }
};

export const clientAppleAuth = (req, res) => {
  const params = new URLSearchParams({
    client_id: process.env.APPLE_CLIENT_ID,
    redirect_uri: `${API_URL}/api/client-auth/apple/callback`,
    response_type: "code id_token",
    scope: "name email",
    response_mode: "form_post",
  });
  res.redirect(`${APPLE_AUTH_URL}?${params.toString()}`);
};

export const clientAppleCallback = async (req, res) => {
  try {
    const { id_token } = req.body || {};
    if (!id_token) return redirectClientWithError(res, "Apple sign-in was cancelled.");

    const profile = await verifyAppleIdentityToken(id_token);
    const email = String(profile.email || "").toLowerCase().trim();
    const sub = String(profile.sub || "");

    let client = await Client.findOne({
      $or: [{ appleId: sub }, email ? { email } : {}],
    }).select("+appleId");

    let createdNew = false;

    if (!client) {
      client = await Client.create({
        fullName: email ? email.split("@")[0] : "KhairoDietClinic Client",
        email,
        phone: "0000000000",
        appleId: sub,
        program: "not_sure",
        cycleWeeks: 8,
        password: crypto.randomBytes(16).toString("hex"),
        portalActive: true,
        accountStage: "preview",
        registeredFromPortal: true,
        reconciled: false,
      });
      createdNew = true;
    } else {
      client.appleId = client.appleId || sub;
      if (!client.password) client.password = crypto.randomBytes(16).toString("hex");
    }

    client.portalLastLogin = new Date();
    await client.save({ validateBeforeSave: false });

    if (createdNew) {
      await sendSocialClientWelcomeEmail(client);
    }

    await ensurePortalSignupFollowUp(client);

    const token = generateClientToken(client._id);
    sendClientTokenCookie(res, token);

    return res.redirect(`${CLIENT_URL}/portal`);
  } catch (error) {
    console.error("Client Apple callback error:", error.message);
    return redirectClientWithError(res, error.message);
  }
};
