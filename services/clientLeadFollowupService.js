import CrmActivity from "../models/CrmActivity.js";
import {
  upsertCrmLead,
  addCrmActivity,
} from "./crmService.js";

function safePhone(client) {
  const phone = String(client?.phone || "").replace(/\D/g, "");
  if (!phone || phone === "0000000000") return undefined;
  return phone;
}

export async function ensurePortalSignupFollowUp(client) {
  if (!client || client.isArchived) return null;
  if (client.reconciled && client.accountStage !== "preview") return null;

  const result = await upsertCrmLead(
    {
      fullName: client.fullName,
      email: client.email,
      phone: safePhone(client),
      source: client.registeredFromPortal
        ? "portal_registration"
        : "portal_social",
      sourceDetail: "Client portal account created or used",
      preferredContactMethod:
        client.email && client.email !== ""
          ? "email"
          : "no_preference",
      programInterest:
        client.program && client.program !== "not_sure"
          ? client.program
          : undefined,
    },
    { stage: "new" }
  );

  const { contact, opportunity } = result;

  const existing = await CrmActivity.exists({
    contact: contact._id,
    type: "task",
    "metadata.event": "portal_signup_follow_up",
    "metadata.clientId": String(client._id),
    $or: [
      { completedAt: { $exists: false } },
      { completedAt: null },
    ],
  });

  if (!existing) {
    await addCrmActivity({
      contact,
      opportunity,
      type: "task",
      subject: "Follow up with portal signup",
      body: `${contact.fullName} created or used a client portal account but is not yet an active Khairo Diet Clinic client. Contact them to see if they need help choosing a program.`,
      dueAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      assignedTo: opportunity?.assignedTo || contact.assignedTo,
      metadata: {
        event: "portal_signup_follow_up",
        clientId: String(client._id),
        portalStage: client.accountStage || "preview",
      },
    });
  }

  return result;
}
