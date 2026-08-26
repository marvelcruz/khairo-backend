import express from "express";
import {
  addMedicalReviewAddendum,
  getMedicalReview,
  listMedicalReviews,
  recordMedicalReviewOutcome,
  scheduleMedicalReview,
  signMedicalReviewRecord,
} from "../controllers/medicalReviewController.js";
import { authorize, protect } from "../middleware/auth.js";

const router = express.Router();

router.use(protect);

router.get("/", authorize("admin", "doctor"), listMedicalReviews);
router.get("/:id", authorize("admin", "doctor"), getMedicalReview);
router.post("/:id/schedule", authorize("admin", "doctor"), scheduleMedicalReview);
router.post("/:id/sign", authorize("doctor"), signMedicalReviewRecord);
router.post("/:id/addenda", authorize("doctor"), addMedicalReviewAddendum);
router.post("/:id/outcome", authorize("doctor"), recordMedicalReviewOutcome);

export default router;
