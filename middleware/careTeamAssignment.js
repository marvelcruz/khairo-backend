import mongoose from "mongoose";
import Client from "../models/Client.js";
import User from "../models/User.js";
import { logAudit } from "../utils/auditLogger.js";

const ASSIGNMENT_FIELDS = new Set(["assignedCoach", "assignedDoctor"]);

function hasRole(user, role) {
  return Array.isArray(user?.roles) && user.roles.includes(role);
}

async function resolveAssignee(value, requiredRole, label) {
  if (value === undefined) return { provided: false };
  if (value === null || value === "") {
    return { provided: true, value: null, name: "Unassigned" };
  }

  if (!mongoose.Types.ObjectId.isValid(String(value))) {
    return { error: `Choose a valid ${label}.` };
  }

  const user = await User.findOne({
    _id: value,
    isActive: true,
    roles: requiredRole,
  }).select("_id name roles");

  if (!user) {
    return {
      error: `The selected ${label} is not an active ${requiredRole}.`,
    };
  }

  return {
    provided: true,
    value: user._id,
    name: user.name,
  };
}

// Intercepts care-team fields before the generic client update controller.
// Care-team assignment is a deliberate admin action and is always audited.
export const handleCareTeamAssignment = async (req, res, next) => {
  try {
    const body = req.body || {};
    const hasAssignment =
      Object.prototype.hasOwnProperty.call(body, "assignedCoach") ||
      Object.prototype.hasOwnProperty.call(body, "assignedDoctor");

    if (!hasAssignment) return next();

    if (!hasRole(req.user, "admin")) {
      return res.status(403).json({
        success: false,
        message: "Only an administrator can change a client's doctor or coach.",
      });
    }

    const unrelatedFields = Object.keys(body).filter(
      (key) => !ASSIGNMENT_FIELDS.has(key)
    );

    if (unrelatedFields.length) {
      return res.status(400).json({
        success: false,
        message:
          "Care-team reassignment must be submitted separately from other client changes.",
      });
    }

    const [coach, doctor] = await Promise.all([
      resolveAssignee(body.assignedCoach, "coach", "coach"),
      resolveAssignee(body.assignedDoctor, "doctor", "doctor"),
    ]);

    if (coach.error || doctor.error) {
      return res.status(400).json({
        success: false,
        message: coach.error || doctor.error,
      });
    }

    const client = await Client.findById(req.params.id)
      .populate("assignedCoach", "name roles")
      .populate("assignedDoctor", "name roles");

    if (!client) {
      return res.status(404).json({
        success: false,
        message: "Client not found.",
      });
    }

    const changes = [];

    if (coach.provided) {
      const beforeName = client.assignedCoach?.name || "Unassigned";
      const beforeId = client.assignedCoach?._id || client.assignedCoach || null;

      if (String(beforeId || "") !== String(coach.value || "")) {
        client.assignedCoach = coach.value;
        changes.push(`Coach: ${beforeName} → ${coach.name}`);
      }
    }

    if (doctor.provided) {
      const beforeName = client.assignedDoctor?.name || "Unassigned";
      const beforeId = client.assignedDoctor?._id || client.assignedDoctor || null;

      if (String(beforeId || "") !== String(doctor.value || "")) {
        client.assignedDoctor = doctor.value;
        changes.push(`Doctor: ${beforeName} → ${doctor.name}`);
      }
    }

    if (!changes.length) {
      return res.status(200).json({
        success: true,
        client,
        changed: false,
      });
    }

    await client.save();

    await logAudit(
      req,
      "Changed client care team",
      "Client",
      client._id,
      changes.join(" | ")
    );

    await client.populate("assignedCoach", "name roles");
    await client.populate("assignedDoctor", "name roles");

    return res.status(200).json({
      success: true,
      client,
      changed: true,
      changes,
    });
  } catch (error) {
    next(error);
  }
};
