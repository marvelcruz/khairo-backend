import express from "express";
import { runFollowUp, debugClients, getQueue, voidClient, hygiene } from "../controllers/followUpController.js";
import { protect, authorize, requirePermission } from "../middleware/auth.js";
const router = express.Router();
router.get("/follow-up/run", protect, authorize("admin"), runFollowUp);
router.get("/follow-up/debug", protect, authorize("admin"), debugClients);
router.get(
  "/follow-up/queue",
  protect,
  requirePermission("view_requests"),
  authorize("admin", "sales"),
  getQueue
);
router.get("/follow-up/hygiene", protect, authorize("admin"), hygiene);
router.post("/follow-up/void/:id", protect, authorize("admin"), voidClient);
export default router;
