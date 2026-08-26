import mongoose from "mongoose";
import ActionAlert from "../models/ActionAlert.js";
import AuditLog from "../models/AuditLog.js";
import { scanApplicationAlerts } from "../services/actionCentreService.js";
import { scanOperationalAlerts } from "../services/actionCentreOperationalService.js";

function rolesForUser(user) {
  if (
    Array.isArray(user?.roles) &&
    user.roles.length
  ) {
    return user.roles;
  }

  return user?.role
    ? [user.role]
    : [];
}

function visibleQuery(user) {
  const roles = rolesForUser(user);

  if (roles.includes("admin")) {
    return {};
  }

  return {
    audienceRoles: {
      $in: roles,
    },
  };
}

async function scanAll({ sendNotifications = false } = {}) {
  const [applications, operational] = await Promise.all([
    scanApplicationAlerts({ sendNotifications }),
    scanOperationalAlerts(),
  ]);

  return { applications, operational };
}

export const getActionCentre = async (
  req,
  res,
  next
) => {
  try {
    await scanAll({
      sendNotifications: false,
    });

    const base =
      visibleQuery(req.user);

    const [
      alerts,
      open,
      urgent,
      warning,
      resolved,
    ] = await Promise.all([
      ActionAlert.find(base)
        .sort({
          status: 1,
          lastDetectedAt: -1,
        })
        .limit(250)
        .lean(),

      ActionAlert.countDocuments({
        ...base,
        status: "open",
      }),

      ActionAlert.countDocuments({
        ...base,
        status: "open",
        severity: "urgent",
      }),

      ActionAlert.countDocuments({
        ...base,
        status: "open",
        severity: "warning",
      }),

      ActionAlert.countDocuments({
        ...base,
        status: "resolved",
      }),
    ]);

    res.json({
      success: true,
      alerts,
      stats: {
        open,
        urgent,
        warning,
        resolved,
      },
    });
  } catch (error) {
    next(error);
  }
};

export const runActionCentreScan = async (
  req,
  res,
  next
) => {
  try {
    const result =
      await scanAll({
        sendNotifications: true,
      });

    await AuditLog.create({
      user:
        req.user?._id || null,
      userName:
        req.user?.name ||
        "Admin",
      action:
        "Ran Action Centre scan",
      entityType:
        "ActionCentre",
      entityId:
        "all-alerts",
      details:
        JSON.stringify(result),
    });

    res.json({
      success: true,
      result,
    });
  } catch (error) {
    next(error);
  }
};

export const resolveActionAlert = async (
  req,
  res,
  next
) => {
  try {
    if (
      !mongoose.isValidObjectId(
        req.params.id
      )
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Invalid alert id.",
      });
    }

    const alert =
      await ActionAlert.findById(
        req.params.id
      );

    if (!alert) {
      return res.status(404).json({
        success: false,
        message:
          "Alert not found.",
      });
    }

    const roles = rolesForUser(req.user);
    if (
      !roles.includes("admin") &&
      !alert.audienceRoles.some((role) => roles.includes(role))
    ) {
      return res.status(403).json({
        success: false,
        message: "You do not have access to this alert.",
      });
    }

    alert.status = "resolved";
    alert.resolvedAt =
      new Date();

    alert.resolvedBy =
      req.user?._id || null;

    alert.resolutionNote =
      String(
        req.body.note ||
          "Marked resolved by staff."
      ).slice(0, 500);

    await alert.save();

    await AuditLog.create({
      user:
        req.user?._id || null,
      userName:
        req.user?.name ||
        "Staff",
      action:
        "Resolved Action Centre alert",
      entityType:
        alert.entityType,
      entityId:
        alert.entityId,
      details:
        alert.title,
    });

    res.json({
      success: true,
      alert,
    });
  } catch (error) {
    next(error);
  }
};
