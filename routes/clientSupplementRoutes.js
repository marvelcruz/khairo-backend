import express from "express";
import { mySupplements, addMySupplement, removeMySupplement, listAvailable } from "../controllers/supplementController.js";
import { protectClient } from "../middleware/clientAuth.js";

const router = express.Router();
router.use(protectClient);

router.get("/available", listAvailable);
router.get("/", mySupplements);
router.post("/", addMySupplement);
router.delete("/:itemId", removeMySupplement);

export default router;
