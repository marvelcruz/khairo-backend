import express from "express";
import {
  createCustomFieldDefinition,
  getEntityCustomFields,
  listCustomFieldDefinitions,
  reorderCustomFieldDefinitions,
  updateCustomFieldDefinition,
  updateEntityCustomFields,
} from "../controllers/customFieldController.js";
import { authorize, protect } from "../middleware/auth.js";
import { requireClientRecordAccess } from "../middleware/clientRecordAccess.js";

const router = express.Router();

function clientEntityAccess(req, res, next) {
  if (req.params.entityType === "client") {
    req.params.clientId = req.params.entityId;
    return requireClientRecordAccess(req, res, next);
  }
  next();
}

router.use(protect);

router.get("/definitions", listCustomFieldDefinitions);
router.post("/definitions", authorize("admin"), createCustomFieldDefinition);
router.patch("/definitions/reorder", authorize("admin"), reorderCustomFieldDefinitions);
router.patch("/definitions/:id", authorize("admin"), updateCustomFieldDefinition);
router.get(
  "/records/:entityType/:entityId",
  authorize("admin", "sales", "staff", "coach"),
  clientEntityAccess,
  getEntityCustomFields
);
router.put(
  "/records/:entityType/:entityId",
  authorize("admin", "sales", "staff", "coach"),
  clientEntityAccess,
  updateEntityCustomFields
);

export default router;
