import crypto from "crypto";
import CrmActivity from "../models/CrmActivity.js";
import CrmContact from "../models/CrmContact.js";
import InboundMessageReceipt from "../models/InboundMessageReceipt.js";
import {
  addCrmActivity,
  ensureOpenOpportunity,
  upsertCrmLead,
} from "../services/crmService.js";
import { dispatchWorkflowEvent } from "../services/workflowService.js";
import { normalizeCrmSource } from "../utils/crmSourceTaxonomy.js";

const PROVIDER_LABELS = {
  instagram: "Instagram",
  whatsapp: "WhatsApp",
};

function verifyToken() {
  return String(process.env.META_WEBHOOK_VERIFY_TOKEN || "").trim();
}

function appSecret() {
  return String(process.env.META_APP_SECRET || "").trim();
}

function verifyMetaSignature(req) {
  const secret = appSecret();
  if (!secret || !Buffer.isBuffer(req.rawBody)) return false;

  const provided = String(req.get("x-hub-signature-256") || "").trim();
  if (!provided.startsWith("sha256=")) return false;

  const expected = `sha256=${crypto
    .createHmac("sha256", secret)
    .update(req.rawBody)
    .digest("hex")}`;

  const providedBuffer = Buffer.from(provided, "utf8");
  const expectedBuffer = Buffer.from(expected, "utf8");
  return (
    providedBuffer.length === expectedBuffer.length &&
    crypto.timingSafeEqual(providedBuffer, expectedBuffer)
  );
}

function receivedDate(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return new Date();
  const milliseconds = number < 100000000000 ? number * 1000 : number;
  const date = new Date(milliseconds);
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

function cleanText(value, fallback) {
  const text = String(value || "").trim();
  return (text || fallback).slice(0, 5000);
}

function whatsappMessageText(message) {
  if (message?.text?.body) return cleanText(message.text.body, "[WhatsApp message]");
  if (message?.button?.text) return cleanText(message.button.text, "[WhatsApp button response]");
  if (message?.interactive?.button_reply?.title) {
    return cleanText(message.interactive.button_reply.title, "[WhatsApp button response]");
  }
  if (message?.interactive?.list_reply?.title) {
    return cleanText(message.interactive.list_reply.title, "[WhatsApp list response]");
  }
  if (message?.type === "location") return "[WhatsApp location message]";
  if (message?.type === "image") return "[WhatsApp image message]";
  if (message?.type === "video") return "[WhatsApp video message]";
  if (message?.type === "audio") return "[WhatsApp audio message]";
  if (message?.type === "document") return "[WhatsApp document message]";
  if (message?.type === "contacts") return "[WhatsApp contact message]";
  return `[WhatsApp ${String(message?.type || "message")} message]`;
}

function instagramMessageText(message) {
  if (message?.text) return cleanText(message.text, "[Instagram DM]");
  if (Array.isArray(message?.attachments) && message.attachments.length) {
    const type = String(message.attachments[0]?.type || "attachment").replace(/_/g, " ");
    return `[Instagram ${type}]`.slice(0, 5000);
  }
  return "[Instagram DM]";
}

function extractWhatsAppMessages(payload) {
  if (payload?.object !== "whatsapp_business_account") return [];
  const messages = [];

  for (const entry of payload.entry || []) {
    for (const change of entry.changes || []) {
      if (change?.field !== "messages") continue;
      const value = change?.value || {};
      const contacts = new Map(
        (value.contacts || []).map((contact) => [
          String(contact?.wa_id || ""),
          String(contact?.profile?.name || "").trim(),
        ])
      );

      for (const message of value.messages || []) {
        const externalMessageId = String(message?.id || "").trim();
        const senderExternalId = String(message?.from || "").trim();
        if (!externalMessageId || !senderExternalId) continue;

        messages.push({
          provider: "whatsapp",
          externalMessageId,
          senderExternalId,
          senderPhone: senderExternalId,
          senderName: contacts.get(senderExternalId) || "",
          messageType: String(message?.type || "text").trim() || "text",
          text: whatsappMessageText(message),
          receivedAt: receivedDate(message?.timestamp),
        });
      }
    }
  }

  return messages;
}

function extractInstagramMessages(payload) {
  if (payload?.object !== "instagram") return [];
  const messages = [];

  for (const entry of payload.entry || []) {
    for (const event of entry.messaging || []) {
      const message = event?.message;
      if (!message || message?.is_echo) continue;

      const externalMessageId = String(message?.mid || "").trim();
      const senderExternalId = String(event?.sender?.id || "").trim();
      if (!externalMessageId || !senderExternalId) continue;

      messages.push({
        provider: "instagram",
        externalMessageId,
        senderExternalId,
        senderPhone: "",
        senderName: "",
        messageType: message?.text ? "text" : "attachment",
        text: instagramMessageText(message),
        receivedAt: receivedDate(event?.timestamp),
      });
    }
  }

  return messages;
}

function extractMessages(payload) {
  return [
    ...extractWhatsAppMessages(payload),
    ...extractInstagramMessages(payload),
  ];
}

async function claimReceipt(message) {
  try {
    return await InboundMessageReceipt.create({
      provider: message.provider,
      externalMessageId: message.externalMessageId,
      senderExternalId: message.senderExternalId,
      senderPhone: message.senderPhone,
      messageType: message.messageType,
      receivedAt: message.receivedAt,
      status: "processing",
    });
  } catch (error) {
    if (error?.code !== 11000) throw error;

    const failed = await InboundMessageReceipt.findOneAndUpdate(
      {
        provider: message.provider,
        externalMessageId: message.externalMessageId,
        status: "failed",
      },
      {
        $set: {
          status: "processing",
          error: "",
          senderExternalId: message.senderExternalId,
          senderPhone: message.senderPhone,
          messageType: message.messageType,
          receivedAt: message.receivedAt,
        },
      },
      { new: true }
    );

    return failed || null;
  }
}

async function findContactForMessage(message) {
  const or = [
    {
      externalIdentities: {
        $elemMatch: {
          provider: message.provider,
          externalId: message.senderExternalId,
        },
      },
    },
  ];

  const phoneNormalized = String(message.senderPhone || "").replace(/\D/g, "");
  if (phoneNormalized) or.push({ phoneNormalized });

  return CrmContact.findOne({
    isArchived: false,
    $or: or,
  });
}

function placeholderName(message) {
  if (message.senderName) return message.senderName.slice(0, 160);
  const suffix = message.senderExternalId.slice(-6);
  return `${PROVIDER_LABELS[message.provider]} Lead${suffix ? ` ${suffix}` : ""}`;
}

async function ensureExternalIdentity(contact, message) {
  const existing = (contact.externalIdentities || []).find(
    (identity) =>
      identity.provider === message.provider &&
      identity.externalId === message.senderExternalId
  );

  if (!existing) {
    contact.externalIdentities.push({
      provider: message.provider,
      externalId: message.senderExternalId,
      displayName: message.senderName || "",
    });
  } else if (message.senderName && !existing.displayName) {
    existing.displayName = message.senderName;
  }

  const inboundField =
    message.provider === "whatsapp"
      ? "lastInboundWhatsAppAt"
      : "lastInboundInstagramAt";

  const previousInbound = contact[inboundField];
  if (!previousInbound || message.receivedAt > previousInbound) {
    contact[inboundField] = message.receivedAt;
  }

  contact.lastActivityAt = new Date();
  await contact.save();
}

async function ensureFollowUpTask({ contact, opportunity, message }) {
  const existing = await CrmActivity.exists({
    contact: contact._id,
    type: "task",
    "metadata.event": "social_inbound_follow_up",
    "metadata.provider": message.provider,
    $or: [
      { completedAt: { $exists: false } },
      { completedAt: null },
    ],
  });

  if (existing) return;

  await addCrmActivity({
    contact,
    opportunity,
    type: "task",
    subject: `Respond to inbound ${PROVIDER_LABELS[message.provider]} message`,
    body: `A new inbound ${PROVIDER_LABELS[message.provider]} message needs a staff response.`,
    dueAt: new Date(),
    assignedTo: opportunity?.assignedTo || contact.assignedTo,
    metadata: {
      event: "social_inbound_follow_up",
      provider: message.provider,
      externalMessageId: message.externalMessageId,
    },
  });
}

async function processInboundMessage(message) {
  const receipt = await claimReceipt(message);
  if (!receipt) return { duplicate: true };

  try {
    let contact = await findContactForMessage(message);
    let opportunity;
    let created = false;

    if (!contact) {
      const result = await upsertCrmLead(
        {
          fullName: placeholderName(message),
          phone: message.senderPhone,
          source: normalizeCrmSource(message.provider === "whatsapp" ? "whatsapp_inbound" : "instagram_dm"),
          sourceDetail: `${message.provider}:${message.senderExternalId}`.slice(0, 160),
          preferredContactMethod:
            message.provider === "whatsapp" ? "whatsapp" : "no_preference",
          programInterest: "not_sure",
        },
        { stage: "new" }
      );
      contact = result.contact;
      opportunity = result.opportunity;
      created = result.created;
    } else {
      opportunity = await ensureOpenOpportunity(contact, {
        stage: "new",
        assignedTo: contact.assignedTo,
        reopen: contact.lifecycleStage !== "client",
      });
    }

    await ensureExternalIdentity(contact, message);

    await addCrmActivity({
      contact,
      opportunity,
      type: message.provider === "whatsapp" ? "whatsapp" : "note",
      subject:
        message.provider === "whatsapp"
          ? "Inbound WhatsApp message"
          : "Inbound Instagram DM",
      body: message.text,
      assignedTo: opportunity?.assignedTo || contact.assignedTo,
      metadata: {
        event: "social_inbound_message",
        inbound: true,
        provider: message.provider,
        externalMessageId: message.externalMessageId,
        senderExternalId: message.senderExternalId,
        messageType: message.messageType,
        receivedAt: message.receivedAt,
      },
    });

    await ensureFollowUpTask({ contact, opportunity, message });

    if (created) {
      dispatchWorkflowEvent({
        type: "crm_lead_created",
        eventKey: `crm_lead_created:${contact._id}:social:${message.externalMessageId}`,
        contactId: contact._id,
        opportunityId: opportunity?._id,
        actorName: "Meta webhook",
        data: {
          source: contact.source,
          provider: message.provider,
          programInterest: contact.programInterest,
        },
      }).catch((error) =>
        console.error("Social inbound lead workflow trigger failed:", error.message)
      );
    }

    receipt.status = "processed";
    receipt.processedAt = new Date();
    receipt.contact = contact._id;
    receipt.opportunity = opportunity?._id;
    receipt.error = "";
    await receipt.save();

    return { duplicate: false, created, contactId: contact._id };
  } catch (error) {
    receipt.status = "failed";
    receipt.error = String(error?.message || error || "Inbound message processing failed.").slice(0, 1000);
    await receipt.save().catch(() => {});
    throw error;
  }
}

export const verifyMetaWebhook = async (req, res) => {
  const configuredToken = verifyToken();
  if (!configuredToken) {
    return res.status(503).send("Meta webhook verification is not configured.");
  }

  const mode = String(req.query?.["hub.mode"] || "");
  const token = String(req.query?.["hub.verify_token"] || "");
  const challenge = String(req.query?.["hub.challenge"] || "");

  if (mode === "subscribe" && token === configuredToken && challenge) {
    return res.status(200).send(challenge);
  }

  return res.sendStatus(403);
};

export const handleMetaWebhook = async (req, res) => {
  if (!appSecret()) {
    return res.status(503).json({ success: false, message: "Meta webhook signature verification is not configured." });
  }

  if (!verifyMetaSignature(req)) {
    return res.status(401).json({ success: false, message: "Invalid Meta webhook signature." });
  }

  const messages = extractMessages(req.body);
  if (!messages.length) {
    return res.status(200).json({ success: true, received: 0 });
  }

  const results = await Promise.allSettled(messages.map(processInboundMessage));
  const failures = results.filter((result) => result.status === "rejected");

  if (failures.length) {
    console.error(
      "Meta webhook processing failed:",
      failures.map((failure) => failure.reason?.message || String(failure.reason))
    );
    return res.status(500).json({
      success: false,
      received: messages.length,
      failed: failures.length,
    });
  }

  const duplicates = results.filter(
    (result) => result.status === "fulfilled" && result.value?.duplicate
  ).length;

  return res.status(200).json({
    success: true,
    received: messages.length,
    duplicates,
  });
};
