import Client from "../models/Client.js";
import CrmContact from "../models/CrmContact.js";
import MedicalReviewCase from "../models/MedicalReviewCase.js";
import {
  getLegacyCycleWeeks,
  isLegacyProgramKey,
  normalizeLegacyProgramKey,
  resolveLegacyProgramOffering,
} from "../utils/programOfferingResolver.js";

function normalizedEmail(value) {
  return String(value || "").trim().toLowerCase();
}

async function linkClient({ opportunity, contact, client }) {
  let changed = false;

  if (
    !contact.client ||
    String(contact.client) !== String(client._id)
  ) {
    contact.client = client._id;
    contact.updatedBy = opportunity.updatedBy || opportunity.createdBy;
    await contact.save();
  }

  if (
    !opportunity.client ||
    String(opportunity.client) !== String(client._id)
  ) {
    opportunity.client = client._id;
    opportunity.updatedBy = opportunity.updatedBy || opportunity.createdBy;
    await opportunity.save();
    changed = true;
  }

  return changed;
}

export async function ensurePaymentPendingClientForOpportunity(opportunity) {
  if (!opportunity || opportunity.stage !== "payment_pending") {
    return { client: null, created: false, linked: false };
  }

  const contact = await CrmContact.findById(opportunity.contact);
  if (!contact) {
    return {
      client: null,
      created: false,
      linked: false,
      reason: "contact_not_found",
    };
  }

  const medicalCase = await MedicalReviewCase.findOne({
    opportunity: opportunity._id,
  })
    .select("assignedDoctor")
    .lean();

  let client = null;

  if (opportunity.client) {
    client = await Client.findById(opportunity.client);
  }

  if (!client && contact.client) {
    client = await Client.findById(contact.client);
  }

  if (!client && contact.email) {
    client = await Client.findOne({
      email: normalizedEmail(contact.email),
      isArchived: { $ne: true },
    });
  }

  if (client) {
    // The doctor who completed the pre-payment medical review remains the
    // client's doctor unless an administrator explicitly changes the care team.
    if (!client.assignedDoctor && medicalCase?.assignedDoctor) {
      client.assignedDoctor = medicalCase.assignedDoctor;
      await client.save();
    }

    const linked = await linkClient({ opportunity, contact, client });
    return { client, created: false, linked };
  }

  if (!contact.fullName || !contact.email || !contact.phone) {
    return {
      client: null,
      created: false,
      linked: false,
      reason: "missing_contact_details",
    };
  }

  const program = normalizeLegacyProgramKey(
    opportunity.programInterest || contact.programInterest || "not_sure"
  );

  let offering;
  let cycleWeeks = 8;

  if (isLegacyProgramKey(program)) {
    offering = await resolveLegacyProgramOffering(program);
    if (offering) {
      cycleWeeks = getLegacyCycleWeeks(offering, program);
    }
  }

  try {
    client = await Client.create({
      fullName: contact.fullName,
      email: normalizedEmail(contact.email),
      phone: contact.phone,
      program,
      ...(offering ? { programOffering: offering._id } : {}),
      cycleWeeks,
      reconciled: false,
      portalActive: false,
      accountStage: "preview",
      ...(medicalCase?.assignedDoctor
        ? { assignedDoctor: medicalCase.assignedDoctor }
        : {}),
      addedBy: opportunity.updatedBy || opportunity.createdBy,
    });
  } catch (error) {
    if (error?.code !== 11000) throw error;

    client = await Client.findOne({
      email: normalizedEmail(contact.email),
      isArchived: { $ne: true },
    });

    if (!client) throw error;

    if (!client.assignedDoctor && medicalCase?.assignedDoctor) {
      client.assignedDoctor = medicalCase.assignedDoctor;
      await client.save();
    }
  }

  await linkClient({ opportunity, contact, client });

  return {
    client,
    created: true,
    linked: true,
  };
}
