import express from "express";
import { protect, authorize } from "../middleware/auth.js";
import { requireCareTeamClientAccess } from "../middleware/clientRecordAccess.js";
import {
  getCareTeamSnapshot,
  getCareTeamProgressPhoto,
} from "../controllers/careTeamController.js";

const router = express.Router();
router.use(protect);
router.use(authorize("admin", "coach", "doctor"));

router.get(
  "/clients/:clientId",
  requireCareTeamClientAccess,
  getCareTeamSnapshot
);

router.get(
  "/clients/:clientId/progress-photos/:photoId/image",
  requireCareTeamClientAccess,
  getCareTeamProgressPhoto
);

export default router;
