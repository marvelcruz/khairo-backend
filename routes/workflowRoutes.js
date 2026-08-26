import express from "express";
import {
  createWorkflow,
  duplicateWorkflowTemplate,
  getManualRunContacts,
  getWorkflow,
  getWorkflowReferenceData,
  listWorkflowRuns,
  listWorkflows,
  runWorkflowManually,
  setWorkflowStatus,
  updateWorkflow,
} from "../controllers/workflowController.js";
import { authorize, protect } from "../middleware/auth.js";

const router = express.Router();
router.use(protect);
router.use(authorize("admin"));

router.get("/reference-data", getWorkflowReferenceData);
router.get("/manual-contacts", getManualRunContacts);
router.get("/runs", listWorkflowRuns);
router.get("/", listWorkflows);
router.get("/:id", getWorkflow);
router.post("/", createWorkflow);
router.patch("/:id", updateWorkflow);
router.patch("/:id/status", setWorkflowStatus);
router.post("/templates/:id/duplicate", duplicateWorkflowTemplate);
router.post("/:id/run", runWorkflowManually);

export default router;
