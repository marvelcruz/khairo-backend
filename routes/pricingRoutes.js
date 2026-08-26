import express from "express";
import { getPublicPricing, updatePricing } from "../controllers/pricingController.js";
import { protect, authorize } from "../middleware/auth.js";
const router = express.Router();
router.get("/public/pricing", getPublicPricing);
router.patch("/pricing", protect, authorize("admin"), updatePricing);
export default router;
