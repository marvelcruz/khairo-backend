import express from "express";
import {
  archiveCatalogueItem,
  createCatalogueItem,
  getCatalogueItem,
  getPublicCatalogue,
  getPublicCatalogueItem,
  listCatalogueItems,
  restoreCatalogueItem,
  updateCatalogueItem,
} from "../controllers/catalogueController.js";
import { authorize, protect } from "../middleware/auth.js";

const router = express.Router();

// Public catalogue reads. Only active + explicitly public items are returned.
router.get("/public", getPublicCatalogue);
router.get("/public/:slug", getPublicCatalogueItem);

// Internal catalogue administration.
router.use(protect);
router.use(authorize("admin", "staff", "coach", "doctor", "sales"));
router.get("/", listCatalogueItems);
router.get("/:id", getCatalogueItem);
router.post("/", authorize("admin"), createCatalogueItem);
router.patch("/:id", authorize("admin"), updateCatalogueItem);
router.delete("/:id", authorize("admin"), archiveCatalogueItem);
router.patch("/:id/restore", authorize("admin"), restoreCatalogueItem);

export default router;
