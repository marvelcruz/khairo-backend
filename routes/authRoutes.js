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
import { loginLimiter } from "../middleware/rateLimiters.js";

const router = express.Router();

router.get("/google", staffGoogleAuth);
router.get("/google/callback", staffGoogleCallback);
router.get("/apple", staffAppleAuth);
router.post("/apple/callback", staffAppleCallback);

router.post("/login", loginLimiter, login);
router.post("/logout", logout);
router.post("/forgot-password", loginLimiter, requestStaffPasswordReset);
router.post("/reset-password", loginLimiter, completeStaffPasswordReset);
router.get("/me", protect, getMe);
router.patch("/change-password", protect, changePassword);

router.get("/push/public-key", protect, getPushPublicKey);
router.post("/push/subscribe", protect, subscribeToPush);
router.post("/push/unsubscribe", protect, unsubscribeFromPush);

router.post("/staff", protect, authorize("admin"), createStaffAccount);
router.get("/staff", protect, authorize("admin"), listStaffAccounts);
router.patch("/staff/:id", protect, authorize("admin"), updateStaffAccount);

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
