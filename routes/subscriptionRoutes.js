import express from "express";

import {
  listSubscriptions,
} from "../controllers/subscriptionController.js";

import {
  protect,
  requirePermission,
} from "../middleware/auth.js";

const router = express.Router();

router.use(protect);
router.use(requirePermission("view_billing"));

router.get("/", listSubscriptions);

export default router;
