import express from "express";
import {
  createProject,
  createTask,
  listProjectsTasks,
  updateProject,
  updateTask,
} from "../controllers/projectTaskController.js";
import { authorize, protect } from "../middleware/auth.js";
import sopRoutes from "./sopRoutes.js";

const router = express.Router();

router.use("/sops", sopRoutes);
router.use(protect);

router.get("/", authorize("admin"), listProjectsTasks);
router.post("/projects", authorize("admin"), createProject);
router.patch("/projects/:id", authorize("admin"), updateProject);
router.post("/tasks", authorize("admin"), createTask);
router.patch("/tasks/:id", authorize("admin"), updateTask);

export default router;
