import express from "express";
import { getAuditLogs } from "../controllers/auditController.js";
import { protect, authorize } from "../middleware/auth.js";

const router = express.Router();

router.use(protect);
router.use(authorize("admin"));

router.get("/", getAuditLogs);

export default router;
