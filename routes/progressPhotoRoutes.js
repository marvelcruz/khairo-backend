import express from "express";
import multer from "multer";
import { protectClient } from "../middleware/clientAuth.js";
import {
  listProgressPhotos,
  uploadProgressPhoto,
  getProgressPhoto,
  deleteProgressPhoto,
} from "../controllers/progressPhotoController.js";

const router = express.Router();

const upload = multer({
  storage:
    multer.memoryStorage(),

  limits: {
    fileSize:
      12 * 1024 * 1024,
  },
});

router.use(protectClient);

router.get(
  "/",
  listProgressPhotos
);

router.post(
  "/",
  upload.single("photo"),
  uploadProgressPhoto
);

router.get(
  "/:id/image",
  getProgressPhoto
);

router.delete(
  "/:id",
  deleteProgressPhoto
);

export default router;
