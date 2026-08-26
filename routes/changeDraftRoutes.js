import express from "express";
import { getDrafts, createDraft, finalizeDraft, rejectDraft } from "../controllers/changeDraftController.js";
import { protect, authorize } from "../middleware/auth.js";

const router = express.Router();

router.use(protect);
router.use(authorize("admin"));

router.get("/entity/:entityType/:entityId", getDrafts);
router.post("/entity/:entityType/:entityId", createDraft);
router.post("/:id/finalize", authorize("admin"), finalizeDraft);
router.post("/:id/reject", authorize("admin"), rejectDraft);

export default router;
