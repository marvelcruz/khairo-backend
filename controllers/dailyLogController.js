import DailyLog from "../models/DailyLog.js";
import {
  dateKeyInTimezone,
  getClientTrackingSnapshot,
  syncClientEngagementTags,
} from "../services/clientEngagementService.js";

// @route POST /api/client-portal/daily-logs
export const upsertDailyLog = async (req, res, next) => {
  try {
    const client = req.client;
    const {
      weightKg,
      calories,
      waterMl,
      steps,
      workoutDone,
      notes,
      logDate,
      completedMealItemIds,
      completedExerciseIds,
    } = req.body;

    const key = logDate || dateKeyInTimezone();

    const log = await DailyLog.findOneAndUpdate(
      { client: client._id, logDate: key },
      {
        $set: {
          ...(weightKg !== undefined && { weightKg }),
          ...(calories !== undefined && { calories }),
          ...(waterMl !== undefined && { waterMl }),
          ...(steps !== undefined && { steps }),
          ...(workoutDone !== undefined && { workoutDone }),
          ...(notes !== undefined && { notes }),
          ...(completedMealItemIds !== undefined && { completedMealItemIds }),
          ...(completedExerciseIds !== undefined && { completedExerciseIds }),
        },
      },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );

    // Keep CRM engagement tags current whenever the client records activity.
    // This deliberately evaluates against the actual current day, even if a
    // historical logDate was supplied.
    await syncClientEngagementTags(client);

    res.status(200).json({ success: true, log });
  } catch (err) {
    next(err);
  }
};

// @route GET /api/client-portal/daily-logs?days=90
export const getMyDailyLogs = async (req, res, next) => {
  try {
    const client = req.client;
    const days = Math.min(Number(req.query.days) || 90, 365);

    const since = new Date();
    since.setDate(since.getDate() - days);
    const sinceKey = dateKeyInTimezone(since);

    const logs = await DailyLog.find({
      client: client._id,
      logDate: { $gte: sinceKey },
    }).sort({ logDate: 1 });

    res.status(200).json({ success: true, logs });
  } catch (err) {
    next(err);
  }
};

// @route GET /api/client-portal/streak
export const getMyStreak = async (req, res, next) => {
  try {
    const snapshot = await getClientTrackingSnapshot(req.client._id);
    res.status(200).json({ success: true, streak: snapshot.streak });
  } catch (err) {
    next(err);
  }
};

// @route GET /api/clients/:id/daily-logs?days=90 (staff only)
export const getClientDailyLogs = async (req, res, next) => {
  try {
    const days = Math.min(Number(req.query.days) || 90, 365);
    const since = new Date();
    since.setDate(since.getDate() - days);
    const sinceKey = dateKeyInTimezone(since);

    const logs = await DailyLog.find({
      client: req.params.id,
      logDate: { $gte: sinceKey },
    }).sort({ logDate: 1 });

    res.status(200).json({ success: true, logs });
  } catch (err) {
    next(err);
  }
};

// @route GET /api/clients/:id/streak (staff only)
export const getClientStreak = async (req, res, next) => {
  try {
    const snapshot = await getClientTrackingSnapshot(req.params.id);
    res.status(200).json({ success: true, streak: snapshot.streak });
  } catch (err) {
    next(err);
  }
};
