import express from "express";
import {
  createClient,
  getClients,
  getClientById,
  updateClient,
  addCheckIn,
  addChecklistItem,
  removeChecklistItem,
  markReviewed,
  getReviewQueue,
  getNeedsAttention,
  setTimetableMode,
  addTimetableItem,
  removeTimetableItem,
  addExercise,
  removeExercise,
  archiveClient,
  restoreClient,
  dismissFlag,
  filterByPermissions,
} from "../controllers/clientController.js";
import {
  generateStaffPaymentLink,
  emailPaymentLink,
  reconcilePayment,
  reviewPaymentMismatch,
  finalReconcilePayment,
} from "../controllers/paymentController.js";
import { manualActivateClient } from "../controllers/paymentActivationController.js";
import { updateClientLifecycle } from "../controllers/clientLifecycleController.js";
import { getStaffClientOnboardingChecklist } from "../controllers/clientOnboardingChecklistController.js";
import {
  getClientDailyLogs,
  getClientStreak,
} from "../controllers/dailyLogController.js";
import {
  getWeek3ReviewQueue,
  completeWeek3Review,
} from "../controllers/week3ReviewController.js";
import { protect, authorize, requirePermission } from "../middleware/auth.js";
import { requireClientRecordAccess } from "../middleware/clientRecordAccess.js";
import { handleCareTeamAssignment } from "../middleware/careTeamAssignment.js";

const router = express.Router();

router.use(protect);
router.use(filterByPermissions);

router.get(
  "/queue/review",
  authorize("admin", "coach", "doctor", "staff"),
  requirePermission("view_coaching"),
  getReviewQueue
);

router.get(
  "/queue/week3-review",
  authorize("admin", "coach", "staff"),
  requirePermission("view_coaching"),
  getWeek3ReviewQueue
);

router.patch(
  "/:id/review",
  authorize("admin", "coach", "doctor", "staff"),
  requirePermission("view_coaching"),
  markReviewed
);

router.post(
  "/:id/dismiss-flag",
  authorize("admin", "coach", "doctor", "staff"),
  requirePermission("view_coaching"),
  dismissFlag
);

router.get(
  "/queue/needs-attention",
  authorize("admin", "coach", "doctor", "staff"),
  requirePermission("view_coaching"),
  getNeedsAttention
);

router.get(
  "/",
  authorize("admin", "coach", "doctor", "staff"),
  requirePermission("view_clients"),
  getClients
);

router.post(
  "/",
  authorize("admin"),
  requirePermission("view_clients"),
  createClient
);

router.use("/:id", requireClientRecordAccess);

router.get(
  "/:id",
  authorize("admin", "coach", "doctor", "staff"),
  requirePermission("view_clients"),
  getClientById
);

router.patch(
  "/:id",
  authorize("admin", "coach"),
  requirePermission("view_clients"),
  handleCareTeamAssignment,
  updateClient
);

router.patch(
  "/:id/lifecycle",
  authorize("admin", "coach"),
  requirePermission("view_clients"),
  updateClientLifecycle
);

router.get(
  "/:id/onboarding-checklist",
  authorize("admin", "coach", "staff"),
  getStaffClientOnboardingChecklist
);

router.post(
  "/:id/week3-review",
  authorize("admin", "coach", "staff"),
  requirePermission("view_coaching"),
  completeWeek3Review
);

router.delete(
  "/:id",
  authorize("admin"),
  requirePermission("view_clients"),
  archiveClient
);

router.post(
  "/:id/restore",
  authorize("admin"),
  requirePermission("view_clients"),
  restoreClient
);

router.post(
  "/:id/checkins",
  authorize("admin", "coach", "doctor", "staff"),
  requirePermission("view_coaching"),
  addCheckIn
);

router.post(
  "/:id/payment-link",
  authorize("admin", "sales"),
  requirePermission("view_crm"),
  generateStaffPaymentLink
);

router.post(
  "/:id/email-payment-link",
  authorize("admin", "sales"),
  requirePermission("view_crm"),
  emailPaymentLink
);

router.post(
  "/:id/reconcile",
  authorize("admin", "coach"),
  requirePermission("view_requests"),
  reconcilePayment
);

router.post(
  "/:id/admin-reconciliation-review",
  authorize("admin", "coach"),
  requirePermission("view_requests"),
  reviewPaymentMismatch
);

router.post(
  "/:id/final-reconcile",
  authorize("admin", "coach"),
  requirePermission("view_requests"),
  finalReconcilePayment
);

router.post(
  "/:id/manual-activate",
  authorize("admin"),
  requirePermission("view_clients"),
  manualActivateClient
);

router.get(
  "/:id/daily-logs",
  authorize("admin", "coach", "doctor", "staff"),
  requirePermission("view_clients"),
  getClientDailyLogs
);

router.get(
  "/:id/streak",
  authorize("admin", "coach", "doctor", "staff"),
  requirePermission("view_clients"),
  getClientStreak
);

router.post(
  "/:id/checklist",
  authorize("admin", "coach"),
  requirePermission("view_clients"),
  addChecklistItem
);

router.delete(
  "/:id/checklist/:itemId",
  authorize("admin", "coach"),
  requirePermission("view_clients"),
  removeChecklistItem
);

router.post(
  "/:id/mark-reviewed",
  authorize("admin", "coach", "doctor", "staff"),
  requirePermission("view_coaching"),
  markReviewed
);

router.patch(
  "/:id/timetable-mode",
  authorize("admin", "coach"),
  requirePermission("view_clients"),
  setTimetableMode
);

router.post(
  "/:id/timetable/:dayNumber",
  authorize("admin", "coach"),
  requirePermission("view_clients"),
  addTimetableItem
);

router.delete(
  "/:id/timetable/:dayNumber/:itemId",
  authorize("admin", "coach"),
  requirePermission("view_clients"),
  removeTimetableItem
);

router.post(
  "/:id/timetable/:day/exercises",
  authorize("admin", "coach"),
  requirePermission("view_clients"),
  addExercise
);

router.delete(
  "/:id/timetable/:day/exercises/:exerciseId",
  authorize("admin", "coach"),
  requirePermission("view_clients"),
  removeExercise
);

export default router;
