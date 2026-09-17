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
} from "../middleware/rateLimiters.js";
import { requireTrustedAuthenticatedOrigin } from "../middleware/trustedOrigin.js";
import { validate } from "../middleware/validate.js";
import {
  clientActivationSchema,
  clientRegistrationSchema,
  emailOnlySchema,
  loginSchema,
  passwordResetSchema,
} from "../validation/authSchemas.js";

const router = express.Router();

router.post(
  "/register",
  sanitizeAuthInput,
  validate({ body: clientRegistrationSchema }),
  authFlowLimiter,
  preventExistingClientPortalRegistration,
  registerPreviewAccount
);

router.post(
  "/request-activation",
  sanitizeAuthInput,
  validate({ body: emailOnlySchema }),
  authFlowLimiter,
  requestClientActivation
);

router.post(
  "/activate",
  sanitizeAuthInput,
  validate({ body: clientActivationSchema }),
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
  validate({ body: loginSchema }),
  loginLimiter,
  clientLogin
);

router.post(
  "/forgot-password",
  sanitizeAuthInput,
  validate({ body: emailOnlySchema }),
  authFlowLimiter,
  requestClientPasswordReset
);

router.post(
  "/reset-password",
  sanitizeAuthInput,
  validate({ body: passwordResetSchema }),
  authFlowLimiter,
  completeClientPasswordReset
);

router.post(
  "/logout",
  requireTrustedAuthenticatedOrigin,
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
