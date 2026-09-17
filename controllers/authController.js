import { logAudit } from "../utils/auditLogger.js";
import User from "../models/User.js";
import { generateToken, sendTokenCookie } from "../utils/generateToken.js";
import {
  getVapidPublicKey,
  savePushSubscription,
  removePushSubscription,
} from "../services/pushService.js";
import {
  normalizedProfile,
  VISIBLE_ROLE_PROFILES,
} from "../utils/roleProfiles.js";

export const login = async (req, res, next) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ success: false, message: "Email and password are required." });
    }

    const user = await User.findOne({ email: email.toLowerCase().trim() }).select("+password");

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "No staff account found with that email.",
        code: "NO_ACCOUNT",
      });
    }

    if (!user.isActive) {
      return res.status(403).json({
        success: false,
        message: "This account has been deactivated. Contact the owner.",
        code: "DEACTIVATED",
      });
    }

    const passwordValid = user.comparePassword ? await user.comparePassword(password) : false;
    if (!passwordValid) {
      return res.status(401).json({
        success: false,
        message: "Incorrect password.",
        code: "WRONG_PASSWORD",
      });
    }

    user.lastLogin = new Date();
    await user.save({ validateBeforeSave: false });

    const token = generateToken(user._id);
    sendTokenCookie(res, token);

    if (user) await logAudit({ user }, "Logged into dashboard", "Auth", "", "");
    res.status(200).json({ success: true, user: user.toSafeObject() });
  } catch (err) {
    next(err);
  }
};

export const logout = (req, res) => {
  res.clearCookie("token");
  res.status(200).json({ success: true, message: "Logged out." });
};

export const getMe = (req, res) => {
  res.status(200).json({ success: true, user: req.user.toSafeObject() });
};

// Legacy direct reset is intentionally disabled. Secure recovery is handled by
// the one-time-link recovery controller/routes.
export const staffForgotPassword = async (req, res) => {
  res.status(410).json({
    success: false,
    message: "Use the secure password recovery link instead.",
  });
};

const ACCESS_VALID_ROLES = [...VISIBLE_ROLE_PROFILES];

const ACCESS_PERMISSION_KEYS = [
  "view_dashboard",
  "view_requests",
  "view_crm",
  "view_action_centre",
  "view_clients",
  "view_medical_review",
  "view_orders",
  "view_coaching",
  "view_appointments",
  "view_messages",
  "view_trials",
  "view_buddies",
  "view_broadcast",
  "view_social_media",
  "view_billing",
  "view_pricing",
  "view_supplements",
  "view_reports",
  "view_contact_info",
  "view_financials",
];

const ACCESS_ROLE_DEFAULTS = {
  staff: ACCESS_PERMISSION_KEYS,
  doctor: [
    "view_dashboard",
    "view_clients",
    "view_medical_review",
    "view_appointments",
    "view_messages",
  ],
};

const defaultPermissionsForRoles = (roles = []) => {
  const profile = normalizedProfile(roles);
  return [...(ACCESS_ROLE_DEFAULTS[profile] || [])];
};

function requestedProfile(role, roles) {
  const values = Array.isArray(roles) && roles.length
    ? [...new Set(roles)]
    : role
      ? [role]
      : ["staff"];

  if (
    values.length !== 1 ||
    !ACCESS_VALID_ROLES.includes(values[0])
  ) {
    return null;
  }

  return values[0];
}

export const createStaffAccount = async (req, res, next) => {
  try {
    const { name, email, password, role, roles, phone } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ success: false, message: "Name, email, and password are required." });
    }

    const profile = requestedProfile(role, roles);
    if (!profile) {
      return res.status(400).json({
        success: false,
        message: "Choose either Staff or Doctor.",
      });
    }

    const existing = await User.findOne({ email: email.toLowerCase() });
    if (existing) {
      return res.status(409).json({ success: false, message: "An account with this email already exists." });
    }

    const userRoles = [profile];
    const user = await User.create({
      workspaceKey: req.user?.workspaceKey || "business",
      name,
      email: email.toLowerCase(),
      password,
      roles: userRoles,
      permissions: defaultPermissionsForRoles(userRoles),
      phone: phone || "",
    });

    res.status(201).json({ success: true, user: user.toSafeObject() });
  } catch (err) {
    next(err);
  }
};

export const listStaffAccounts = async (req, res, next) => {
  try {
    const users = await User.find({
      workspaceKey: req.user?.workspaceKey || "business",
    }).sort({ createdAt: -1 });

    const safeUsers = users.map((user) => user.toSafeObject());
    res.status(200).json({ success: true, count: safeUsers.length, users: safeUsers });
  } catch (err) {
    next(err);
  }
};

export const updateStaffAccount = async (req, res, next) => {
  try {
    const { name, email, role, roles, isActive, phone, permissions } = req.body;
    const updates = {};
    const changes = [];

    if (name !== undefined) {
      updates.name = name;
      changes.push("name");
    }
    if (email !== undefined) {
      updates.email = email.toLowerCase();
      changes.push("email");
    }

    if (role !== undefined || roles !== undefined) {
      const profile = requestedProfile(role, roles);
      if (!profile) {
        return res.status(400).json({
          success: false,
          message: "Choose either Staff or Doctor.",
        });
      }

      updates.roles = [profile];
      if (permissions === undefined) {
        updates.permissions = defaultPermissionsForRoles([profile]);
      }
      changes.push("access → " + profile);
    }

    if (isActive !== undefined) {
      updates.isActive = isActive;
      changes.push(isActive ? "activated" : "deactivated");
    }
    if (phone !== undefined) {
      updates.phone = phone;
      changes.push("phone");
    }

    // Kept for future expansion. The current customer-facing UI exposes only
    // Staff and Doctor and does not expose individual permission editing.
    if (permissions !== undefined) {
      if (
        !Array.isArray(permissions) ||
        permissions.some((permission) =>
          !ACCESS_PERMISSION_KEYS.includes(permission)
        )
      ) {
        return res.status(400).json({
          success: false,
          message: "Invalid access setting.",
        });
      }

      updates.permissions = [...new Set(permissions)];
      changes.push("access settings");
    }

    if (changes.length === 0) {
      return res.status(400).json({ success: false, message: "No fields to update." });
    }

    const user = await User.findOneAndUpdate(
      {
        _id: req.params.id,
        workspaceKey: req.user?.workspaceKey || "business",
      },
      updates,
      { new: true, runValidators: true }
    );

    if (!user) {
      return res.status(404).json({ success: false, message: "Staff account not found." });
    }

    await logAudit(req, "Updated staff member", "User", user._id, changes.join(", "));
    res.status(200).json({ success: true, user: user.toSafeObject() });
  } catch (err) {
    next(err);
  }
};

export const changePassword = async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ success: false, message: "Current and new password are required." });
    }
    if (newPassword.length < 8) {
      return res.status(400).json({ success: false, message: "New password must be at least 8 characters." });
    }

    const user = await User.findById(req.user._id).select("+password");
    const isMatch = await user.comparePassword(currentPassword);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: "Current password is incorrect." });
    }

    user.password = newPassword;
    await user.save();

    res.status(200).json({ success: true, message: "Password updated successfully." });
  } catch (err) {
    next(err);
  }
};

export const getStaffDirectory = async (req, res, next) => {
  try {
    const users = await User.find({
      workspaceKey: req.user?.workspaceKey || "business",
      isActive: true,
      roles: {
        $in: ["admin", "staff", "coach", "doctor", "sales"],
      },
    })
      .select("_id name roles isActive")
      .sort({ name: 1 });

    res.status(200).json({
      success: true,
      users: users.map((user) => ({
        ...user.toObject(),
        accessProfile: normalizedProfile(user.roles || []),
      })),
    });
  } catch (err) {
    next(err);
  }
};

export const getDoctors = async (req, res, next) => {
  try {
    const doctors = await User.find({
      workspaceKey: req.user?.workspaceKey || "business",
      roles: "doctor",
      isActive: true,
    }).select("name email roles");

    res.status(200).json({ success: true, doctors });
  } catch (err) {
    next(err);
  }
};

export const getPushPublicKey = async (req, res, next) => {
  try {
    const publicKey = getVapidPublicKey();

    if (!publicKey) {
      return res.status(503).json({
        success: false,
        message: "Push notifications are not configured.",
      });
    }

    res.status(200).json({
      success: true,
      publicKey,
    });
  } catch (err) {
    next(err);
  }
};

export const subscribeToPush = async (req, res, next) => {
  try {
    await savePushSubscription({
      userId: req.user._id,
      subscription: req.body?.subscription,
      userAgent: req.get("user-agent") || "",
    });

    res.status(200).json({
      success: true,
      message: "Push notifications enabled.",
    });
  } catch (err) {
    next(err);
  }
};

export const unsubscribeFromPush = async (req, res, next) => {
  try {
    const endpoint = String(req.body?.endpoint || "").trim();

    if (!endpoint) {
      return res.status(400).json({
        success: false,
        message: "Push subscription endpoint is required.",
      });
    }

    await removePushSubscription({
      userId: req.user._id,
      endpoint,
    });

    res.status(200).json({
      success: true,
      message: "Push notifications disabled.",
    });
  } catch (err) {
    next(err);
  }
};
