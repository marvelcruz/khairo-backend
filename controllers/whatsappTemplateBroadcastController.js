import mongoose from "mongoose";
import Client from "../models/Client.js";
import CrmContact from "../models/CrmContact.js";
import BroadcastLog from "../models/BroadcastLog.js";
import { logAudit } from "../utils/auditLogger.js";

const DEFAULT_GRAPH_VERSION = "v25.0";
const MAX_RECIPIENTS = 200;
const MAX_BODY_PARAMETERS = 10;

function graphVersion() {
  const raw = String(process.env.WHATSAPP_GRAPH_API_VERSION || DEFAULT_GRAPH_VERSION).trim();
  return raw.startsWith("v") ? raw : `v${raw}`;
}

function whatsappConfig({ requireBusinessAccount = false } = {}) {
  const token = String(process.env.WHATSAPP_TOKEN || "").trim();
  const phoneId = String(process.env.WHATSAPP_PHONE_NUMBER_ID || "").trim();
  const businessAccountId = String(process.env.WHATSAPP_BUSINESS_ACCOUNT_ID || "").trim();

  if (!token || !phoneId || (requireBusinessAccount && !businessAccountId)) {
    const missing = [];
    if (!token) missing.push("WHATSAPP_TOKEN");
    if (!phoneId) missing.push("WHATSAPP_PHONE_NUMBER_ID");
    if (requireBusinessAccount && !businessAccountId) missing.push("WHATSAPP_BUSINESS_ACCOUNT_ID");

    const error = new Error(`WhatsApp template messaging is not configured. Missing: ${missing.join(", ")}.`);
    error.statusCode = 503;
    throw error;
  }

  return { token, phoneId, businessAccountId, version: graphVersion() };
}

function bodyParameterCount(template) {
  const body = Array.isArray(template?.components)
    ? template.components.find((component) => String(component?.type || "").toUpperCase() === "BODY")
    : null;
  const text = String(body?.text || "");
  const indexes = [...text.matchAll(/\{\{(\d+)\}\}/g)].map((match) => Number(match[1]));
  return indexes.length ? Math.max(...indexes) : 0;
}

function publicTemplate(template) {
  const body = Array.isArray(template?.components)
    ? template.components.find((component) => String(component?.type || "").toUpperCase() === "BODY")
    : null;

  return {
    id: template?.id || null,
    name: template?.name || "",
    language: template?.language || "",
    category: template?.category || "",
    status: template?.status || "",
    bodyText: body?.text || "",
    bodyParameterCount: bodyParameterCount(template),
  };
}

async function fetchApprovedTemplates() {
  const { token, businessAccountId, version } = whatsappConfig({ requireBusinessAccount: true });
  const params = new URLSearchParams({
    fields: "id,name,status,category,language,components",
    limit: "100",
  });

  const response = await fetch(
    `https://graph.facebook.com/${version}/${businessAccountId}/message_templates?${params.toString()}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data?.error?.message || "Meta did not return the WhatsApp template catalogue.";
    const error = new Error(message);
    error.statusCode = 502;
    throw error;
  }

  return (Array.isArray(data?.data) ? data.data : []).filter(
    (template) => String(template?.status || "").toUpperCase() === "APPROVED"
  );
}

function validateRecipientIds(recipients) {
  if (!Array.isArray(recipients) || recipients.length === 0) {
    const error = new Error("No recipients provided.");
    error.statusCode = 400;
    throw error;
  }
  if (recipients.length > MAX_RECIPIENTS) {
    const error = new Error(`WhatsApp template sending is limited to ${MAX_RECIPIENTS} recipients at a time.`);
    error.statusCode = 400;
    throw error;
  }

  const ids = recipients.map((recipient) => String(recipient?.clientId || "").trim());
  if (ids.some((id) => !mongoose.Types.ObjectId.isValid(id))) {
    const error = new Error("Every WhatsApp template recipient must include a valid KhairoDietClinic client ID.");
    error.statusCode = 400;
    throw error;
  }

  const unique = [...new Set(ids)];
  if (unique.length !== recipients.length) {
    const error = new Error("Duplicate or missing recipient client IDs were detected. Refresh the Broadcast Builder audience.");
    error.statusCode = 400;
    throw error;
  }

  return unique;
}

async function resolveConsentedRecipients(recipients) {
  const clientIds = validateRecipientIds(recipients);
  const clients = await Client.find({ _id: { $in: clientIds }, isArchived: false })
    .select("fullName phone email")
    .lean();

  if (clients.length !== clientIds.length) {
    const error = new Error("One or more recipients could not be verified as current KhairoDietClinic clients.");
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

  const clientById = new Map(clients.map((client) => [String(client._id), client]));
  const verified = clientIds.map((id) => {
    const client = clientById.get(id);
    const contact = contactByClient.get(id);
    const consentStatus = contact?.whatsappMarketingConsent?.status || "unknown";
    const phone = String(client?.phone || "").replace(/\D/g, "");
    return {
      clientId: client?._id,
      name: client?.fullName || "",
      phone,
      consentStatus,
      eligible: consentStatus === "opted_in" && Boolean(phone),
    };
  });

  const blocked = verified.filter((recipient) => !recipient.eligible);
  if (blocked.length) {
    const summary = blocked.reduce(
      (result, recipient) => {
        if (recipient.consentStatus === "opted_out") result.optedOut += 1;
        else if (recipient.consentStatus === "opted_in") result.missingPhone += 1;
        else result.unknown += 1;
        return result;
      },
      { optedOut: 0, unknown: 0, missingPhone: 0 }
    );

    const error = new Error("WhatsApp template send blocked. Every recipient must have explicit recorded opt-in consent and a valid phone number.");
    error.statusCode = 409;
    error.code = "whatsapp_consent_required";
    error.details = { blockedCount: blocked.length, blockedSummary: summary };
    throw error;
  }

  return verified;
}

function normalizeBodyParameters(value) {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > MAX_BODY_PARAMETERS) {
    const error = new Error(`Provide no more than ${MAX_BODY_PARAMETERS} WhatsApp template body parameters.`);
    error.statusCode = 400;
    throw error;
  }

  return value.map((item) => {
    const text = String(item ?? "").trim();
    if (!text || text.length > 1024) {
      const error = new Error("Each WhatsApp template body parameter must contain 1-1024 characters.");
      error.statusCode = 400;
      throw error;
    }
    return text;
  });
}

function renderParameter(value, recipient) {
  const first = String(recipient.name || "").trim().split(/\s+/)[0] || "there";
  return value.replace(/\{first\}/g, first);
}

export const getApprovedWhatsAppTemplates = async (req, res, next) => {
  try {
    const templates = await fetchApprovedTemplates();
    res.json({ success: true, templates: templates.map(publicTemplate) });
  } catch (error) {
    if (error?.statusCode) {
      return res.status(error.statusCode).json({ success: false, message: error.message });
    }
    next(error);
  }
};

export const sendApprovedWhatsAppTemplate = async (req, res, next) => {
  try {
    const templateName = String(req.body?.templateName || "").trim();
    const languageCode = String(req.body?.languageCode || "").trim();
    const segment = String(req.body?.segment || "custom").trim().slice(0, 120) || "custom";
    const bodyParameters = normalizeBodyParameters(req.body?.bodyParameters);

    if (!/^[a-z0-9_]{1,512}$/.test(templateName)) {
      return res.status(400).json({ success: false, message: "Choose a valid approved WhatsApp template." });
    }
    if (!/^[a-z]{2,3}(?:_[A-Z]{2})?$/.test(languageCode)) {
      return res.status(400).json({ success: false, message: "Choose a valid WhatsApp template language." });
    }

    const recipients = await resolveConsentedRecipients(req.body?.recipients);
    const approvedTemplates = await fetchApprovedTemplates();
    const approvedTemplate = approvedTemplates.find(
      (template) => template.name === templateName && template.language === languageCode
    );

    if (!approvedTemplate) {
      return res.status(409).json({
        success: false,
        code: "whatsapp_template_not_approved",
        message: "This WhatsApp template/language is not currently approved in Meta.",
      });
    }

    const expectedParameters = bodyParameterCount(approvedTemplate);
    if (bodyParameters.length !== expectedParameters) {
      return res.status(400).json({
        success: false,
        message: `This approved template requires ${expectedParameters} body parameter${expectedParameters === 1 ? "" : "s"}.`,
        expectedBodyParameters: expectedParameters,
      });
    }

    const { token, phoneId, version } = whatsappConfig();
    const successfulRecipients = [];
    const failures = [];

    for (const recipient of recipients) {
      const parameters = bodyParameters.map((value) => ({
        type: "text",
        text: renderParameter(value, recipient),
      }));

      const template = {
        name: templateName,
        language: { code: languageCode },
        ...(parameters.length
          ? { components: [{ type: "body", parameters }] }
          : {}),
      };

      try {
        const response = await fetch(
          `https://graph.facebook.com/${version}/${phoneId}/messages`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              messaging_product: "whatsapp",
              to: recipient.phone,
              type: "template",
              template,
            }),
          }
        );

        const data = await response.json().catch(() => ({}));
        if (response.ok) {
          successfulRecipients.push(recipient);
        } else {
          failures.push({
            clientId: recipient.clientId,
            name: recipient.name,
            code: data?.error?.code || null,
            message: data?.error?.message || "Meta rejected the template message.",
          });
        }
      } catch (error) {
        failures.push({
          clientId: recipient.clientId,
          name: recipient.name,
          code: null,
          message: error?.message || "WhatsApp request failed.",
        });
      }
    }

    if (successfulRecipients.length) {
      await BroadcastLog.create({
        sentBy: req.user._id,
        segment,
        message: `[WhatsApp template: ${templateName} · ${languageCode}]`,
        recipientCount: successfulRecipients.length,
        recipients: successfulRecipients.map((recipient) => ({
          clientId: recipient.clientId,
          name: recipient.name,
          phone: recipient.phone,
        })),
      });
    }

    await logAudit(
      req,
      "Sent approved WhatsApp template broadcast",
      "BroadcastLog",
      "",
      `${templateName}/${languageCode}: ${successfulRecipients.length} sent, ${failures.length} failed`
    );

    res.status(failures.length ? 207 : 200).json({
      success: failures.length === 0,
      templateName,
      languageCode,
      sent: successfulRecipients.length,
      failed: failures.length,
      failures: failures.slice(0, 20),
    });
  } catch (error) {
    if (error?.statusCode) {
      return res.status(error.statusCode).json({
        success: false,
        code: error.code,
        message: error.message,
        ...(error.details || {}),
      });
    }
    next(error);
  }
};
