import express from "express";
import {
  getSegments,
  previewSegment,
  getTemplates,
  createTemplate,
  logBroadcast,
  getBroadcastHistory,
  sendViaWhatsAppApi,
} from "../controllers/broadcastController.js";
import {
  getApprovedWhatsAppTemplates,
  sendApprovedWhatsAppTemplate,
} from "../controllers/whatsappTemplateBroadcastController.js";
import { protect, authorize, requirePermission } from "../middleware/auth.js";

const router = express.Router();

const canBroadcast = [
  protect,
  requirePermission("view_broadcast"),
  authorize("admin", "sales", "coach"),
];

router.get("/segments", ...canBroadcast, getSegments);
router.get("/preview", ...canBroadcast, previewSegment);
router.get("/templates", ...canBroadcast, getTemplates);
router.post("/templates", ...canBroadcast, createTemplate);
router.get(
  "/whatsapp-templates",
  ...canBroadcast,
  getApprovedWhatsAppTemplates
);
router.get("/history", ...canBroadcast, getBroadcastHistory);
router.post("/log", ...canBroadcast, logBroadcast);
router.post("/send-wa", ...canBroadcast, sendViaWhatsAppApi);
router.post(
  "/send-wa-template",
  ...canBroadcast,
  sendApprovedWhatsAppTemplate
);

export default router;
