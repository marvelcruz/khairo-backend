import express from "express";
import { getAllReviews, getClientReviews, triggerManualReview } from "../controllers/reviewController.js";
import { protect, authorize, requirePermission } from "../middleware/auth.js";
import { requireClientRecordAccess } from "../middleware/clientRecordAccess.js";

const router = express.Router();
router.use(protect);
router.use(authorize("admin", "coach"));
router.use(requirePermission("view_clients"));

router.get("/", getAllReviews);
router.get("/client/:id", requireClientRecordAccess, getClientReviews);
router.post("/generate/:id", requireClientRecordAccess, triggerManualReview);

export default router;
