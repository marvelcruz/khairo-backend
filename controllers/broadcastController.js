import Client from "../models/Client.js";
import CrmContact from "../models/CrmContact.js";
import CrmTag from "../models/CrmTag.js";
import MessageTemplate from "../models/MessageTemplate.js";
import BroadcastLog from "../models/BroadcastLog.js";
import { validateCrmTagKeys } from "../services/crmTagService.js";
import { logAudit } from "../utils/auditLogger.js";

function parseTagTokens(value) {
  const source = Array.isArray(value) ? value : [value];
  return [...new Set(
    source
      .flatMap((item) => String(item || "").split(","))
      .map((item) => item.trim())
      .filter(Boolean)
  )];
}

async function resolveBroadcastTagFilters(query = {}) {
  const anyTokens = parseTagTokens(query.includeTagsAny);
  const allTokens = parseTagTokens(query.includeTagsAll);
  const excludeTokens = parseTagTokens(query.excludeTags);

  if (anyTokens.length > 12 || allTokens.length > 12 || excludeTokens.length > 12) {
    const error = new Error("Use no more than 12 tags in each broadcast tag filter.");
    error.statusCode = 400;
    throw error;
  }

  const [includeTagsAny, includeTagsAll, excludeTags] = await Promise.all([
    validateCrmTagKeys(anyTokens, { activeOnly: false }),
    validateCrmTagKeys(allTokens, { activeOnly: false }),
    validateCrmTagKeys(excludeTokens, { activeOnly: false }),
  ]);

  return { includeTagsAny, includeTagsAll, excludeTags };
}

async function resolveConsentedBroadcastRecipients(recipients = []) {
  if (!Array.isArray(recipients) || recipients.length === 0) {
    const error = new Error("No recipients provided.");
    error.statusCode = 400;
    throw error;
  }

  if (recipients.length > 200) {
    const error = new Error("Broadcast sending is limited to 200 recipients at a time.");
    error.statusCode = 400;
    throw error;
  }

  const clientIds = [...new Set(
    recipients
      .map((recipient) => String(recipient?.clientId || "").trim())
      .filter(Boolean)
  )];

  if (clientIds.length !== recipients.length) {
    const error = new Error(
      "Recipient verification requires a current KhairoDietClinic client ID for every selected recipient. Refresh the Broadcast Builder audience before sending."
    );
    error.statusCode = 400;
    throw error;
  }

  const clients = await Client.find({
    _id: { $in: clientIds },
    isArchived: false,
  })
    .select("fullName phone email")
    .lean();

  if (clients.length !== clientIds.length) {
    const error = new Error(
      "One or more selected recipients could not be verified as current KhairoDietClinic clients. Refresh the Broadcast Builder audience before sending."
    );
    error.statusCode = 409;
    throw error;
  }

  const contacts = await CrmContact.find({
    isArchived: false,
    client: { $in: clientIds },
  })
    .select("client whatsappMarketingConsent updatedAt")
    .sort({ updatedAt: -1 })
    .lean();

  const contactByClient = new Map();
  for (const contact of contacts) {
    const key = String(contact.client || "");
    if (key && !contactByClient.has(key)) contactByClient.set(key, contact);
  }

  const verified = clients.map((client) => {
    const contact = contactByClient.get(String(client._id));
    const status = contact?.whatsappMarketingConsent?.status || "unknown";
    const hasPhone = Boolean(String(client.phone || "").replace(/\D/g, ""));

    return {
      clientId: client._id,
      name: client.fullName,
      phone: client.phone,
      consentStatus: status,
      eligible: status === "opted_in" && hasPhone,
    };
  });

  return {
    eligible: verified.filter((recipient) => recipient.eligible),
    blocked: verified.filter((recipient) => !recipient.eligible),
  };
}

export const getSegments = async (req, res, next) => {
  try {
    const [unpaid, active, neverActivated, lapsed, tags] = await Promise.all([
      Client.countDocuments({
        isArchived: false,
        reconciled: false,
      }),
      Client.countDocuments({
        isArchived: false,
        reconciled: true,
        status: "active",
      }),
      Client.countDocuments({
        isArchived: false,
        reconciled: true,
        portalActive: false,
      }),
      Client.countDocuments({
        isArchived: false,
        reconciled: true,
        status: { $in: ["lapsed", "expired", "dropped"] },
      }),
      CrmTag.find({ active: true })
        .select("key name category")
        .sort({ category: 1, name: 1 })
        .lean(),
    ]);

    res.json({
      success: true,
      segments: [
        { key: "unpaid", name: "Enrollment Pending / Prospects", count: unpaid },
        { key: "active", name: "Active Members", count: active },
        { key: "never_activated", name: "Never Activated Portal", count: neverActivated },
        { key: "lapsed", name: "Lapsed / Dropped", count: lapsed },
      ],
      tags,
    });
  } catch (err) { next(err); }
};

export const previewSegment = async (req, res, next) => {
  try {
    const { segment } = req.query;
    const query = { isArchived: false };
    if (segment === "unpaid") {
      query.reconciled = false;
    } else if (segment === "active") {
      query.reconciled = true;
      query.status = "active";
    } else if (segment === "never_activated") {
      query.reconciled = true;
      query.portalActive = false;
    } else if (segment === "lapsed") {
      query.reconciled = true;
      query.status = { $in: ["lapsed", "expired", "dropped"] };
    }
    else return res.status(400).json({ success: false, message: "Invalid segment" });

    const filters = await resolveBroadcastTagFilters(req.query);
    const hasTagFilters =
      filters.includeTagsAny.length > 0 ||
      filters.includeTagsAll.length > 0 ||
      filters.excludeTags.length > 0;

    if (hasTagFilters) {
      const tagCriteria = {};
      if (filters.includeTagsAny.length) tagCriteria.$in = filters.includeTagsAny;
      if (filters.includeTagsAll.length) tagCriteria.$all = filters.includeTagsAll;
      if (filters.excludeTags.length) tagCriteria.$nin = filters.excludeTags;

      const linkedClientIds = await CrmContact.distinct("client", {
        isArchived: false,
        client: { $ne: null },
        tags: tagCriteria,
      });

      query._id = { $in: linkedClientIds };
    }

    const clients = await Client.find(query)
      .select("fullName phone email")
      .limit(200)
      .lean();

    const contacts = clients.length
      ? await CrmContact.find({
          isArchived: false,
          client: { $in: clients.map((client) => client._id) },
        })
          .select("client whatsappMarketingConsent updatedAt")
          .sort({ updatedAt: -1 })
          .lean()
      : [];

    const contactByClient = new Map();
    for (const contact of contacts) {
      const key = String(contact.client || "");
      if (key && !contactByClient.has(key)) contactByClient.set(key, contact);
    }

    const audience = clients.map((client) => {
      const contact = contactByClient.get(String(client._id));
      const status = contact?.whatsappMarketingConsent?.status || "unknown";

      return {
        ...client,
        crmContactId: contact?._id || null,
        whatsappMarketingConsent: {
          status,
          updatedAt: contact?.whatsappMarketingConsent?.updatedAt || null,
          source: contact?.whatsappMarketingConsent?.source || "",
        },
        whatsappConsentEligible: Boolean(client.phone && status === "opted_in"),
      };
    });

    const consentSummary = audience.reduce(
      (summary, client) => {
        const status = client.whatsappMarketingConsent.status;
        if (status === "opted_in") summary.optedIn += 1;
        else if (status === "opted_out") summary.optedOut += 1;
        else summary.unknown += 1;
        if (client.whatsappConsentEligible) summary.consentEligible += 1;
        return summary;
      },
      { optedIn: 0, optedOut: 0, unknown: 0, consentEligible: 0 }
    );

    res.json({
      success: true,
      clients: audience,
      filters,
      consentSummary,
    });
  } catch (err) {
    if (err?.statusCode === 400 || /approved tag library/i.test(err?.message || "")) {
      return res.status(400).json({ success: false, message: err.message });
    }
    next(err);
  }
};


// GET /api/broadcast/templates
export const getTemplates = async (req, res, next) => {
  try {
    const templates = await MessageTemplate.find().sort({ createdAt: -1 }).limit(20);
    res.json({ success: true, templates });
  } catch (err) { next(err); }
};

// POST /api/broadcast/templates
export const createTemplate = async (req, res, next) => {
  try {
    const { name, body } = req.body;
    if (!name || !body) return res.status(400).json({ success: false, message: "Name and body required" });
    const template = await MessageTemplate.create({ name, body, createdBy: req.user._id });
    res.status(201).json({ success: true, template });
  } catch (err) { next(err); }
};

// POST /api/broadcast/log
export const logBroadcast = async (req, res, next) => {
  try {
    const { segment, message, recipients } = req.body;
    await BroadcastLog.create({ sentBy: req.user._id, segment, message, recipientCount: recipients.length, recipients });
    await logAudit(req, "Sent broadcast", "BroadcastLog", null, `${recipients.length} recipients in ${segment}`);
    res.status(201).json({ success: true });
  } catch (err) { next(err); }
};

// GET /api/broadcast/history
export const getBroadcastHistory = async (req, res, next) => {
  try {
    const logs = await BroadcastLog.find().populate("sentBy", "name").sort({ createdAt: -1 }).limit(20);
    res.json({ success: true, logs });
  } catch (err) { next(err); }
};


// POST /api/broadcast/send-wa
// Legacy free-form broadcast sending is intentionally disabled. Business-initiated
// WhatsApp Platform messages must use approved templates. This endpoint first
// re-resolves selected client IDs server-side and enforces explicit consent so
// browser-supplied names/phone numbers can never determine message recipients.
export const sendViaWhatsAppApi = async (req, res, next) => {
  try {
    const { recipients } = req.body;
    const resolved = await resolveConsentedBroadcastRecipients(recipients);

    if (resolved.blocked.length > 0) {
      const blockedSummary = resolved.blocked.reduce(
        (summary, recipient) => {
          if (recipient.consentStatus === "opted_out") summary.optedOut += 1;
          else if (recipient.consentStatus === "opted_in") summary.missingPhone += 1;
          else summary.unknown += 1;
          return summary;
        },
        { optedOut: 0, unknown: 0, missingPhone: 0 }
      );

      await logAudit(
        req,
        "Blocked WhatsApp broadcast",
        "BroadcastLog",
        null,
        `${resolved.blocked.length} recipient(s) failed consent/phone verification`
      );

      return res.status(409).json({
        success: false,
        code: "whatsapp_consent_required",
        message: "WhatsApp broadcast blocked. Every recipient must have explicit recorded opt-in consent and a valid phone number.",
        eligibleCount: resolved.eligible.length,
        blockedCount: resolved.blocked.length,
        blockedSummary,
      });
    }

    await logAudit(
      req,
      "Blocked legacy free-form WhatsApp broadcast",
      "BroadcastLog",
      null,
      `${resolved.eligible.length} consent-eligible recipient(s); approved template required`
    );

    return res.status(409).json({
      success: false,
      code: "whatsapp_template_required",
      message: "Business-initiated WhatsApp broadcasts must use an approved WhatsApp message template. Free-form API broadcasts are disabled.",
      eligibleCount: resolved.eligible.length,
      blockedCount: 0,
    });
  } catch (err) {
    if (err?.statusCode === 400 || err?.statusCode === 409) {
      return res.status(err.statusCode).json({ success: false, message: err.message });
    }
    next(err);
  }
};
