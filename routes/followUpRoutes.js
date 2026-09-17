import express from "express";
import { runFollowUp, debugClients, getQueue, voidClient, hygiene } from "../controllers/followUpController.js";
import { protect, authorize, requirePermission } from "../middleware/auth.js";

const router = express.Router();

router.get("/run", protect, authorize("admin"), runFollowUp);
router.get("/debug", protect, authorize("admin"), debugClients);
router.get(
  "/queue",
  protect,
  requirePermission("view_requests"),
  authorize("admin", "sales"),
  getQueue
);
router.get("/hygiene", protect, authorize("admin"), hygiene);
router.post("/void/:id", protect, authorize("admin"), voidClient);

export default router;
