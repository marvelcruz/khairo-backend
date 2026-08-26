import express from "express";
import { listPublicEvents, listAdminEvents, createEvent, registerForEvent, markAttended, markConverted } from "../controllers/trialController.js";
import { protect, authorize, requirePermission } from "../middleware/auth.js";
const router = express.Router();

router.get("/trials", listPublicEvents);
router.get("/trials/admin", protect, requirePermission("view_trials"), authorize("admin", "coach"), listAdminEvents);
router.post("/trials", protect, requirePermission("view_trials"), authorize("admin"), createEvent);
router.post("/trials/:eventId/register", registerForEvent);
router.post("/trials/:eventId/attend/:regId", protect, requirePermission("view_trials"), authorize("admin", "coach"), markAttended);
router.post("/trials/:eventId/convert/:regId", protect, requirePermission("view_trials"), authorize("admin", "coach"), markConverted);

export default router;
