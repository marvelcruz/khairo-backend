import express from "express";
import {
  listNewsletters,
  getNewsletter,
  createNewsletter,
  updateNewsletter,
  deleteNewsletter,
  getPublicNewsletters,
  getClientNewsletters,
} from "../controllers/newsletterController.js";
import { protect, authorize } from "../middleware/auth.js";
import { protectClient } from "../middleware/clientAuth.js";

const router = express.Router();

// Public website
router.get("/public", getPublicNewsletters);

// Client portal
router.get("/client", protectClient, getClientNewsletters);

// Admin CRUD
router.use(protect);
router.use(authorize("admin"));

router.get("/", listNewsletters);
router.get("/:id", getNewsletter);
router.post("/", createNewsletter);
router.patch("/:id", updateNewsletter);
router.delete("/:id", deleteNewsletter);

export default router;
