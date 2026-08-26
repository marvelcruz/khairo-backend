import express from "express";
import { initializePayment } from "../controllers/paymentController.js";
import { verifyPayment } from "../controllers/paymentActivationController.js";
import { protectClient } from "../middleware/clientAuth.js";
import { normalizeClientPaymentPurpose } from "../middleware/paymentPurposeGuard.js";

const router = express.Router();

router.post(
  "/initialize",
  protectClient,
  normalizeClientPaymentPurpose,
  initializePayment
);
router.get("/verify/:reference", protectClient, verifyPayment);

export default router;
