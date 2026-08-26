import mongoose from "mongoose";
import Client from "../models/Client.js";
import DailyLog from "../models/DailyLog.js";
import ClientExperience from "../models/ClientExperience.js";
import ClientMessage from "../models/ClientMessage.js";
import ClientSupplement from "../models/ClientSupplement.js";
import Session from "../models/Session.js";

const BUCKET = "clientProgressPhotos";

function photoBucket() {
  if (!mongoose.connection.db) throw new Error("Database is not ready.");
  return new mongoose.mongo.GridFSBucket(mongoose.connection.db, { bucketName: BUCKET });
}

const dateKey = (date) => new Date(date).toISOString().slice(0, 10);

function periodKeys(days) {
  const keys = [];
  const now = new Date();
  now.setUTCHours(12, 0, 0, 0);
  for (let i = days - 1; i >= 0; i -= 1) {
    const d = new Date(now);
    d.setUTCDate(d.getUTCDate() - i);
    keys.push(dateKey(d));
  }
  return keys;
}

function consistency(logs, days) {
  const allowed = new Set(periodKeys(days));
  const logged = new Set(
    logs.map((log) => String(log.logDate || "").slice(0, 10)).filter((key) => allowed.has(key))
  );
  return {
    days,
    trackedDays: logged.size,
    percentage: Math.round((logged.size / days) * 100),
  };
}

export const getCareTeamSnapshot = async (req, res, next) => {
  try {
    const clientId = req.params.clientId;
    const client = await Client.findById(clientId)
      .populate("assignedCoach", "name email")
      .populate("assignedDoctor", "name email");

    if (!client) {
      return res.status(404).json({ success: false, message: "Client not found." });
    }

    const since = new Date();
    since.setUTCDate(since.getUTCDate() - 90);
    const sinceKey = dateKey(since);

    const [logs, experience, messages, supplements, sessions, photoFiles] = await Promise.all([
      DailyLog.find({ client: clientId, logDate: { $gte: sinceKey } }).sort({ logDate: 1 }).lean(),
      ClientExperience.findOne({ client: clientId }).lean(),
      ClientMessage.find({ client: clientId }).sort({ createdAt: -1 }).limit(50).lean(),
      ClientSupplement.find({ client: clientId })
        .populate("supplement", "name description unit")
        .sort({ createdAt: -1 })
        .lean(),
      Session.find({ client: clientId, archived: { $ne: true } })
        .populate("staff", "name")
        .sort({ startsAt: -1 })
        .limit(30)
        .lean(),
      photoBucket()
        .find({ "metadata.clientId": String(clientId) })
        .sort({ uploadDate: -1 })
        .limit(30)
        .toArray(),
    ]);

    const dailyWeights = logs.filter((log) => typeof log.weightKg === "number");
    const latestDailyWeight = dailyWeights.length ? dailyWeights[dailyWeights.length - 1].weightKg : null;

    res.status(200).json({
      success: true,
      client: {
        _id: client._id,
        fullName: client.fullName,
        program: client.program,
        status: client.status,
        accountStage: client.accountStage,
        startDate: client.startDate,
        cycleWeeks: client.cycleWeeks,
        currentWeightKg: client.currentWeightKg,
        startingWeightKg: client.startingWeightKg,
        goalWeightKg: client.goalWeightKg,
        assignedCoach: client.assignedCoach || null,
        assignedDoctor: client.assignedDoctor || null,
      },
      summary: {
        currentCheckInWeightKg: client.currentWeightKg ?? null,
        latestDailyWeightKg: latestDailyWeight,
        tracking7: consistency(logs, 7),
        tracking30: consistency(logs, 30),
      },
      measurements: experience?.measurements || [],
      sharedItems: experience?.sharedItems || [],
      messages,
      supplements,
      sessions,
      progressPhotos: photoFiles.map((file) => ({
        _id: String(file._id),
        uploadedAt: file.uploadDate,
        contentType: file.contentType || "image/jpeg",
        size: file.length,
        angle: file.metadata?.angle || "front",
        note: file.metadata?.note || "",
      })),
    });
  } catch (error) {
    next(error);
  }
};

export const getCareTeamProgressPhoto = async (req, res, next) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.photoId)) {
      return res.status(404).json({ success: false, message: "Photo not found." });
    }

    const storage = photoBucket();
    const file = await storage.find({
      _id: new mongoose.Types.ObjectId(req.params.photoId),
      "metadata.clientId": String(req.params.clientId),
    }).next();

    if (!file) {
      return res.status(404).json({ success: false, message: "Photo not found." });
    }

    res.setHeader("Content-Type", file.contentType || "image/jpeg");
    res.setHeader("Cache-Control", "private, max-age=300");
    storage.openDownloadStream(file._id).pipe(res);
  } catch (error) {
    next(error);
  }
};
