import express from "express";
import {
  registerPreviewAccount,
  clientLogin,
  clientLogout,
  getClientMe,
} from "../controllers/clientAuthController.js";
import {
  clientGoogleAuth,
  clientGoogleCallback,
  clientAppleAuth,
  clientAppleCallback,
} from "../controllers/socialAuthController.js";
import {
  preventExistingClientPortalRegistration,
  requestClientPasswordReset,
  completeClientPasswordReset,
  requestClientActivation,
  completeClientActivation,
} from "../controllers/clientAuthRecoveryController.js";
import { protectClient } from "../middleware/clientAuth.js";
import { updateCalorieCalculator } from "../controllers/clientAuthController.js";
import { loginLimiter } from "../middleware/rateLimiters.js";

const router = express.Router();

router.post(
  "/register",
  loginLimiter,
  preventExistingClientPortalRegistration,
  registerPreviewAccount
);

router.post(
  "/request-activation",
  loginLimiter,
  requestClientActivation
);

router.post(
  "/activate",
  loginLimiter,
  completeClientActivation
);

router.get("/google", clientGoogleAuth);
router.get("/google/callback", clientGoogleCallback);
router.get("/apple", clientAppleAuth);
router.post("/apple/callback", clientAppleCallback);

router.post(
  "/login",
  loginLimiter,
  clientLogin
);

router.post(
  "/forgot-password",
  loginLimiter,
  requestClientPasswordReset
);

router.post(
  "/reset-password",
  loginLimiter,
  completeClientPasswordReset
);

router.post(
  "/logout",
  clientLogout
);

router.get(
  "/me",
  protectClient,
  getClientMe
);


router.post(
  "/calorie-calculator",
  protectClient,
  updateCalorieCalculator
);

export default router;
