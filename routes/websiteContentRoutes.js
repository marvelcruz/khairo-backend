import express from "express";
import {
  archiveMedia,
  createContentItem,
  createMedia,
  deleteContentItem,
  getContentItem,
  getVersions,
  listContent,
  listMedia,
  publishContentItem,
  publishPage,
  restoreVersion,
  seedDefaultContent,
  updateContentItem,
  updateMedia,
} from "../controllers/websiteContentController.js";
import { protect, authorize } from "../middleware/auth.js";

const router = express.Router();

router.use(protect);
router.use(authorize("admin"));

router.post("/seed-defaults", seedDefaultContent);

router.get("/", listContent);
router.post("/", createContentItem);

router.get("/media", listMedia);
router.post("/media", createMedia);
router.patch("/media/:id", updateMedia);
router.delete("/media/:id", archiveMedia);

router.post("/publish/page/:pageKey", publishPage);

router.get("/:id/versions", getVersions);
router.post("/:id/versions/:versionId/restore", restoreVersion);
router.get("/:id", getContentItem);
router.patch("/:id", updateContentItem);
router.post("/:id/publish", publishContentItem);
router.delete("/:id", deleteContentItem);

export default router;
