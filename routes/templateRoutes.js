import express from "express";
import { getTemplates, updateTemplate } from "../controllers/templateController.js";
import { protect, authorize } from "../middleware/auth.js";
const router = express.Router();
router.get("/templates", protect, authorize("admin"), getTemplates);
router.put("/templates/:id", protect, authorize("admin"), updateTemplate);
export default router;
