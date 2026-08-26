import Transcript from "../models/Transcript.js";
import Session from "../models/Session.js";
import AuditLog from "../models/AuditLog.js";
import Client from "../models/Client.js";
import { canAccessClient } from "../utils/careTeamAccess.js";

const canAccess = async (user, session) => {
  if (!user || !session) return false;
  if (user.roles && user.roles.includes("admin")) return true;
  if (session.staff && String(session.staff._id || session.staff) === String(user._id)) return true;
  if (session.decidedBy && String(session.decidedBy._id || session.decidedBy) === String(user._id)) return true;
  if (session.confirmedBy && String(session.confirmedBy._id || session.confirmedBy) === String(user._id)) return true;

  const clientId = session.client?._id || session.client;
  if (!clientId) return false;
  const client = await Client.findById(clientId).select("assignedCoach assignedDoctor");
  return client ? canAccessClient(user, client, { allowStaff: false, allowSales: false }) : false;
};

const populateChain = (q) =>
  q.populate({ path: "session", populate: [{ path: "client", select: "fullName" }, { path: "staff", select: "name" }, { path: "decidedBy", select: "name" }, { path: "confirmedBy", select: "name" }] })
   .populate("createdBy", "name");

export const listClientTranscripts = async (req, res, next) => {
  try {
    const transcripts = await populateChain(Transcript.find({ client: req.params.clientId })).sort({ createdAt: -1 });
    const user = req.user;
    const filtered = [];
    for (const t of transcripts) {
      if (await canAccess(user, t.session)) filtered.push(t);
    }
    res.status(200).json({ success: true, transcripts: filtered });
  } catch (err) {
    next(err);
  }
};

export const createTranscript = async (req, res, next) => {
  try {
    const { sessionId, text, source } = req.body;
    if (!sessionId || !text) return res.status(400).json({ success: false, message: "Session and text required." });
    const session = await Session.findById(sessionId).populate("staff decidedBy confirmedBy");
    if (!session) return res.status(404).json({ success: false, message: "Session not found." });
    if (!session.isTeam && !(await canAccess(req.user, session))) return res.status(403).json({ success: false, message: "Not authorized." });
    const transcript = await Transcript.create({
      session: sessionId,
      client: session.client,
      text,
      source: source || "pasted",
      createdBy: req.user._id,
    });
    if ((source || "pasted") !== "webhook") {
      await AuditLog.create({
        user: req.user._id,
        userName: req.user.name,
        action: "Added transcript manually",
        entityType: "Session",
        entityId: sessionId,
        details: `${session.sessionType} session with ${session.staff?.name || "staff"}`,
      });
    }
    res.status(201).json({ success: true, transcript: await populateChain(Transcript.findById(transcript._id)) });
  } catch (err) {
    next(err);
  }
};

// Webhook endpoint for automated capture (tl;dv, Fireflies, etc.)
export const getSessionTranscripts = async (req, res, next) => {
  try {
    const session = await Session.findById(req.params.sessionId).populate("staff decidedBy confirmedBy");
    if (!session) return res.status(404).json({ success: false, message: "Session not found." });
    if (!session.isTeam && !(await canAccess(req.user, session))) return res.status(403).json({ success: false, message: "Not authorized." });
    const transcripts = await Transcript.find({ session: session._id }).sort({ createdAt: -1 });
    res.status(200).json({ success: true, transcripts });
  } catch (err) {
    next(err);
  }
};

export const webhookIngest = async (req, res, next) => {
  try {
    const { sessionId, text, source } = req.body;
    if (!sessionId || !text) return res.status(400).json({ success: false });
    const session = await Session.findById(sessionId);
    if (!session) return res.status(404).json({ success: false });
    await Transcript.create({ session: sessionId, client: session.client, text, source: source || "webhook" });
    res.status(201).json({ success: true });
  } catch (err) {
    next(err);
  }
};
