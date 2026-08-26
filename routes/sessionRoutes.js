import express from "express";
import { filterByPermissions } from "../controllers/clientController.js";
import { protect, authorize, requirePermission } from "../middleware/auth.js";
import { listSessions, createSession, setSessionStatus, assignStaff, archiveSession } from "../controllers/sessionController.js";
import { requireRequestedClientAccess, requireSessionCareAccess } from "../middleware/sessionAccess.js";

const router = express.Router();

router.use(protect);
router.use(filterByPermissions);
router.use(requirePermission("view_appointments"));

router.get("/", authorize("admin", "coach", "doctor", "staff"), listSessions);
router.post(
  "/",
  authorize("admin", "coach", "staff"),
  requireRequestedClientAccess,
  createSession
);
router.patch(
  "/:id/status",
  authorize("admin", "coach", "doctor"),
  requireSessionCareAccess,
  setSessionStatus
);
router.patch("/:id/assign", authorize("admin", "staff"), assignStaff);
router.patch("/:id/archive", authorize("admin", "staff"), archiveSession);

export default router;
