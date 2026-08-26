import express from "express";
import { filterByPermissions } from "../controllers/clientController.js";
import {
  getRevenueSummary,
  exportRevenueCsv,
  getMonthlyGoal,
  setMonthlyGoal,
  getStaffPerformance,
  getKPIs,
} from "../controllers/reportController.js";
import { getPipelineReport } from "../controllers/reportController.js";
import { getLeadSourceReport, exportReport } from "../controllers/reportController.js";
import { getLaunchReadiness } from "../controllers/launchReadinessController.js";
import { listPayments } from "../controllers/paymentController.js";
import { protect, authorize, requirePermission, requireAnyPermission } from "../middleware/auth.js";

const router = express.Router();

router.use(protect);
router.use(filterByPermissions);
router.use(authorize("admin", "staff"));
// Doctor restriction: doctors cannot access reports
router.use((req, res, next) => {
  if (req.user.roles && req.user.roles.includes("doctor") && !req.user.roles.includes("admin")) {
    return res.status(403).json({ success: false, message: "Doctors cannot access financial reports." });
  }
  next();
});

router.get(
  "/revenue",
  requireAnyPermission(
    "view_reports",
    "view_billing"
  ),
  getRevenueSummary
);
router.get("/revenue/export", authorize("admin"), exportRevenueCsv);
router.get(
  "/payments",
  requirePermission("view_billing"),
  listPayments
);
router.get(
  "/staff-performance",
  requirePermission("view_reports"),
  getStaffPerformance
);
router.get(
  "/lead-sources",
  requirePermission("view_reports"),
  getLeadSourceReport
);

router.get(
  "/pipeline",
  requirePermission("view_reports"),
  getPipelineReport
);

router.get(
  "/kpis",
  requirePermission("view_reports"),
  getKPIs
);
router.get(
  "/launch-readiness",
  requirePermission("view_reports"),
  getLaunchReadiness
);

router.get("/export", authorize("admin", "staff"), exportReport);

router.get("/goal", authorize("admin"), getMonthlyGoal);
router.post("/goal", authorize("admin"), setMonthlyGoal);

export default router;
