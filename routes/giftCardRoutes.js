import express from "express";
import {
  listGiftCards,
  createGiftCard,
  updateGiftCard,
  deleteGiftCard,
  validateGiftCard,
} from "../controllers/giftCardController.js";
import { protect, authorize } from "../middleware/auth.js";

const router = express.Router();

// Public validation
router.post("/validate", validateGiftCard);

// Admin management
router.use(protect);
router.use(authorize("admin"));

router.get("/", listGiftCards);
router.post("/", createGiftCard);
router.patch("/:id", updateGiftCard);
router.delete("/:id", deleteGiftCard);

export default router;
