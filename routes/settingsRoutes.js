import express from "express";

import {
  getBusinessSettings,
  getConsultationFee,
  updateBusinessSettings,
  updateConsultationFee,
} from "../controllers/settingsController.js";
import {
  completeSetup,
  getSetupStatus,
  updateSetupSection,
} from "../controllers/setupController.js";

import {
  protect,
  authorize,
} from "../middleware/auth.js";

const router = express.Router();

router.get(
  "/consultation-fee",
  protect,
  getConsultationFee
);

router.put(
  "/consultation-fee",
  protect,
  authorize("admin"),
  updateConsultationFee
);

router.get(
  "/business",
  protect,
  authorize("admin"),
  getBusinessSettings
);

router.put(
  "/business",
  protect,
  authorize("admin"),
  updateBusinessSettings
);

router.get(
  "/setup/status",
  protect,
  authorize("admin"),
  getSetupStatus
);

router.put(
  "/setup/section/:section",
  protect,
  authorize("admin"),
  updateSetupSection
);

router.post(
  "/setup/complete",
  protect,
  authorize("admin"),
  completeSetup
);

export default router;
