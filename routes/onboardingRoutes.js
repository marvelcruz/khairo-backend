import express from "express";
import {
  getOnboarding,
  getStaffOnboardingQueue,
  updateOnboarding,
} from "../controllers/onboardingController.js";
import { protectClient } from "../middleware/clientAuth.js";
import {
  authorize,
  protect,
  requirePermission,
} from "../middleware/auth.js";

const router = express.Router();

router.get("/onboarding", protectClient, getOnboarding);
router.put("/onboarding", protectClient, updateOnboarding);

router.get(
  "/staff/onboarding",
  protect,
  authorize("admin", "staff", "coach"),
  requirePermission("view_clients"),
  getStaffOnboardingQueue
);

export default router;
