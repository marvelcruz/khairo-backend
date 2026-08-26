import express from "express";

import {
  protect,
  authorize,
} from "../middleware/auth.js";

import {
  getActionCentre,
  runActionCentreScan,
  resolveActionAlert,
} from "../controllers/actionCentreController.js";

const router = express.Router();

router.use(protect);

router.get(
  "/",
  authorize(
    "admin",
    "sales",
    "coach",
    "staff"
  ),
  getActionCentre
);

router.post(
  "/scan",
  authorize("admin"),
  runActionCentreScan
);

router.patch(
  "/:id/resolve",
  authorize(
    "admin",
    "sales",
    "coach",
    "staff"
  ),
  resolveActionAlert
);

export default router;
