import express from "express";
import {
  getMyBuddy,
  getAllPairs,
  getUnpairedClients,
  createPair,
  updatePair,
} from "../controllers/buddyController.js";
import { protect, authorize, requirePermission } from "../middleware/auth.js";
import { protectClient } from "../middleware/clientAuth.js";
import { filterByPermissions } from "../controllers/clientController.js";

const router = express.Router();

router.get("/buddy/my-buddy", protectClient, getMyBuddy);

router.get(
  "/buddy/all",
  protect,
  filterByPermissions,
  requirePermission("view_buddies"),
  authorize("admin", "coach"),
  getAllPairs
);

router.get(
  "/buddy/unpaired",
  protect,
  filterByPermissions,
  requirePermission("view_buddies"),
  authorize("admin", "coach"),
  getUnpairedClients
);

router.post(
  "/buddy/pair",
  protect,
  requirePermission("view_buddies"),
  authorize("admin", "coach"),
  createPair
);

router.put(
  "/buddy/pair/:pairId",
  protect,
  requirePermission("view_buddies"),
  authorize("admin", "coach"),
  updatePair
);

export default router;
