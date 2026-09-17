import express from "express";
import { getPublicPricing } from "../controllers/pricingController.js";

const router = express.Router();

router.get("/", getPublicPricing);

export default router;
