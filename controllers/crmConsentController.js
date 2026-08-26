import CrmContact, {
  CRM_WHATSAPP_MARKETING_CONSENT_VALUES,
} from "../models/CrmContact.js";
import { logAudit } from "../utils/auditLogger.js";

const asString = (value = "") => String(value ?? "").trim();

export const updateCrmWhatsAppMarketingConsent = async (req, res, next) => {
  try {
    const contact = await CrmContact.findOne({
      _id: req.params.id,
      isArchived: false,
    });

    if (!contact) {
      return res.status(404).json({
        success: false,
        message: "CRM contact not found.",
      });
    }

    const status = asString(req.body?.status).toLowerCase();
    const source = asString(req.body?.source);
    const note = asString(req.body?.note);

    if (!CRM_WHATSAPP_MARKETING_CONSENT_VALUES.includes(status)) {
      return res.status(400).json({
        success: false,
        message: "Choose unknown, opted_in, or opted_out for WhatsApp marketing consent.",
      });
    }

    if (source.length > 160) {
      return res.status(400).json({
        success: false,
        message: "Consent source must be 160 characters or fewer.",
      });
    }

    if (note.length > 500) {
      return res.status(400).json({
        success: false,
        message: "Consent note must be 500 characters or fewer.",
      });
    }

    if (status !== "unknown" && !source) {
      return res.status(400).json({
        success: false,
        message: "Record how WhatsApp consent or opt-out was obtained.",
      });
    }

    if (status === "opted_in" && !asString(contact.phone)) {
      return res.status(409).json({
        success: false,
        message: "Add a phone number before recording WhatsApp marketing opt-in.",
      });
    }

    const previousStatus =
      contact.whatsappMarketingConsent?.status || "unknown";

    contact.whatsappMarketingConsent = {
      status,
      updatedAt: new Date(),
      source: status === "unknown" ? "" : source,
      note: status === "unknown" ? "" : note,
      updatedBy: req.user._id,
    };
    contact.updatedBy = req.user._id;
    await contact.save();

    await logAudit(
      req,
      "Updated WhatsApp marketing consent",
      "CrmContact",
      contact._id.toString(),
      `${previousStatus} → ${status}${source ? ` via ${source}` : ""}`
    );

    res.status(200).json({
      success: true,
      whatsappMarketingConsent: contact.whatsappMarketingConsent,
    });
  } catch (err) {
    next(err);
  }
};
