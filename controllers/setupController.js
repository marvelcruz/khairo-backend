import BusinessWorkspace from "../models/BusinessWorkspace.js";
import ConnectionAccount from "../models/ConnectionAccount.js";

const SETUP_STEPS = [
  "business",
  "brand",
  "domain",
  "payments",
  "email",
  "social",
  "staff",
  "productsServices",
  "test",
];

function workspaceKey(user) {
  return String(user?.workspaceKey || "business").trim().toLowerCase() || "business";
}

async function ensureWorkspace(user) {
  const key = workspaceKey(user);
  let workspace = await BusinessWorkspace.findOne({ workspaceKey: key });
  if (workspace) return workspace;

  const isExistingKhairoDietClinicWorkspace = key === "business";
  const completeSteps = isExistingKhairoDietClinicWorkspace
    ? Object.fromEntries(SETUP_STEPS.map((step) => [step, true]))
    : {};

  workspace = await BusinessWorkspace.create({
    workspaceKey: key,
    profile: {
      displayName: isExistingKhairoDietClinicWorkspace ? "KhairoDietClinic" : "",
    },
    branding: {
      publicName: isExistingKhairoDietClinicWorkspace ? "KhairoDietClinic" : "",
      primaryColor: "#EC008C",
    },
    setup: {
      steps: completeSteps,
      completedAt: isExistingKhairoDietClinicWorkspace ? new Date() : null,
    },
    createdBy: user?._id || null,
    updatedBy: user?._id || null,
  });

  return workspace;
}

function publicWorkspace(workspace) {
  return {
    workspaceKey: workspace.workspaceKey,
    profile: workspace.profile,
    branding: workspace.branding,
    domain: workspace.domain,
    payments: workspace.payments,
    setup: workspace.setup,
  };
}

async function connectionSummary(key) {
  const accounts = await ConnectionAccount.find({ workspaceKey: key }).lean();
  const connected = new Set(
    accounts.filter((item) => item.status === "connected").map((item) => item.provider)
  );
  const socialProviders = ["instagram", "facebook", "whatsapp", "linkedin", "tiktok", "google_business"];
  return {
    emailConnected: connected.has("google_gmail"),
    socialConnected: socialProviders.some((provider) => connected.has(provider)),
  };
}

export const getSetupStatus = async (req, res, next) => {
  try {
    const workspace = await ensureWorkspace(req.user);
    const connections = await connectionSummary(workspace.workspaceKey);
    const steps = {
      ...workspace.setup?.steps?.toObject?.(),
      ...(workspace.setup?.steps || {}),
    };
    if (connections.emailConnected) steps.email = true;
    if (connections.socialConnected) steps.social = true;

    const completed = SETUP_STEPS.every((step) => Boolean(steps[step]));
    res.json({
      success: true,
      setupRequired: !completed,
      steps,
      order: SETUP_STEPS,
      connections,
      workspace: publicWorkspace(workspace),
    });
  } catch (error) {
    next(error);
  }
};

export const updateSetupSection = async (req, res, next) => {
  try {
    const section = String(req.params.section || "").trim();
    if (!SETUP_STEPS.includes(section)) {
      return res.status(404).json({ success: false, message: "That setup step does not exist." });
    }

    const workspace = await ensureWorkspace(req.user);
    const body = req.body || {};

    if (section === "business") {
      workspace.profile.displayName = String(body.displayName || "").trim().slice(0, 120);
      workspace.profile.email = String(body.email || "").trim().toLowerCase().slice(0, 180);
      workspace.profile.phone = String(body.phone || "").trim().slice(0, 80);
      workspace.profile.website = String(body.website || "").trim().slice(0, 300);
      if (!workspace.profile.displayName) {
        return res.status(400).json({ success: false, message: "Enter your business name." });
      }
    }

    if (section === "brand") {
      workspace.branding.publicName = String(body.publicName || workspace.profile.displayName || "").trim().slice(0, 120);
      const color = String(body.primaryColor || "#EC008C").trim();
      if (!/^#[0-9A-Fa-f]{6}$/.test(color)) {
        return res.status(400).json({ success: false, message: "Choose a valid brand colour." });
      }
      workspace.branding.primaryColor = color;
      workspace.branding.logoUrl = String(body.logoUrl || "").trim().slice(0, 1000);
    }

    if (section === "domain") {
      const mode = body.mode === "custom" ? "custom" : "platform";
      workspace.domain.mode = mode;
      workspace.domain.hostname = mode === "custom" ? String(body.hostname || "").trim().toLowerCase().slice(0, 255) : "";
      workspace.domain.verified = mode === "platform";
      if (mode === "custom" && !workspace.domain.hostname) {
        return res.status(400).json({ success: false, message: "Enter the domain you want to use." });
      }
    }

    if (section === "payments") {
      workspace.payments.provider = "paystack";
      workspace.payments.enabled = Boolean(body.enabled);
    }

    if (["email", "social"].includes(section)) {
      const summary = await connectionSummary(workspace.workspaceKey);
      const connected = section === "email" ? summary.emailConnected : summary.socialConnected;
      if (!connected) {
        return res.status(409).json({
          success: false,
          message: section === "email" ? "Connect Gmail before continuing." : "Connect at least one marketing account before continuing.",
        });
      }
    }

    workspace.setup.steps[section] = true;
    workspace.setup.completedAt = null;
    workspace.updatedBy = req.user._id;
    await workspace.save();

    res.json({ success: true, workspace: publicWorkspace(workspace) });
  } catch (error) {
    next(error);
  }
};

export const completeSetup = async (req, res, next) => {
  try {
    const workspace = await ensureWorkspace(req.user);
    const connections = await connectionSummary(workspace.workspaceKey);
    if (connections.emailConnected) workspace.setup.steps.email = true;
    if (connections.socialConnected) workspace.setup.steps.social = true;

    const missing = SETUP_STEPS.filter((step) => !workspace.setup.steps?.[step]);
    if (missing.length) {
      return res.status(409).json({
        success: false,
        message: "Finish the remaining setup steps before going live.",
        missing,
      });
    }

    workspace.setup.completedAt = new Date();
    workspace.updatedBy = req.user._id;
    await workspace.save();

    res.json({ success: true, setupRequired: false, workspace: publicWorkspace(workspace) });
  } catch (error) {
    next(error);
  }
};
