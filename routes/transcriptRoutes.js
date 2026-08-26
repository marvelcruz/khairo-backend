import express from "express";
import { timingSafeEqual } from "crypto";
import { protect, authorize, requireAnyPermission } from "../middleware/auth.js";
import { requireClientRecordAccess } from "../middleware/clientRecordAccess.js";
import { requireRequestedClientAccess } from "../middleware/sessionAccess.js";
import { listClientTranscripts, createTranscript, webhookIngest, getSessionTranscripts } from "../controllers/transcriptController.js";

const router = express.Router();

const protectTranscriptWebhook = (req, res, next) => {
  const expected =
    process.env.TRANSCRIPT_WEBHOOK_SECRET;

  if (!expected) {
    return res.status(503).json({
      success: false,
      message: "Transcript webhook is not configured.",
    });
  }

  const supplied =
    req.get("x-khairo-webhook-secret");

  if (!supplied) {
    return res.status(401).json({
      success: false,
      message: "Invalid webhook credentials.",
    });
  }

  const expectedBuffer = Buffer.from(expected);
  const suppliedBuffer = Buffer.from(supplied);

  if (
    expectedBuffer.length !==
      suppliedBuffer.length ||
    !timingSafeEqual(
      expectedBuffer,
      suppliedBuffer
    )
  ) {
    return res.status(401).json({
      success: false,
      message: "Invalid webhook credentials.",
    });
  }

  next();
};

router.post(
  "/webhook",
  protectTranscriptWebhook,
  webhookIngest
);
router.use(protect);
router.use(authorize("admin", "coach", "doctor"));
router.use(
  requireAnyPermission(
    "view_clients",
    "view_appointments"
  )
);
router.get("/session/:sessionId", getSessionTranscripts);
router.get("/client/:clientId", requireClientRecordAccess, listClientTranscripts);
router.post("/", requireRequestedClientAccess, createTranscript);

export default router;
