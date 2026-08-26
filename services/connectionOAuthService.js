import crypto from "crypto";

const TEN_MINUTES = 10 * 60 * 1000;

const PROVIDERS = {
  google_gmail: {
    label: "Gmail",
    authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    clientIdEnv: "GOOGLE_OAUTH_CLIENT_ID",
    clientSecretEnv: "GOOGLE_OAUTH_CLIENT_SECRET",
    scopes: [
      "openid",
      "email",
      "profile",
      "https://www.googleapis.com/auth/gmail.send",
    ],
  },
  google_business: {
    label: "Google Business Profile",
    authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    clientIdEnv: "GOOGLE_OAUTH_CLIENT_ID",
    clientSecretEnv: "GOOGLE_OAUTH_CLIENT_SECRET",
    scopes: [
      "openid",
      "email",
      "profile",
      "https://www.googleapis.com/auth/business.manage",
    ],
  },
  instagram: {
    label: "Instagram",
    authUrl: "https://www.instagram.com/oauth/authorize",
    tokenUrl: "https://api.instagram.com/oauth/access_token",
    clientIdEnv: "INSTAGRAM_APP_ID",
    clientSecretEnv: "INSTAGRAM_APP_SECRET",
    scopes: [
      "instagram_business_basic",
      "instagram_business_content_publish",
    ],
  },
  facebook: {
    label: "Facebook",
    authUrl: "https://www.facebook.com/v25.0/dialog/oauth",
    tokenUrl: "https://graph.facebook.com/v25.0/oauth/access_token",
    clientIdEnv: "META_APP_ID",
    clientSecretEnv: "META_APP_SECRET",
    scopes: ["pages_show_list", "pages_read_engagement", "pages_manage_posts"],
  },
  whatsapp: {
    label: "WhatsApp Business",
    authUrl: "https://www.facebook.com/v25.0/dialog/oauth",
    tokenUrl: "https://graph.facebook.com/v25.0/oauth/access_token",
    clientIdEnv: "META_APP_ID",
    clientSecretEnv: "META_APP_SECRET",
    scopes: ["business_management", "whatsapp_business_management", "whatsapp_business_messaging"],
  },
  linkedin: {
    label: "LinkedIn",
    authUrl: "https://www.linkedin.com/oauth/v2/authorization",
    tokenUrl: "https://www.linkedin.com/oauth/v2/accessToken",
    clientIdEnv: "LINKEDIN_CLIENT_ID",
    clientSecretEnv: "LINKEDIN_CLIENT_SECRET",
    scopes: ["openid", "profile", "email", "w_member_social"],
  },
  tiktok: {
    label: "TikTok",
    authUrl: "https://www.tiktok.com/v2/auth/authorize/",
    tokenUrl: "https://open.tiktokapis.com/v2/oauth/token/",
    clientIdEnv: "TIKTOK_CLIENT_KEY",
    clientSecretEnv: "TIKTOK_CLIENT_SECRET",
    scopes: ["user.info.basic", "video.publish"],
  },
};

function signingSecret() {
  const value = String(process.env.JWT_SECRET || "").trim();
  if (!value) throw new Error("Secure sign-in links are not configured.");
  return value;
}

function b64(value) {
  return Buffer.from(value, "utf8").toString("base64url");
}

function unb64(value) {
  return Buffer.from(value, "base64url").toString("utf8");
}

function sign(value) {
  return crypto.createHmac("sha256", signingSecret()).update(value).digest("base64url");
}

export function providerDefinition(provider) {
  return PROVIDERS[provider] || null;
}

export function publicProviderDefinitions() {
  return Object.entries(PROVIDERS).map(([provider, definition]) => ({
    provider,
    label: definition.label,
    configured: Boolean(
      process.env[definition.clientIdEnv] && process.env[definition.clientSecretEnv]
    ),
  }));
}

export function createConnectionState({ provider, userId, workspaceKey }) {
  const payload = b64(JSON.stringify({
    provider,
    userId: String(userId),
    workspaceKey: String(workspaceKey || "business"),
    nonce: crypto.randomBytes(12).toString("hex"),
    exp: Date.now() + TEN_MINUTES,
  }));
  return `${payload}.${sign(payload)}`;
}

export function verifyConnectionState(state) {
  const [payload, signature] = String(state || "").split(".");
  if (!payload || !signature) throw new Error("This connection request is no longer valid.");
  const expected = sign(payload);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    throw new Error("This connection request is no longer valid.");
  }
  const parsed = JSON.parse(unb64(payload));
  if (!parsed.exp || parsed.exp < Date.now()) throw new Error("This connection request has expired. Please try again.");
  if (!PROVIDERS[parsed.provider]) throw new Error("This connection is not supported.");
  return parsed;
}

export function callbackUrl(req, provider) {
  const explicit = String(process.env.OAUTH_CALLBACK_BASE_URL || "")
    .trim()
    .replace(/\/$/, "");
  if (explicit) return `${explicit}/${provider}`;

  const forwardedProto = String(req.get("x-forwarded-proto") || "")
    .split(",")[0]
    .trim();
  const forwardedHost = String(req.get("x-forwarded-host") || "")
    .split(",")[0]
    .trim();
  const protocol = forwardedProto || req.protocol || "https";
  const host = forwardedHost || req.get("host");

  return `${protocol}://${host}/api/social/connections/callback/${provider}`;
}

export function authorizationUrl({ provider, state, redirectUri }) {
  const definition = providerDefinition(provider);
  if (!definition) throw new Error("This connection is not supported.");
  const clientId = process.env[definition.clientIdEnv];
  if (!clientId || !process.env[definition.clientSecretEnv]) {
    const error = new Error(`${definition.label} sign-in is not available yet.`);
    error.statusCode = 503;
    throw error;
  }

  const url = new URL(definition.authUrl);
  if (provider === "tiktok") url.searchParams.set("client_key", clientId);
  else url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set(
    "scope",
    definition.scopes.join(["instagram", "tiktok"].includes(provider) ? "," : " ")
  );
  url.searchParams.set("state", state);

  if (provider.startsWith("google_")) {
    url.searchParams.set("access_type", "offline");
    url.searchParams.set("prompt", "consent");
    url.searchParams.set("include_granted_scopes", "true");
  }

  return url.toString();
}

async function exchangeInstagramCode({ definition, clientId, clientSecret, code, redirectUri }) {
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "authorization_code",
    redirect_uri: redirectUri,
    code,
  });

  const shortResponse = await fetch(definition.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const shortToken = await shortResponse.json().catch(() => ({}));

  if (!shortResponse.ok || !shortToken.access_token) {
    throw new Error(
      shortToken?.error_message ||
        shortToken?.error?.message ||
        "Instagram could not be connected."
    );
  }

  const longUrl = new URL("https://graph.instagram.com/access_token");
  longUrl.searchParams.set("grant_type", "ig_exchange_token");
  longUrl.searchParams.set("client_secret", clientSecret);
  longUrl.searchParams.set("access_token", shortToken.access_token);

  const longResponse = await fetch(longUrl);
  const longToken = await longResponse.json().catch(() => ({}));

  if (!longResponse.ok || !longToken.access_token) {
    throw new Error(
      longToken?.error?.message ||
        "Instagram connected, but KhairoDietClinic could not keep the connection active."
    );
  }

  return {
    ...longToken,
    user_id: shortToken.user_id || longToken.user_id,
  };
}

export async function exchangeAuthorizationCode({ provider, code, redirectUri }) {
  const definition = providerDefinition(provider);
  if (!definition) throw new Error("This connection is not supported.");
  const clientId = process.env[definition.clientIdEnv];
  const clientSecret = process.env[definition.clientSecretEnv];
  if (!clientId || !clientSecret) throw new Error(`${definition.label} sign-in is not available yet.`);

  if (provider === "instagram") {
    return exchangeInstagramCode({ definition, clientId, clientSecret, code, redirectUri });
  }

  if (["facebook", "whatsapp"].includes(provider)) {
    const url = new URL(definition.tokenUrl);
    url.searchParams.set("client_id", clientId);
    url.searchParams.set("client_secret", clientSecret);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("code", code);
    const response = await fetch(url);
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.access_token) throw new Error(data?.error?.message || `${definition.label} could not be connected.`);
    return data;
  }

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    client_secret: clientSecret,
  });
  if (provider === "tiktok") body.set("client_key", clientId);
  else body.set("client_id", clientId);

  const response = await fetch(definition.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.access_token) {
    throw new Error(data?.error_description || data?.error?.message || `${definition.label} could not be connected.`);
  }
  return data;
}

async function getJson(url, accessToken, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(options.headers || {}),
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error?.message || data?.message || "The connected account could not be read.");
  return data;
}

export async function discoverProviderAccounts(provider, accessToken) {
  if (provider === "google_gmail") {
    const profile = await getJson("https://openidconnect.googleapis.com/v1/userinfo", accessToken);
    return [{ id: profile.sub || profile.email, name: profile.email || profile.name || "Google account" }];
  }

  if (provider === "google_business") {
    const result = await getJson("https://mybusinessaccountmanagement.googleapis.com/v1/accounts", accessToken);
    return (result.accounts || []).map((account) => ({
      id: account.name || "",
      name: account.accountName || account.name || "Google Business Profile",
      raw: account,
    })).filter((account) => account.id);
  }

  if (provider === "instagram") {
    const profile = await getJson(
      "https://graph.instagram.com/me?fields=user_id,username,name",
      accessToken
    );
    const id = profile.user_id || profile.id || "";
    return id
      ? [{
          id,
          name: profile.username ? `@${profile.username}` : profile.name || "Instagram account",
          raw: { username: profile.username || "", name: profile.name || "" },
        }]
      : [];
  }

  if (provider === "linkedin") {
    const profile = await getJson("https://api.linkedin.com/v2/userinfo", accessToken);
    return [{ id: profile.sub || "", name: profile.name || profile.email || "LinkedIn account" }].filter((account) => account.id);
  }

  if (provider === "tiktok") {
    const result = await getJson(
      "https://open.tiktokapis.com/v2/user/info/?fields=open_id,union_id,display_name,avatar_url",
      accessToken
    );
    const user = result?.data?.user || {};
    return [{ id: user.open_id || user.union_id || "", name: user.display_name || "TikTok account" }].filter((account) => account.id);
  }

  if (provider === "facebook") {
    const result = await getJson("https://graph.facebook.com/v25.0/me/accounts?fields=id,name", accessToken);
    return (result.data || []).map((page) => ({ id: page.id, name: page.name || "Facebook Page", raw: page }));
  }

  if (provider === "whatsapp") {
    const result = await getJson(
      "https://graph.facebook.com/v25.0/me/businesses?fields=id,name,owned_whatsapp_business_accounts{id,name}",
      accessToken
    );
    const accounts = [];
    for (const business of result.data || []) {
      for (const item of business.owned_whatsapp_business_accounts?.data || []) {
        accounts.push({ id: item.id, name: item.name || business.name || "WhatsApp Business", raw: { businessId: business.id } });
      }
    }
    return accounts;
  }

  return [];
}
