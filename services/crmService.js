import CrmActivity from "../models/CrmActivity.js";
import CrmContact from "../models/CrmContact.js";
import CrmOpportunity from "../models/CrmOpportunity.js";
import User from "../models/User.js";
import {
  resolveProgramInterestSelection,
} from "../utils/programOfferingResolver.js";
import { notifyLeadAssignment } from "./leadAssignmentNotificationService.js";
import { normalizeCrmSource } from "../utils/crmSourceTaxonomy.js";

async function requireProgramInterestSelection(
  value,
  { defaultToNotSure = true } = {}
) {
  const selection =
    await resolveProgramInterestSelection(
      value,
      { defaultToNotSure }
    );

  if (selection.valid) {
    return selection;
  }

  const error = new Error(
    selection.reason === "missing_offering"
      ? "This program is not linked to an active catalogue offering."
      : "Invalid program interest."
  );

  error.statusCode =
    selection.reason === "missing_offering"
      ? 409
      : 400;

  throw error;
}

function programInterestCreateFields(selection) {
  return {
    programInterest: selection.key,
    ...(selection.offering
      ? {
          programInterestOffering:
            selection.offering._id,
        }
      : {}),
  };
}

function applyProgramInterestSelection(
  document,
  selection
) {
  document.programInterest = selection.key;

  document.programInterestOffering =
    selection.offering
      ? selection.offering._id
      : undefined;
}

const cleanEmail = (value = "") => String(value || "").trim().toLowerCase();
const cleanPhone = (value = "") => String(value || "").trim();
const normalizedPhone = (value = "") => cleanPhone(value).replace(/\D/g, "");

const opportunityName = (contact) => `${contact.fullName} — KhairoDietClinic membership`;

async function chooseLeastLoadedAssignableUser(users) {
  if (!Array.isArray(users) || users.length === 0) return undefined;

  const userIds = users.map((user) => user._id);

  const workloadRows = await CrmOpportunity.aggregate([
    {
      $match: {
        status: "open",
        assignedTo: { $in: userIds },
      },
    },
    {
      $group: {
        _id: "$assignedTo",
        openCount: { $sum: 1 },
        lastAssignedAt: { $max: "$createdAt" },
      },
    },
  ]);

  const workloadByUser = new Map(
    workloadRows.map((row) => [
      String(row._id),
      {
        openCount: Number(row.openCount || 0),
        lastAssignedAt: row.lastAssignedAt
          ? new Date(row.lastAssignedAt).getTime()
          : 0,
      },
    ])
  );

  return users
    .map((user) => ({
      _id: user._id,
      ...(workloadByUser.get(String(user._id)) || {
        openCount: 0,
        lastAssignedAt: 0,
      }),
    }))
    .sort(
      (a, b) =>
        a.openCount - b.openCount ||
        a.lastAssignedAt - b.lastAssignedAt ||
        String(a._id).localeCompare(String(b._id))
    )[0]?._id;
}

async function chooseLeastLoadedSalesRep() {
  const salesReps = await User.find({
    isActive: true,
    roles: "sales",
  })
    .select("_id")
    .lean();

  if (salesReps.length) {
    return chooseLeastLoadedAssignableUser(salesReps);
  }

  // If no sales reps exist, fall back to the least-loaded active admin.
  const admins = await User.find({
    isActive: true,
    roles: "admin",
  })
    .select("_id")
    .lean();

  return chooseLeastLoadedAssignableUser(admins);
}

async function resolveLeadOwner(contact, requestedAssignedTo) {
  if (requestedAssignedTo) return requestedAssignedTo;
  if (contact?.assignedTo) return contact.assignedTo;

  if (contact?._id) {
    const existingOpportunity = await CrmOpportunity.findOne({
      contact: contact._id,
      status: "open",
      assignedTo: { $exists: true, $ne: null },
    })
      .sort({ updatedAt: -1 })
      .select("assignedTo")
      .lean();

    if (existingOpportunity?.assignedTo) {
      return existingOpportunity.assignedTo;
    }
  }

  return chooseLeastLoadedSalesRep();
}

export async function findCrmContact({ email, phone }) {
  const or = [];
  const normalizedEmail = cleanEmail(email);
  const phoneDigits = normalizedPhone(phone);

  if (normalizedEmail) or.push({ email: normalizedEmail });
  if (phoneDigits) or.push({ phoneNormalized: phoneDigits });
  if (!or.length) return null;

  return CrmContact.findOne({ isArchived: false, $or: or });
}

export async function ensureOpenOpportunity(contact, defaults = {}) {
  let opportunity = await CrmOpportunity.findOne({
    contact: contact._id,
    status: "open",
  }).sort({ updatedAt: -1 });

  if (opportunity) {
    if (defaults.assignedTo && !opportunity.assignedTo) {
      opportunity.assignedTo = defaults.assignedTo;
      if (defaults.createdBy) opportunity.updatedBy = defaults.createdBy;
      await opportunity.save();
    }
    return opportunity;
  }

  const latestClosed = await CrmOpportunity.findOne({
    contact: contact._id,
  }).sort({ updatedAt: -1 });

  if (latestClosed && defaults.reopen !== true) {
    return latestClosed;
  }

  if (latestClosed?.status === "lost" && defaults.reopen === true) {
    latestClosed.status = "open";
    latestClosed.stage = defaults.stage || "new";
    latestClosed.stageEnteredAt = new Date();
    latestClosed.closedAt = undefined;
    latestClosed.lostReason = "";

    if (defaults.programInterest) {
      const selection =
        await requireProgramInterestSelection(
          defaults.programInterest
        );

      applyProgramInterestSelection(
        latestClosed,
        selection
      );
    }

    if (defaults.assignedTo) latestClosed.assignedTo = defaults.assignedTo;
    if (defaults.application) latestClosed.application = defaults.application;
    if (defaults.client) latestClosed.client = defaults.client;
    if (defaults.createdBy) latestClosed.updatedBy = defaults.createdBy;

    await latestClosed.save();

    return latestClosed;
  }

  const selection =
    await requireProgramInterestSelection(
      defaults.programInterest ||
        contact.programInterest ||
        "not_sure"
    );

  opportunity = await CrmOpportunity.create({
    contact: contact._id,
    name: opportunityName(contact),
    stage: defaults.stage || "new",
    ...programInterestCreateFields(selection),
    assignedTo: defaults.assignedTo || contact.assignedTo,
    estimatedValue: Number(defaults.estimatedValue) || 0,
    nextFollowUpAt: defaults.nextFollowUpAt || undefined,
    application: defaults.application || contact.application,
    client: defaults.client || contact.client,
    createdBy: defaults.createdBy,
  });

  return opportunity;
}

export async function addCrmActivity({
  contact,
  opportunity,
  type = "note",
  subject,
  body,
  dueAt,
  assignedTo,
  createdBy,
  metadata,
}) {
  const activity = await CrmActivity.create({
    contact: contact._id || contact,
    opportunity: opportunity?._id || opportunity,
    type,
    subject,
    body,
    dueAt,
    assignedTo,
    createdBy,
    metadata,
  });

  await CrmContact.findByIdAndUpdate(contact._id || contact, {
    lastActivityAt: new Date(),
    ...(createdBy ? { updatedBy: createdBy } : {}),
  });

  return activity;
}

export async function upsertCrmLead(
  {
    fullName,
    email,
    phone,
    source,
    sourceDetail,
    preferredContactMethod,
    programInterest,
    assignedTo,
    message,
  },
  {
    createdBy,
    stage = "new",
    reopen,
  } = {}
) {
  let contact = await findCrmContact({ email, phone });
  let created = false;
  const normalizedIncomingSource = normalizeCrmSource(source);

  const hadContactAssignment = Boolean(contact?.assignedTo);

  const hadOpportunityAssignment = contact?._id
    ? Boolean(
        await CrmOpportunity.exists({
          contact: contact._id,
          status: "open",
          assignedTo: { $exists: true, $ne: null },
        })
      )
    : false;

  const resolvedAssignedTo = await resolveLeadOwner(
    contact,
    assignedTo
  );

  const isNewAssignment = Boolean(
    resolvedAssignedTo &&
      !hadContactAssignment &&
      !hadOpportunityAssignment
  );

  const hasIncomingProgramInterest =
    programInterest !== undefined &&
    programInterest !== null &&
    String(programInterest).trim() !== "";

  const incomingSelection =
    hasIncomingProgramInterest
      ? await requireProgramInterestSelection(
          programInterest,
          { defaultToNotSure: false }
        )
      : null;

  if (!contact) {
    const selection =
      incomingSelection ||
      await requireProgramInterestSelection(
        undefined,
        { defaultToNotSure: true }
      );

    contact = await CrmContact.create({
      fullName: String(fullName || "Lead").trim(),
      email: cleanEmail(email),
      phone: cleanPhone(phone),
      source: normalizedIncomingSource,
      sourceDetail: String(sourceDetail || "").trim(),
      preferredContactMethod:
        preferredContactMethod || "no_preference",
      ...programInterestCreateFields(selection),
      assignedTo: resolvedAssignedTo,
      createdBy,
      updatedBy: createdBy,
      lastActivityAt: new Date(),
    });

    created = true;
  } else {
    const updates = {};

    if (fullName && (!contact.fullName || contact.fullName === "Lead")) {
      updates.fullName = String(fullName).trim();
    }

    if (email && !contact.email) {
      updates.email = cleanEmail(email);
    }

    if (phone && !contact.phone) {
      updates.phone = cleanPhone(phone);
    }

    // Preserve the previous CRM behaviour: a generic "not_sure"
    // upsert does not erase an existing known program interest.
    if (
      incomingSelection &&
      incomingSelection.key !== "not_sure"
    ) {
      Object.assign(
        updates,
        programInterestCreateFields(
          incomingSelection
        )
      );
    }

    if (resolvedAssignedTo && !contact.assignedTo) {
      updates.assignedTo = resolvedAssignedTo;
    }

    if (normalizedIncomingSource && (!contact.source || contact.source === "manual")) {
      updates.source = normalizedIncomingSource;
    }

    if (
      sourceDetail &&
      !contact.sourceDetail
    ) {
      updates.sourceDetail =
        String(sourceDetail).trim();
    }

    if (
      preferredContactMethod &&
      (
        !contact.preferredContactMethod ||
        contact.preferredContactMethod === "no_preference"
      )
    ) {
      updates.preferredContactMethod =
        preferredContactMethod;
    }

    if (createdBy) {
      updates.updatedBy = createdBy;
    }

    updates.lastActivityAt = new Date();

    contact =
      await CrmContact.findByIdAndUpdate(
        contact._id,
        updates,
        {
          new: true,
          runValidators: true,
        }
      );
  }

  const opportunityProgramInterest =
    incomingSelection?.key ||
    contact.programInterest;

  const opportunity =
    await ensureOpenOpportunity(contact, {
      stage,
      programInterest:
        opportunityProgramInterest,
      assignedTo:
        resolvedAssignedTo || contact.assignedTo,
      createdBy,
      reopen:
        reopen !== undefined
          ? Boolean(reopen)
          : contact.lifecycleStage !== "client",
    });

  if (message) {
    await addCrmActivity({
      contact,
      opportunity,
      type: source === "website_contact" ? "email" : "note",
      subject: source === "website_contact" ? "Website enquiry" : "Lead note",
      body: String(message).trim(),
      assignedTo: resolvedAssignedTo || contact.assignedTo,
      createdBy,
      metadata: { source: source || "manual" },
    });
  } else if (created) {
    await addCrmActivity({
      contact,
      opportunity,
      type: "system",
      subject: "Lead created",
      body: `Lead created from ${source || "manual"}.`,
      assignedTo: resolvedAssignedTo || contact.assignedTo,
      createdBy,
    });
  }

  if (isNewAssignment && resolvedAssignedTo) {
    try {
      const notification =
        await notifyLeadAssignment({
          assignedTo: resolvedAssignedTo,
          contact,
          opportunity,
        });

      await addCrmActivity({
        contact,
        opportunity,
        type: "system",
        subject: "Lead assignment notification",
        body: `Assignment alert processed. Rep push: ${
          notification.push?.status || "unknown"
        }. Rep email: ${
          notification.email?.status || "unknown"
        }. Admin push: ${
          notification.adminCopy?.push?.status || "unknown"
        }. Admin email: ${
          notification.adminCopy?.email?.status || "unknown"
        }.`,
        assignedTo: resolvedAssignedTo,
        createdBy,
        metadata: {
          event: "lead_assignment_notification",
          push: notification.push,
          email: notification.email,
          adminCopy: notification.adminCopy,
        },
      });
    } catch (error) {
      console.error(
        "Lead assignment notification failed:",
        error?.message || error
      );
    }
  }

  return { contact, opportunity, created };
}

export async function syncApplicationToCrm(application, actor = {}) {
  const applicationInterest =
    application.programInterest ||
    application.program ||
    "not_sure";

  const applicationInterestSelection =
    await requireProgramInterestSelection(
      applicationInterest
    );

  const { contact, opportunity } = await upsertCrmLead(
    {
      fullName: application.fullName,
      email: application.email,
      phone: application.phone,
      source: application.source === "manual" ? "manual_application" : "website_application",
      programInterest:
        applicationInterestSelection.key,
    },
    { createdBy: actor.userId, stage: "qualification" }
  );

  contact.application = application._id;
  const isExistingClient = contact.lifecycleStage === "client";
  if (!isExistingClient) {
    contact.lifecycleStage = "applicant";
  }
  contact.updatedBy = actor.userId;
  await contact.save();

  opportunity.application = application._id;
  if (!isExistingClient) {
    if (["new", "nurture"].includes(opportunity.stage)) {
      opportunity.stage = "qualification";
      opportunity.stageEnteredAt = new Date();
    }

    applyProgramInterestSelection(
      opportunity,
      applicationInterestSelection
    );
  }
  opportunity.updatedBy = actor.userId;
  await opportunity.save();

  const existingActivity = await CrmActivity.exists({
    contact: contact._id,
    type: "application",
    "metadata.applicationId": application._id.toString(),
  });

  if (!existingActivity) {
    await addCrmActivity({
      contact,
      opportunity,
      type: "application",
      subject: "Application submitted",
      body: `${application.fullName} entered the KhairoDietClinic Requests workflow.`,
      createdBy: actor.userId,
      metadata: {
        applicationId: application._id.toString(),
        actorName: actor.userName || "System",
      },
    });
  }

  return { contact, opportunity };
}

export async function syncClientToCrm(client, application, actor = {}) {
  const clientInterestSelection =
    await requireProgramInterestSelection(
      client.program
    );

  let contact = null;

  if (application?._id) {
    contact = await CrmContact.findOne({ application: application._id, isArchived: false });
  }
  if (!contact && client?._id) {
    contact = await CrmContact.findOne({ client: client._id, isArchived: false });
  }
  if (!contact && client?.email) {
    contact = await CrmContact.findOne({ email: String(client.email).trim().toLowerCase(), isArchived: false });
  }

  if (!contact) {
    const result = await upsertCrmLead(
      {
        fullName: client.fullName,
        email: client.email,
        phone: client.phone,
        source: application ? "application" : "client",
        programInterest: client.program || "not_sure",
      },
      { createdBy: actor.userId, stage: application ? "payment_pending" : "qualified" }
    );
    contact = result.contact;
  }

  contact.client = client._id;
  if (application?._id) contact.application = application._id;
  contact.lifecycleStage = "client";

  applyProgramInterestSelection(
    contact,
    clientInterestSelection
  );

  contact.updatedBy = actor.userId;
  contact.lastActivityAt = new Date();
  await contact.save();

  let opportunity = await CrmOpportunity.findOne({
    contact: contact._id,
    client: client._id,
    status: "won",
  }).sort({ updatedAt: -1 });

  if (!opportunity) {
    opportunity = await ensureOpenOpportunity(contact, {
      application: application?._id,
      client: client._id,
      programInterest: client.program,
      createdBy: actor.userId,
      reopen: true,
    });
  }

  opportunity.client = client._id;
  if (application?._id) opportunity.application = application._id;

  applyProgramInterestSelection(
    opportunity,
    clientInterestSelection
  );

  opportunity.status = "won";
  opportunity.wonAt = opportunity.wonAt || new Date();
  opportunity.closedAt = opportunity.closedAt || new Date();
  opportunity.updatedBy = actor.userId;
  await opportunity.save();

  const existing = await CrmActivity.exists({
    contact: contact._id,
    type: "system",
    "metadata.clientId": client._id.toString(),
    "metadata.event": "became_client",
  });

  if (!existing) {
    await addCrmActivity({
      contact,
      opportunity,
      type: "system",
      subject: "Became a client",
      body: `${client.fullName} completed the enrollment workflow and became a KhairoDietClinic client.`,
      createdBy: actor.userId,
      metadata: {
        event: "became_client",
        clientId: client._id.toString(),
        applicationId: application?._id?.toString(),
        actorName: actor.userName || "System",
      },
    });
  }

  return { contact, opportunity };
}
