import express from "express";
import { getStaffOnboardingQueue } from "../controllers/onboardingController.js";
import {
  authorize,
  protect,
  requirePermission,
} from "../middleware/auth.js";

const router = express.Router();

router.get(
  "/",
  protect,
  authorize("admin", "staff", "coach"),
  requirePermission("view_clients"),
  getStaffOnboardingQueue
);

export default router;
