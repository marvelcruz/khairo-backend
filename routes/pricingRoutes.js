import express from "express";
import { updatePricing } from "../controllers/pricingController.js";
import { protect, authorize } from "../middleware/auth.js";

const router = express.Router();

router.patch("/", protect, authorize("admin"), updatePricing);

export default router;
