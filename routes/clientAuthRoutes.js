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
import {
  authFlowLimiter,
  loginLimiter,
  sanitizeAuthInput,
  validateLoginRequest,
} from "../middleware/rateLimiters.js";

const router = express.Router();

router.post(
  "/register",
  sanitizeAuthInput,
  authFlowLimiter,
  preventExistingClientPortalRegistration,
  registerPreviewAccount
);

router.post(
  "/request-activation",
  sanitizeAuthInput,
  authFlowLimiter,
  requestClientActivation
);

router.post(
  "/activate",
  sanitizeAuthInput,
  authFlowLimiter,
  completeClientActivation
);

router.get("/google", clientGoogleAuth);
router.get("/google/callback", clientGoogleCallback);
router.get("/apple", clientAppleAuth);
router.post("/apple/callback", clientAppleCallback);

router.post(
  "/login",
  sanitizeAuthInput,
  loginLimiter,
  validateLoginRequest,
  clientLogin
);

router.post(
  "/forgot-password",
  sanitizeAuthInput,
  authFlowLimiter,
  requestClientPasswordReset
);

router.post(
  "/reset-password",
  sanitizeAuthInput,
  authFlowLimiter,
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
