import express from "express";
import {
  getOnboarding,
  updateOnboarding,
} from "../controllers/onboardingController.js";
import { protectClient } from "../middleware/clientAuth.js";

const router = express.Router();

router.get("/", protectClient, getOnboarding);
router.put("/", protectClient, updateOnboarding);

export default router;
