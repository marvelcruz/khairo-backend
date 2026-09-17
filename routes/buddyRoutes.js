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

router.get("/my-buddy", protectClient, getMyBuddy);

router.get(
  "/all",
  protect,
  filterByPermissions,
  requirePermission("view_buddies"),
  authorize("admin", "coach"),
  getAllPairs
);

router.get(
  "/unpaired",
  protect,
  filterByPermissions,
  requirePermission("view_buddies"),
  authorize("admin", "coach"),
  getUnpairedClients
);

router.post(
  "/pair",
  protect,
  requirePermission("view_buddies"),
  authorize("admin", "coach"),
  createPair
);

router.put(
  "/pair/:pairId",
  protect,
  requirePermission("view_buddies"),
  authorize("admin", "coach"),
  updatePair
);

export default router;
