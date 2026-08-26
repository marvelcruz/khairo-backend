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

router.get(
  "/broadcast/segments",
  ...canBroadcast,
  getSegments
);

router.get(
  "/broadcast/preview",
  ...canBroadcast,
  previewSegment
);

router.get(
  "/broadcast/templates",
  ...canBroadcast,
  getTemplates
);

router.post(
  "/broadcast/templates",
  ...canBroadcast,
  createTemplate
);

router.get(
  "/broadcast/whatsapp-templates",
  ...canBroadcast,
  getApprovedWhatsAppTemplates
);

router.get(
  "/broadcast/history",
  ...canBroadcast,
  getBroadcastHistory
);

router.post(
  "/broadcast/log",
  ...canBroadcast,
  logBroadcast
);

router.post(
  "/broadcast/send-wa",
  ...canBroadcast,
  sendViaWhatsAppApi
);

router.post(
  "/broadcast/send-wa-template",
  ...canBroadcast,
  sendApprovedWhatsAppTemplate
);

export default router;
