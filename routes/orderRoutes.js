import express from "express";
import { filterByPermissions } from "../controllers/clientController.js";
import { listOrders, getClientOrder, getOrderById, toggleStage, updateOrder } from "../controllers/orderController.js";
import { protect, authorize, requireAnyPermission } from "../middleware/auth.js";

const router = express.Router();

router.use(protect);
router.use(filterByPermissions);
router.use(authorize("admin", "coach", "staff"));
router.use(requireAnyPermission("view_orders", "view_clients"));

router.get("/", listOrders);
router.get("/client/:clientId", getClientOrder);
router.get("/:id", getOrderById);
router.patch("/:id/stage", toggleStage);
router.patch("/:id", updateOrder);

export default router;
