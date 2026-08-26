import express from "express";
import {
  createForm,
  getAvailableForms,
  getForm,
  getRunnableForm,
  getPublicForm,
  listForms,
  listFormSubmissions,
  setFormStatus,
  submitInternalForm,
  submitPublicForm,
  updateForm,
} from "../controllers/formController.js";
import { authorize, protect } from "../middleware/auth.js";
import { formSubmissionLimiter } from "../middleware/rateLimiters.js";

const router = express.Router();

router.get("/public/:slug", getPublicForm);
router.post("/public/:slug/submit", formSubmissionLimiter, submitPublicForm);

router.use(protect);
router.get("/available/:entityType", getAvailableForms);
router.get("/run/:id", getRunnableForm);
router.get("/", authorize("admin"), listForms);
router.get("/submissions", listFormSubmissions);
router.get("/:id", authorize("admin"), getForm);
router.post("/", authorize("admin"), createForm);
router.patch("/:id", authorize("admin"), updateForm);
router.patch("/:id/status", authorize("admin"), setFormStatus);
router.post("/:id/submit", authorize("admin", "sales", "staff", "coach", "doctor"), submitInternalForm);

export default router;
