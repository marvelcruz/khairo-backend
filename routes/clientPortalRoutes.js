import express from "express";
import { protectClient } from "../middleware/clientAuth.js";
import { requireActiveProgram } from "../middleware/clientProgramAccess.js";
import {
  getMyProgress,
  addMyCheckIn,
} from "../controllers/clientPortalController.js";
import {
  upsertDailyLog,
  getMyDailyLogs,
  getMyStreak,
} from "../controllers/dailyLogController.js";
import {
  requestSession,
  getMySessions,
} from "../controllers/sessionController.js";

const router = express.Router();

router.use(protectClient);

router.get(
  "/me",
  getMyProgress
);

router.get(
  "/daily-logs",
  getMyDailyLogs
);

router.get(
  "/streak",
  getMyStreak
);

router.get(
  "/sessions",
  getMySessions
);

router.post(
  "/checkins",
  requireActiveProgram,
  addMyCheckIn
);

router.post(
  "/daily-logs",
  requireActiveProgram,
  upsertDailyLog
);

router.post(
  "/sessions",
  requireActiveProgram,
  requestSession
);

export default router;
