import mongoose from "mongoose";
import Client from "../models/Client.js";
import { canAccessClient } from "../utils/careTeamAccess.js";

const resolveId = (req) =>
  req.params.clientId || req.params.id || req.body?.clientId;

async function loadClient(req) {
  const id = resolveId(req);
  if (!id || !mongoose.Types.ObjectId.isValid(String(id))) return null;
  return Client.findById(id).select("assignedCoach assignedDoctor isArchived fullName");
}

export const requireClientRecordAccess = async (req, res, next) => {
  try {
    const client = await loadClient(req);
    if (!client) {
      return res.status(404).json({ success: false, message: "Client not found." });
    }

    if (!canAccessClient(req.user, client, { allowStaff: true, allowSales: true })) {
      return res.status(403).json({ success: false, message: "You do not have access to this client." });
    }

    req.accessClient = client;
    next();
  } catch (error) {
    next(error);
  }
};

export const requireCareTeamClientAccess = async (req, res, next) => {
  try {
    const client = await loadClient(req);
    if (!client) {
      return res.status(404).json({ success: false, message: "Client not found." });
    }

    if (!canAccessClient(req.user, client, { allowStaff: false, allowSales: false })) {
      return res.status(403).json({ success: false, message: "You are not assigned to this client." });
    }

    req.accessClient = client;
    next();
  } catch (error) {
    next(error);
  }
};
