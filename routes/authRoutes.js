import express from "express";
import {
  login,
  logout,
  getMe,
  createStaffAccount,
  listStaffAccounts,
  updateStaffAccount,
  changePassword,
  getDoctors,
  getStaffDirectory,
  getPushPublicKey,
  subscribeToPush,
  unsubscribeFromPush,
} from "../controllers/authController.js";
import {
  staffGoogleAuth,
  staffGoogleCallback,
  staffAppleAuth,
  staffAppleCallback,
} from "../controllers/socialAuthController.js";
import {
  requestStaffPasswordReset,
  completeStaffPasswordReset,
} from "../controllers/authRecoveryController.js";
import { protect, authorize, requireAnyPermission } from "../middleware/auth.js";
import {
  authFlowLimiter,
  loginLimiter,
  sanitizeAuthInput,
} from "../middleware/rateLimiters.js";
import { requireTrustedAuthenticatedOrigin } from "../middleware/trustedOrigin.js";
import { validate } from "../middleware/validate.js";
import {
  changePasswordSchema,
  createStaffSchema,
  emailOnlySchema,
  loginSchema,
  mongoIdParamsSchema,
  passwordResetSchema,
  pushSubscriptionSchema,
  pushUnsubscribeSchema,
  updateStaffSchema,
} from "../validation/authSchemas.js";

const router = express.Router();

router.get("/google", staffGoogleAuth);
router.get("/google/callback", staffGoogleCallback);
router.get("/apple", staffAppleAuth);
router.post("/apple/callback", staffAppleCallback);

router.post(
  "/login",
  sanitizeAuthInput,
  validate({ body: loginSchema }),
  loginLimiter,
  login
);
router.post("/logout", requireTrustedAuthenticatedOrigin, logout);
router.post(
  "/forgot-password",
  sanitizeAuthInput,
  validate({ body: emailOnlySchema }),
  authFlowLimiter,
  requestStaffPasswordReset
);
router.post(
  "/reset-password",
  sanitizeAuthInput,
  validate({ body: passwordResetSchema }),
  authFlowLimiter,
  completeStaffPasswordReset
);
router.get("/me", protect, getMe);
router.patch(
  "/change-password",
  protect,
  validate({ body: changePasswordSchema }),
  changePassword
);

router.get("/push/public-key", protect, getPushPublicKey);
router.post(
  "/push/subscribe",
  protect,
  validate({ body: pushSubscriptionSchema }),
  subscribeToPush
);
router.post(
  "/push/unsubscribe",
  protect,
  validate({ body: pushUnsubscribeSchema }),
  unsubscribeFromPush
);

router.post(
  "/staff",
  protect,
  authorize("admin"),
  validate({ body: createStaffSchema }),
  createStaffAccount
);
router.get("/staff", protect, authorize("admin"), listStaffAccounts);
router.patch(
  "/staff/:id",
  protect,
  authorize("admin"),
  validate({ params: mongoIdParamsSchema, body: updateStaffSchema }),
  updateStaffAccount
);

router.get(
  "/directory",
  protect,
  requireAnyPermission(
    "view_clients",
    "view_orders",
    "view_appointments",
    "view_requests"
  ),
  getStaffDirectory
);

router.get(
  "/doctors",
  protect,
  requireAnyPermission(
    "view_requests",
    "view_appointments"
  ),
  getDoctors
);

export default router;
