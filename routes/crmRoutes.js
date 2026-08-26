import express from "express";
import multer from "multer";

import {
  addCrmContactActivity,
  archiveCrmContact,
  completeCrmActivity,
  convertCrmContactToApplication,
  createCrmContact,
  getCrmAssignees,
  getCrmContactById,
  getCrmContacts,
  getCrmOverview,
  mergeCrmContacts,
  updateCrmContact,
  updateCrmOpportunity,
} from "../controllers/crmController.js";

import {
  updateCrmWhatsAppMarketingConsent,
} from "../controllers/crmConsentController.js";

import {
  recordQualificationDecision,
} from "../controllers/crmQualificationController.js";

import {
  bookCrmConsultation,
  cancelCrmConsultation,
  recordCrmConsultationOutcome,
} from "../controllers/crmConsultationController.js";

import {
  getPaymentPendingQueue,
} from "../controllers/crmPaymentPendingController.js";

import {
  bulkApplyCrmTags,
  createCrmTag,
  listCrmTags,
  updateCrmTag,
} from "../controllers/crmTagController.js";

import {
  commitCrmImport,
  downloadCrmImportTemplate,
  exportCrmContacts,
  previewCrmImport,
} from "../controllers/crmDataController.js";

import {
  filterByPermissions,
} from "../controllers/clientController.js";

import {
  authorize,
  protect,
  requirePermission,
} from "../middleware/auth.js";


const router = express.Router();

const importUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize:
      8 * 1024 * 1024,
  },
});


router.use(protect);
router.use(
  requirePermission("view_crm")
);
router.use(
  authorize(
    "admin",
    "sales",
    "staff",
    "coach"
  )
);
router.use(filterByPermissions);


/* CRM overview */

router.get(
  "/overview",
  getCrmOverview
);

router.get(
  "/assignees",
  getCrmAssignees
);

router.get(
  "/payment-pending",
  getPaymentPendingQueue
);


/* Controlled tags */

router.get(
  "/tags",
  listCrmTags
);

router.post(
  "/tags",
  authorize("admin"),
  createCrmTag
);

router.patch(
  "/tags/:id",
  authorize("admin"),
  updateCrmTag
);

router.post(
  "/tags/bulk",
  authorize(
    "admin",
    "sales"
  ),
  bulkApplyCrmTags
);


/* Import / export */

router.get(
  "/contacts/export",
  authorize(
    "admin",
    "sales"
  ),
  exportCrmContacts
);

router.get(
  "/contacts/import/template",
  authorize(
    "admin",
    "sales"
  ),
  downloadCrmImportTemplate
);

router.post(
  "/contacts/import/preview",
  authorize(
    "admin",
    "sales"
  ),
  importUpload.single("file"),
  previewCrmImport
);

router.post(
  "/contacts/import/commit",
  authorize(
    "admin",
    "sales"
  ),
  importUpload.single("file"),
  commitCrmImport
);


/* Contacts */

router.get(
  "/contacts",
  getCrmContacts
);

router.get(
  "/contacts/:id",
  getCrmContactById
);

router.post(
  "/contacts",
  authorize(
    "admin",
    "sales"
  ),
  createCrmContact
);

router.patch(
  "/contacts/:id",
  authorize(
    "admin",
    "sales"
  ),
  updateCrmContact
);

router.patch(
  "/contacts/:id/whatsapp-marketing-consent",
  authorize(
    "admin",
    "sales"
  ),
  updateCrmWhatsAppMarketingConsent
);

router.post(
  "/contacts/:id/activities",
  addCrmContactActivity
);

router.post(
  "/contacts/:id/qualification-decision",
  authorize(
    "admin",
    "sales"
  ),
  recordQualificationDecision
);

router.post(
  "/contacts/:id/consultation",
  authorize(
    "admin",
    "sales",
    "staff",
    "coach"
  ),
  bookCrmConsultation
);

router.post(
  "/contacts/:id/consultation-cancel",
  authorize(
    "admin",
    "sales",
    "staff",
    "coach"
  ),
  cancelCrmConsultation
);

router.post(
  "/contacts/:id/consultation-outcome",
  authorize(
    "admin",
    "sales",
    "coach"
  ),
  recordCrmConsultationOutcome
);

router.post(
  "/contacts/:id/merge",
  authorize(
    "admin",
    "sales"
  ),
  mergeCrmContacts
);

router.post(
  "/contacts/:id/to-application",
  authorize(
    "admin",
    "sales"
  ),
  convertCrmContactToApplication
);

router.delete(
  "/contacts/:id",
  authorize(
    "admin",
    "sales"
  ),
  archiveCrmContact
);


/* Opportunities / activities */

router.patch(
  "/opportunities/:id",
  authorize(
    "admin",
    "sales"
  ),
  updateCrmOpportunity
);

router.patch(
  "/activities/:id/complete",
  completeCrmActivity
);


export default router;
