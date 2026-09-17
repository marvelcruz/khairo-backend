import express from "express";
import {
  listPublicEvents,
  listAdminEvents,
  createEvent,
  registerForEvent,
  markAttended,
  markConverted,
} from "../controllers/trialController.js";
import { protect, authorize, requirePermission } from "../middleware/auth.js";

const router = express.Router();

router.get("/", listPublicEvents);
router.get(
  "/admin",
  protect,
  requirePermission("view_trials"),
  authorize("admin", "coach"),
  listAdminEvents
);
router.post(
  "/",
  protect,
  requirePermission("view_trials"),
  authorize("admin"),
  createEvent
);
router.post("/:eventId/register", registerForEvent);
router.post(
  "/:eventId/attend/:regId",
  protect,
  requirePermission("view_trials"),
  authorize("admin", "coach"),
  markAttended
);
router.post(
  "/:eventId/convert/:regId",
  protect,
  requirePermission("view_trials"),
  authorize("admin", "coach"),
  markConverted
);

export default router;
