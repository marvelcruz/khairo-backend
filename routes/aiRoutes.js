import express from "express";
import { protect, authorize } from "../middleware/auth.js";
import { testGemini } from "../controllers/geminiController.js";

const router = express.Router();

router.post(
  "/test",
  protect,
  authorize("admin"),
  testGemini
);

export default router;
