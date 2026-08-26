import express from "express";
import { submitApplication } from "../controllers/applicationController.js";
import { submitPublicCrmLead } from "../controllers/crmController.js";
import { applicationLimiter } from "../middleware/rateLimiters.js";

const router = express.Router();

router.post("/applications", applicationLimiter, submitApplication);
router.post("/contact", applicationLimiter, submitPublicCrmLead);

export default router;
