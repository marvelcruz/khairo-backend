import AuditLog from "../models/AuditLog.js";

export const logAudit = async (req, action, entityType = "", entityId = "", details = "") => {
  try {
    await AuditLog.create({
      user: req.user?._id,
      userName: req.user?.name || "System",
      action,
      entityType,
      entityId,
      details,
    });
  } catch (err) {
    console.error("Failed to write audit log:", err.message);
  }
};
