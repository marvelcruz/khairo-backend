import jwt from "jsonwebtoken";
import User from "../models/User.js";
import {
  allowedProfilesFromRouteRoles,
  hasStaffAccess,
  normalizedProfile,
} from "../utils/roleProfiles.js";

export const protect = async (req, res, next) => {
  try {
    let token;

    if (req.cookies?.token) {
      token = req.cookies.token;
    } else if (req.headers.authorization?.startsWith("Bearer ")) {
      token = req.headers.authorization.split(" ")[1];
    }

    if (!token) {
      return res.status(401).json({ success: false, message: "Not authenticated. Please log in." });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const user = await User.findById(decoded.id);
    if (!user) {
      return res.status(401).json({ success: false, message: "User no longer exists." });
    }
    if (!user.isActive) {
      return res.status(403).json({ success: false, message: "This account has been deactivated." });
    }

    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({ success: false, message: "Invalid or expired session. Please log in again." });
  }
};

export const authorize = (...allowedRoles) => {
  return (req, res, next) => {
    const userRoles = Array.isArray(req.user?.roles)
      ? req.user.roles
      : req.user?.role
        ? [req.user.role]
        : [];

    const allowed = allowedRoles.some((role) => userRoles.includes(role));

    if (!req.user || !allowed) {
      return res.status(403).json({
        success: false,
        message: "You do not have permission to perform this action.",
      });
    }

    next();
  };
};

export const requireAnyPermission = (...allowedPermissions) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: "Not authenticated. Please log in.",
      });
    }

    const roles = Array.isArray(req.user.roles)
      ? req.user.roles
      : req.user.role
        ? [req.user.role]
        : [];

    // Admin always has full access.
    if (roles.includes("admin")) {
      return next();
    }

    const permissions = Array.isArray(req.user.permissions)
      ? req.user.permissions
      : [];

    if (
      !allowedPermissions.some((permission) =>
        permissions.includes(permission)
      )
    ) {
      return res.status(403).json({
        success: false,
        message: "Your account does not have access to this section.",
      });
    }

    next();
  };
};

export const requirePermission = (permission) =>
  requireAnyPermission(permission);
