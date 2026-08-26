import {
  createManualApplication,
  updateConsultationDetails,
  generateConsultationLink,
  generateCombinedLink,
  reconcileConsultation,
  getApplications,
  updateApplication,
  approveApplication,
  nudgeStuckLeads,
} from "../controllers/applicationController.js";
import {
  recommendQualification,
  recordQualificationDecision,
} from "../controllers/qualificationController.js";
import express from "express";
import { protect, authorize, requirePermission } from "../middleware/auth.js";
import { requireQualifiedApplication } from "../middleware/requireQualifiedApplication.js";
import { filterByPermissions } from "../controllers/clientController.js";

const router = express.Router();

router.use(protect);
router.use(requirePermission("view_requests"));

router.get(
  "/",
  authorize("admin", "sales", "coach"),
  filterByPermissions,
  getApplications
);

router.patch(
  "/:id",
  authorize("admin", "sales"),
  updateApplication
);

router.post(
  "/manual",
  authorize("admin", "sales"),
  createManualApplication
);

router.post(
  "/nudge-stuck",
  authorize("admin", "sales"),
  nudgeStuckLeads
);

router.post(
  "/:id/qualification/recommendation",
  authorize("admin", "sales"),
  recommendQualification
);

router.patch(
  "/:id/qualification",
  authorize("admin", "sales"),
  recordQualificationDecision
);

router.post(
  "/:id/approve",
  authorize("admin", "sales"),
  requireQualifiedApplication,
  approveApplication
);

router.patch(
  "/:id/consultation",
  authorize("admin", "sales"),
  updateConsultationDetails
);

router.post(
  "/:id/consultation-link",
  authorize("admin", "sales"),
  generateConsultationLink
);

router.post(
  "/:id/combined-link",
  authorize("admin", "sales"),
  generateCombinedLink
);

router.post(
  "/:id/reconcile-consultation",
  authorize("admin", "coach"),
  reconcileConsultation
);

export default router;
