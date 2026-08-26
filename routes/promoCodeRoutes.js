import express from "express";
import {
  listPromoCodes,
  createPromoCode,
  updatePromoCode,
  deletePromoCode,
  validatePromoCode,
} from "../controllers/promoCodeController.js";
import { protect, authorize } from "../middleware/auth.js";

const router = express.Router();

// Public validation during checkout
router.post("/validate", validatePromoCode);

// Admin management
router.use(protect);
router.use(authorize("admin"));

router.get("/", listPromoCodes);
router.post("/", createPromoCode);
router.patch("/:id", updatePromoCode);
router.delete("/:id", deletePromoCode);

export default router;
