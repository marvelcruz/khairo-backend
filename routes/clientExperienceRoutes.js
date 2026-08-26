import express from "express";
import { protectClient } from "../middleware/clientAuth.js";
import {
  addMeasurement,
  getMeasurements,
  getMessages,
  sendClientMessage,
  getPayments,
  getProfile,
  updateProfile,
  getSharedItems,
  getNotifications,
} from "../controllers/clientExperienceController.js";
import { getClientOnboardingChecklist } from "../controllers/clientOnboardingChecklistController.js";

const router = express.Router();

router.use(protectClient);

router.get(
  "/measurements",
  getMeasurements
);

router.post(
  "/measurements",
  addMeasurement
);

router.get(
  "/messages",
  getMessages
);

router.post(
  "/messages",
  sendClientMessage
);

router.get(
  "/payments",
  getPayments
);

router.get(
  "/profile",
  getProfile
);

router.patch(
  "/profile",
  updateProfile
);

router.get(
  "/documents",
  getSharedItems
);

router.get(
  "/onboarding-checklist",
  getClientOnboardingChecklist
);

router.get(
  "/notifications",
  getNotifications
);

export default router;
