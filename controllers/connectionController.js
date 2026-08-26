import ConnectionAccount from "../models/ConnectionAccount.js";
import SocialAccount from "../models/SocialAccount.js";
import { encryptConnectionSecret } from "../services/connectionCredentialService.js";
import { saveInstagramAccessToken } from "../services/instagramTokenStore.js";
import {
  authorizationUrl,
  callbackUrl,
  createConnectionState,
  discoverProviderAccounts,
  exchangeAuthorizationCode,
  providerDefinition,
  publicProviderDefinitions,
  verifyConnectionState,
} from "../services/connectionOAuthService.js";

function workspaceKey(user) {
  return String(user?.workspaceKey || "business").trim().toLowerCase() || "business";
}

function frontendBase() {
  return String(process.env.CLIENT_URL || "").split(",")[0].trim().replace(/\/$/, "");
}

function finishUrl(provider, result, message = "") {
  const base = frontendBase();
  if (!base) return "/";
  const url = new URL("/dashboard/setup", base);
  url.searchParams.set("provider", provider);
  url.searchParams.set("connection", result);
  if (message) url.searchParams.set("message", message.slice(0, 180));
  return url.toString();
}

function safeConnection(account) {
  if (!account) return null;
  return {
    provider: account.provider,
    status: account.status,
    displayName: account.displayName,
    externalAccountId: account.externalAccountId,
    scopes: account.scopes || [],
    tokenExpiresAt: account.tokenExpiresAt,
    connectedAt: account.connectedAt,
    lastCheckedAt: account.lastCheckedAt,
    lastError: account.lastError || "",
    availableAccounts: Array.isArray(account.metadata?.availableAccounts)
      ? account.metadata.availableAccounts.map((item) => ({ id: item.id, name: item.name }))
      : [],
  };
}

async function syncInstagramRuntime({ selected, accessToken, expiresIn }) {
  if (!selected?.id || !accessToken) return;

  // Khairo Diet Clinic currently uses one Instagram publishing identity. Archive stale
  // runtime records so the established token store always resolves the account
  // the staff member just connected.
  await SocialAccount.updateMany(
    {
      provider: "instagram",
      isArchived: false,
      externalAccountId: { $ne: selected.id },
    },
    {
      $set: {
        status: "disconnected",
        isArchived: true,
      },
    }
  );

  const handle = String(selected.name || "").startsWith("@")
    ? String(selected.name).slice(1)
    : String(selected.raw?.username || "").trim();

  await SocialAccount.findOneAndUpdate(
    {
      provider: "instagram",
      externalAccountId: selected.id,
      isArchived: false,
    },
    {
      $set: {
        displayName: selected.name || "Instagram",
        handle,
        externalAccountId: selected.id,
        status: "connected",
        connectedAt: new Date(),
        lastSyncedAt: new Date(),
        connectionError: "",
        isArchived: false,
      },
    },
    {
      upsert: true,
      new: true,
      setDefaultsOnInsert: true,
      runValidators: true,
    }
  );

  await saveInstagramAccessToken(
    accessToken,
    Number(expiresIn) || 60 * 24 * 60 * 60
  );
}

export const listConnections = async (req, res, next) => {
  try {
    const key = workspaceKey(req.user);
    const accounts = await ConnectionAccount.find({ workspaceKey: key }).lean();
    const byProvider = new Map(accounts.map((account) => [account.provider, account]));
    const providers = publicProviderDefinitions().map((definition) => ({
      ...definition,
      connection: safeConnection(byProvider.get(definition.provider)),
    }));
    res.json({ success: true, providers });
  } catch (error) {
    next(error);
  }
};

export const startConnection = async (req, res, next) => {
  try {
    const provider = String(req.params.provider || "").trim();
    const definition = providerDefinition(provider);
    if (!definition) return res.status(404).json({ success: false, message: "That connection is not available." });

    const redirectUri = callbackUrl(req, provider);
    const state = createConnectionState({
      provider,
      userId: req.user._id,
      workspaceKey: workspaceKey(req.user),
    });
    const url = authorizationUrl({ provider, state, redirectUri });
    res.json({ success: true, authorizationUrl: url });
  } catch (error) {
    if (error?.statusCode) return res.status(error.statusCode).json({ success: false, message: error.message });
    next(error);
  }
};

export const connectionCallback = async (req, res) => {
  const provider = String(req.params.provider || "").trim();
  try {
    if (req.query?.error) {
      return res.redirect(finishUrl(provider, "cancelled", "Connection cancelled."));
    }
    const state = verifyConnectionState(req.query?.state);
    if (state.provider !== provider) throw new Error("This connection request does not match the provider.");
    const code = String(req.query?.code || "").trim();
    if (!code) throw new Error("The provider did not return permission to connect.");

    const redirectUri = callbackUrl(req, provider);
    const token = await exchangeAuthorizationCode({ provider, code, redirectUri });
    const accessToken = token.access_token;
    const accounts = await discoverProviderAccounts(provider, accessToken);
    const selected = accounts.length === 1 ? accounts[0] : null;
    const definition = providerDefinition(provider);

    const update = {
      workspaceKey: state.workspaceKey,
      provider,
      status: selected ? "connected" : "needs_selection",
      displayName: selected?.name || definition.label,
      externalAccountId: selected?.id || "",
      scopes: String(token.scope || "")
        .split(/[ ,]+/)
        .filter(Boolean),
      accessTokenEncrypted: encryptConnectionSecret(accessToken),
      refreshTokenEncrypted: token.refresh_token
        ? encryptConnectionSecret(token.refresh_token)
        : undefined,
      tokenExpiresAt: token.expires_in
        ? new Date(Date.now() + Number(token.expires_in) * 1000)
        : null,
      connectedAt: selected ? new Date() : null,
      lastCheckedAt: new Date(),
      lastError: "",
      metadata: {
        availableAccounts: accounts.map((item) => ({
          id: item.id,
          name: item.name,
          raw: item.raw || {},
        })),
      },
      connectedBy: state.userId,
    };

    const set = { ...update };
    if (!set.refreshTokenEncrypted) delete set.refreshTokenEncrypted;

    await ConnectionAccount.findOneAndUpdate(
      { workspaceKey: state.workspaceKey, provider },
      { $set: set },
      { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true }
    );

    if (provider === "instagram" && selected) {
      await syncInstagramRuntime({
        selected,
        accessToken,
        expiresIn: token.expires_in,
      });
    }

    const result = selected ? "success" : "select";
    const message = selected
      ? `${definition.label} connected.`
      : `Choose the ${definition.label} account you want to use.`;
    return res.redirect(finishUrl(provider, result, message));
  } catch (error) {
    console.error("Connection callback failed:", provider, error?.message || error);
    return res.redirect(
      finishUrl(provider, "error", error?.message || "Connection could not be completed.")
    );
  }
};

export const selectConnectionAccount = async (req, res, next) => {
  try {
    const provider = String(req.params.provider || "").trim();
    const key = workspaceKey(req.user);
    const account = await ConnectionAccount.findOne({ workspaceKey: key, provider });
    if (!account) return res.status(404).json({ success: false, message: "Start this connection first." });
    const id = String(req.body?.externalAccountId || "").trim();
    const choices = Array.isArray(account.metadata?.availableAccounts)
      ? account.metadata.availableAccounts
      : [];
    const selected = choices.find((item) => String(item.id) === id);
    if (!selected) return res.status(400).json({ success: false, message: "Choose one of the available accounts." });

    account.externalAccountId = selected.id;
    account.displayName = selected.name;
    account.status = "connected";
    account.connectedAt = new Date();
    account.lastCheckedAt = new Date();
    account.lastError = "";
    await account.save();

    res.json({ success: true, connection: safeConnection(account) });
  } catch (error) {
    next(error);
  }
};

export const disconnectConnection = async (req, res, next) => {
  try {
    const provider = String(req.params.provider || "").trim();
    const key = workspaceKey(req.user);
    await ConnectionAccount.findOneAndUpdate(
      { workspaceKey: key, provider },
      {
        $set: {
          status: "disconnected",
          displayName: "",
          externalAccountId: "",
          accessTokenEncrypted: "",
          refreshTokenEncrypted: "",
          tokenExpiresAt: null,
          connectedAt: null,
          lastError: "",
          metadata: {},
        },
      }
    );

    if (provider === "instagram") {
      await SocialAccount.updateMany(
        { provider: "instagram", isArchived: false },
        {
          $set: {
            status: "disconnected",
            accessTokenEncrypted: "",
            tokenExpiresAt: null,
            connectionError: "",
          },
        }
      );
    }

    res.json({ success: true, message: "Disconnected." });
  } catch (error) {
    next(error);
  }
};
