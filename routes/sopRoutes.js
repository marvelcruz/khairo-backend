import express from "express";
import {
  archiveSop,
  createSop,
  getProcessMap,
  listSops,
  updateSop,
} from "../controllers/sopController.js";
import { authorize, protect } from "../middleware/auth.js";

const router = express.Router();

router.use(protect);
router.use(authorize("admin"));

router.get("/process-map", getProcessMap);
router.get("/", listSops);
router.post("/", createSop);
router.patch("/:id", updateSop);
router.delete("/:id", archiveSop);

export default router;
