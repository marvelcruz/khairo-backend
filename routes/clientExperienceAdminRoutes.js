import express from "express";
import { protect, authorize } from "../middleware/auth.js";
import {
  staffListMessages,
  staffReply,
  staffAddSharedItem,
  staffListSharedItems,
} from "../controllers/clientExperienceController.js";
import { requireClientRecordAccess } from "../middleware/clientRecordAccess.js";

const router = express.Router();
router.use(protect);

router.get(
  "/messages",
  authorize("admin", "staff", "coach", "doctor"),
  staffListMessages
);

router.post(
  "/messages/:clientId/reply",
  authorize("admin", "staff", "coach", "doctor"),
  requireClientRecordAccess,
  staffReply
);

router.get(
  "/documents",
  authorize("admin"),
  staffListSharedItems
);

router.post(
  "/documents/:clientId",
  authorize("admin", "staff", "coach", "doctor"),
  requireClientRecordAccess,
  staffAddSharedItem
);

export default router;
