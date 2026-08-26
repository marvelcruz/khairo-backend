import express from "express";
import { cronRenewals } from "../controllers/cronController.js";
import { protect, authorize } from "../middleware/auth.js";

const router = express.Router();

router.get("/renewals", protect, authorize("admin"), cronRenewals);

export default router;
