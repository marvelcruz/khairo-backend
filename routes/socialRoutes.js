import express from "express";

import {
  protect,
  authorize,
  requirePermission,
} from "../middleware/auth.js";

import {
  getSocialDashboard,
  createSocialAccount,
  createSocialPost,
  updateSocialPostStatus,
  updateSocialMetrics,
  publishInstagramPost,
} from "../controllers/socialController.js";

import { getSocialProviderFramework } from "../controllers/socialProviderFrameworkController.js";
import {
  connectionCallback,
  disconnectConnection,
  listConnections,
  selectConnectionAccount,
  startConnection,
} from "../controllers/connectionController.js";

const router = express.Router();

// Provider sign-in returns here. The signed state identifies the workspace and
// initiating administrator, so no customer credentials are handled by Khairo Diet Clinic.
router.get("/connections/callback/:provider", connectionCallback);

router.use(protect);

router.get("/connections", authorize("admin"), listConnections);
router.get("/connections/:provider/start", authorize("admin"), startConnection);
router.post("/connections/:provider/select", authorize("admin"), selectConnectionAccount);
router.delete("/connections/:provider", authorize("admin"), disconnectConnection);

router.use(requirePermission("view_social_media"));

router.get(
  "/framework",
  authorize("admin", "staff", "sales", "coach"),
  getSocialProviderFramework
);

router.get(
  "/",
  authorize("admin", "staff", "sales", "coach"),
  getSocialDashboard
);

router.post("/accounts", authorize("admin"), createSocialAccount);

router.post(
  "/instagram/publish",
  authorize("admin", "staff", "sales"),
  publishInstagramPost
);

router.post(
  "/posts",
  authorize("admin", "staff", "sales"),
  createSocialPost
);

router.patch(
  "/posts/:id/status",
  authorize("admin", "staff", "sales"),
  updateSocialPostStatus
);

router.patch(
  "/posts/:id/metrics",
  authorize("admin", "staff", "sales"),
  updateSocialMetrics
);

export default router;
