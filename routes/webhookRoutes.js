import express from "express";
import { handlePaystackWebhook } from "../controllers/paymentActivationController.js";
import {
  handleMetaWebhook,
  verifyMetaWebhook,
} from "../controllers/metaWebhookController.js";

const router = express.Router();

router.get("/meta", verifyMetaWebhook);
router.post("/meta", handleMetaWebhook);
router.post("/paystack", handlePaystackWebhook);

export default router;
