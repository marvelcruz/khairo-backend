import mongoose from "mongoose";
import Client from "../models/Client.js";
import Session from "../models/Session.js";
import { canAccessClient, rolesFor } from "../utils/careTeamAccess.js";

const same = (a, b) => String(a?._id || a || "") === String(b?._id || b || "");

export const requireRequestedClientAccess = async (req, res, next) => {
  try {
    const roles = rolesFor(req.user);
    if (roles.includes("admin") || roles.includes("staff") || req.body?.isTeam) return next();

    const clientId = req.body?.clientId;
    if (!clientId || !mongoose.Types.ObjectId.isValid(String(clientId))) {
      return res.status(400).json({ success: false, message: "Client is required." });
    }

    const client = await Client.findById(clientId).select("assignedCoach assignedDoctor");
    if (!client) return res.status(404).json({ success: false, message: "Client not found." });

    if (!canAccessClient(req.user, client, { allowStaff: false, allowSales: false })) {
      return res.status(403).json({ success: false, message: "You are not assigned to this client." });
    }

    next();
  } catch (error) {
    next(error);
  }
};

export const requireSessionCareAccess = async (req, res, next) => {
  try {
    const roles = rolesFor(req.user);
    if (roles.includes("admin")) return next();

    const session = await Session.findById(req.params.id);
    if (!session) return res.status(404).json({ success: false, message: "Session not found." });

    if (
      same(session.staff, req.user._id) ||
      same(session.decidedBy, req.user._id) ||
      same(session.confirmedBy, req.user._id)
    ) return next();

    if (session.client) {
      const client = await Client.findById(session.client).select("assignedCoach assignedDoctor");
      if (client && canAccessClient(req.user, client, { allowStaff: false, allowSales: false })) return next();
    }

    return res.status(403).json({ success: false, message: "You do not have access to this session." });
  } catch (error) {
    next(error);
  }
};
