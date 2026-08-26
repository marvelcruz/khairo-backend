import ActionAlert from "../models/ActionAlert.js";
import Client from "../models/Client.js";
import CrmActivity from "../models/CrmActivity.js";
import CrmContact from "../models/CrmContact.js";
import CrmOpportunity from "../models/CrmOpportunity.js";
import InboundMessageReceipt from "../models/InboundMessageReceipt.js";
import MedicalReviewCase from "../models/MedicalReviewCase.js";

const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;
const ONBOARDING_KEYS = ["loggedWeight", "tickedMeal", "bookedCall", "joinedGroup"];
let scanInFlight = null;

function overdueDays(dueAt, now = new Date()) {
  const time = new Date(dueAt).getTime();
  if (!Number.isFinite(time)) return 0;
  return Math.max(0, Math.floor((now.getTime() - time) / DAY));
}

function alertProfile(activity) {
  const event = String(activity.metadata?.event || "");

  if (event === "week3_review_due" || event === "week3_review_escalation") {
    return {
      audienceRoles: ["admin", "coach", "staff"],
      href: "/dashboard/week-3-review",
      titlePrefix: event === "week3_review_escalation" ? "Week 3 escalation overdue" : "Week 3 review overdue",
      recommendedAction:
        event === "week3_review_escalation"
          ? "Review the Week 3 escalation today and record the next support action."
          : "Complete the client’s Week 3 review and record the outcome.",
    };
  }

  if (event === "payment_problem_follow_up") {
    return {
      audienceRoles: ["admin", "sales"],
      href: "/dashboard/crm/payment-pending",
      titlePrefix: "Payment follow-up overdue",
      recommendedAction:
        "Review the failed or abandoned payment attempt and contact the client if a fresh payment link is appropriate.",
    };
  }

  if (event === "crm_consultation_no_show_follow_up" || event === "consultation_cancelled_rebook") {
    return {
      audienceRoles: ["admin", "sales", "coach"],
      href: activity.contact?._id
        ? `/dashboard/crm?contact=${activity.contact._id}`
        : "/dashboard/crm",
      titlePrefix: "Consultation follow-up overdue",
      recommendedAction: "Contact the lead and record the next consultation action in CRM.",
    };
  }

  return {
    audienceRoles: ["admin", "sales", "coach", "staff"],
    href: activity.contact?._id
      ? `/dashboard/crm?contact=${activity.contact._id}`
      : "/dashboard/crm",
    titlePrefix: "CRM task overdue",
    recommendedAction: "Review the overdue CRM task, complete it, or update the follow-up date.",
  };
}

async function upsertAlert({ dedupeKey, payload, now }) {
  const existing = await ActionAlert.findOne({ dedupeKey });
  if (!existing) {
    await ActionAlert.create({
      dedupeKey,
      ...payload,
      status: "open",
      firstDetectedAt: now,
    });
    return { created: 1, updated: 0 };
  }

  Object.assign(existing, payload);
  if (existing.status === "resolved") {
    existing.status = "open";
    existing.resolvedAt = null;
    existing.resolvedBy = null;
    existing.resolutionNote = "";
  }
  await existing.save();
  return { created: 0, updated: 1 };
}

async function autoResolveMissing(ruleKey, activeKeys, now, note) {
  const query = {
    ruleKey,
    status: "open",
  };
  if (activeKeys.length) query.dedupeKey = { $nin: activeKeys };

  const stale = await ActionAlert.find(query);
  let resolved = 0;
  for (const alert of stale) {
    alert.status = "resolved";
    alert.resolvedAt = now;
    alert.resolutionNote = note;
    await alert.save();
    resolved += 1;
  }
  return resolved;
}

function activationProblems(client) {
  const problems = [];
  if (client.accountStage !== "active") problems.push("account stage is not active");
  if (client.reconciled !== true) problems.push("payment/program reconciliation is incomplete");
  if (client.portalActive !== true) problems.push("client portal is not activated");
  if (!client.programStartedAt) problems.push("program start timestamp is missing");
  return problems;
}

function onboardingProgress(client) {
  return ONBOARDING_KEYS.filter((key) => client.onboarding?.[key] === true).length;
}

async function scanQualificationReviewQueue(now) {
  const cutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const opportunities = await CrmOpportunity.find({
    stage: "qualification",
    status: "open",
    stageEnteredAt: { $lte: cutoff },
  })
    .populate("contact", "fullName isArchived")
    .limit(200)
    .lean();

  const activeKeys = [];
  let created = 0;
  let updated = 0;

  for (const opportunity of opportunities) {
    if (!opportunity.contact || opportunity.contact.isArchived) continue;

    const ageDays = overdueDays(opportunity.stageEnteredAt, now);
    const severity = ageDays >= 2 ? "urgent" : "warning";
    const dedupeKey = `qualification_review_needed:${opportunity._id}`;
    activeKeys.push(dedupeKey);

    const result = await upsertAlert({
      dedupeKey,
      now,
      payload: {
        ruleKey: "qualification_review_needed",
        entityType: "CrmOpportunity",
        entityId: String(opportunity._id),
        severity,
        title: `Qualification review waiting: ${opportunity.contact.fullName || "CRM lead"}`,
        summary: `Lead has been in Qualification for ${ageDays} day${ageDays === 1 ? "" : "s"} without a recorded decision.`,
        recommendedAction:
          "Open the qualification queue, review the lead’s information, and record Qualified, Nurture, or Lost.",
        href: "/dashboard/crm/qualification",
        subject: {
          name: opportunity.contact.fullName || "CRM lead",
          email: "",
          phone: "",
          context: "Qualification decision pending",
        },
        audienceRoles: ["admin", "sales"],
        ageDays,
        thresholdDays: 1,
        lastDetectedAt: now,
      },
    });

    created += result.created;
    updated += result.updated;
  }

  const autoResolved = await autoResolveMissing(
    "qualification_review_needed",
    activeKeys,
    now,
    "Automatically resolved because the lead is no longer waiting in Qualification."
  );

  return { created, updated, autoResolved };
}

async function scanMedicalReviewExceptions(now) {
  const cutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const cases = await MedicalReviewCase.find({
    status: "awaiting_scheduling",
    createdAt: { $lte: cutoff },
  })
    .populate("contact", "fullName isArchived")
    .limit(200)
    .lean();

  const activeKeys = [];
  let created = 0;
  let updated = 0;

  for (const medicalCase of cases) {
    if (!medicalCase.contact || medicalCase.contact.isArchived) continue;

    const ageDays = overdueDays(medicalCase.createdAt, now);
    const severity = ageDays >= 3 ? "urgent" : "warning";
    const dedupeKey = `medical_review_awaiting_scheduling:${medicalCase._id}`;
    activeKeys.push(dedupeKey);

    const result = await upsertAlert({
      dedupeKey,
      now,
      payload: {
        ruleKey: "medical_review_awaiting_scheduling",
        entityType: "MedicalReviewCase",
        entityId: String(medicalCase._id),
        severity,
        title: `Medical review awaiting scheduling: ${medicalCase.contact.fullName || "Client"}`,
        summary: `Medical review has been awaiting scheduling for ${ageDays} day${ageDays === 1 ? "" : "s"}.`,
        recommendedAction:
          "Assign a doctor if needed and schedule the medical review meeting.",
        href: "/dashboard/crm/medical-review",
        subject: {
          name: medicalCase.contact.fullName || "Client",
          email: "",
          phone: "",
          context: "Medical review scheduling pending",
        },
        audienceRoles: ["admin", "doctor"],
        ageDays,
        thresholdDays: 1,
        lastDetectedAt: now,
      },
    });

    created += result.created;
    updated += result.updated;
  }

  const autoResolved = await autoResolveMissing(
    "medical_review_awaiting_scheduling",
    activeKeys,
    now,
    "Automatically resolved because the medical review is no longer awaiting scheduling."
  );

  return { created, updated, autoResolved };
}

async function scanWhatsAppServiceWindow(now) {
  const responseStaleBefore = new Date(now.getTime() - 2 * 60 * 60 * 1000);
  const contacts = await CrmContact.find({
    isArchived: false,
    lastInboundWhatsAppAt: {
      $exists: true,
      $ne: null,
      $lte: responseStaleBefore,
    },
  })
    .select("fullName lastInboundWhatsAppAt assignedTo")
    .limit(200)
    .lean();

  const activeKeys = [];
  let created = 0;
  let updated = 0;

  for (const contact of contacts) {
    const lastInbound = new Date(contact.lastInboundWhatsAppAt);
    const outboundRecorded = await CrmActivity.exists({
      contact: contact._id,
      type: "whatsapp",
      createdAt: { $gt: lastInbound },
      $or: [
        { "metadata.inbound": { $ne: true } },
        { "metadata.inbound": { $exists: false } },
      ],
    });

    if (outboundRecorded) continue;

    const serviceWindowExpiresAt = new Date(
      lastInbound.getTime() + 24 * 60 * 60 * 1000
    );
    const ageHours = Math.max(
      0,
      Math.floor((now.getTime() - lastInbound.getTime()) / (60 * 60 * 1000))
    );
    const severity = ageHours >= 6 ? "urgent" : "warning";
    const dedupeKey = `whatsapp_service_window:${contact._id}`;
    activeKeys.push(dedupeKey);

    const result = await upsertAlert({
      dedupeKey,
      now,
      payload: {
        ruleKey: "whatsapp_service_window",
        entityType: "CrmContact",
        entityId: String(contact._id),
        severity,
        title: `WhatsApp response window: ${contact.fullName || "Contact"}`,
        summary: `Inbound WhatsApp has been waiting for a staff response for ${ageHours} hour${ageHours === 1 ? "" : "s"}. The 24-hour service window expires ${serviceWindowExpiresAt.toLocaleString("en-NG", { timeZone: "Africa/Lagos" })}.`,
        recommendedAction:
          "Respond to the client via WhatsApp or record the WhatsApp activity in CRM. If the conversation has already happened elsewhere, add a WhatsApp activity in CRM to clear this alert.",
        href: `/dashboard/crm?contact=${contact._id}`,
        subject: {
          name: contact.fullName || "WhatsApp contact",
          email: "",
          phone: "",
          context: `24h service window · ${ageHours}h elapsed`,
        },
        audienceRoles: ["admin", "sales", "coach", "staff"],
        ageDays: ageHours,
        thresholdDays: 2,
        lastDetectedAt: now,
      },
    });

    created += result.created;
    updated += result.updated;
  }

  const autoResolved = await autoResolveMissing(
    "whatsapp_service_window",
    activeKeys,
    now,
    "Automatically resolved because an outbound WhatsApp activity was recorded or the contact is no longer waiting."
  );

  return { created, updated, autoResolved };
}

const STALL_THRESHOLDS = {
  new: { warningDays: 3, urgentDays: 7 },
  qualification: { warningDays: 2, urgentDays: 5 },
  qualified: { warningDays: 3, urgentDays: 7 },
  consultation_booked: { warningDays: 2, urgentDays: 5 },
  consultation_completed: { warningDays: 2, urgentDays: 5 },
  medical_review: { warningDays: 3, urgentDays: 7 },
  payment_pending: { warningDays: 3, urgentDays: 7 },
  nurture: { warningDays: 7, urgentDays: 14 },
};

const STALL_STAGE_LABELS = {
  new: "New Lead",
  qualification: "Qualification",
  qualified: "Qualified",
  consultation_booked: "Consultation Booked",
  consultation_completed: "Consultation Completed",
  medical_review: "Medical Review",
  payment_pending: "Payment Pending",
  nurture: "Nurture",
};

async function scanStalledOpportunities(now) {
  const opportunities = await CrmOpportunity.find({
    status: "open",
    stage: { $in: Object.keys(STALL_THRESHOLDS) },
  })
    .populate("contact", "fullName isArchived")
    .limit(500)
    .lean();

  const activeKeys = [];
  let created = 0;
  let updated = 0;

  for (const opportunity of opportunities) {
    if (!opportunity.contact || opportunity.contact.isArchived) continue;

    const threshold = STALL_THRESHOLDS[opportunity.stage];
    if (!threshold) continue;

    const ageDays = overdueDays(opportunity.stageEnteredAt, now);
    if (ageDays < threshold.warningDays) continue;

    const severity = ageDays >= threshold.urgentDays ? "urgent" : "warning";
    const dedupeKey = `stalled_opportunity:${opportunity._id}:${opportunity.stage}`;
    activeKeys.push(dedupeKey);

    const stageLabel = STALL_STAGE_LABELS[opportunity.stage] || opportunity.stage.replaceAll("_", " ");
    const result = await upsertAlert({
      dedupeKey,
      now,
      payload: {
        ruleKey: "stalled_opportunity",
        entityType: "CrmOpportunity",
        entityId: String(opportunity._id),
        severity,
        title: `Stalled pipeline: ${opportunity.contact.fullName || "CRM lead"}`,
        summary: `${opportunity.contact.fullName || "Lead"} has been in ${stageLabel} for ${ageDays} day${ageDays === 1 ? "" : "s"}.`,
        recommendedAction:
          "Open the CRM record, record the next contact or decision, or move the lead to the correct stage.",
        href: `/dashboard/crm?contact=${opportunity.contact._id}`,
        subject: {
          name: opportunity.contact.fullName || "CRM lead",
          email: "",
          phone: "",
          context: `${stageLabel} · ${ageDays} days`,
        },
        audienceRoles: ["admin", "sales"],
        ageDays,
        thresholdDays: threshold.warningDays,
        lastDetectedAt: now,
      },
    });

    created += result.created;
    updated += result.updated;
  }

  const autoResolved = await autoResolveMissing(
    "stalled_opportunity",
    activeKeys,
    now,
    "Automatically resolved because the opportunity moved stage or is no longer open."
  );

  return { created, updated, autoResolved };
}

async function performScan() {
  const now = new Date();
  let created = 0;
  let updated = 0;
  let autoResolved = 0;

  const activities = await CrmActivity.find({
    type: "task",
    dueAt: { $lt: now },
    completedAt: { $exists: false },
  })
    .sort({ dueAt: 1 })
    .limit(300)
    .populate("contact", "fullName isArchived")
    .lean();

  const taskKeys = [];
  for (const activity of activities) {
    if (!activity.contact || activity.contact.isArchived) continue;

    const ageDays = overdueDays(activity.dueAt, now);
    const severity = ageDays >= 3 ? "urgent" : "warning";
    const dedupeKey = `crm_task_overdue:${activity._id}`;
    taskKeys.push(dedupeKey);

    const profile = alertProfile(activity);
    const result = await upsertAlert({
      dedupeKey,
      now,
      payload: {
        ruleKey: "crm_task_overdue",
        entityType: "CrmActivity",
        entityId: String(activity._id),
        severity,
        title: `${profile.titlePrefix}: ${activity.contact.fullName || "CRM contact"}`,
        summary: `${activity.subject || "CRM task"} is ${ageDays === 0 ? "overdue today" : `${ageDays} day${ageDays === 1 ? "" : "s"} overdue`}.`,
        recommendedAction: profile.recommendedAction,
        href: profile.href,
        subject: {
          name: activity.contact.fullName || "CRM contact",
          email: "",
          phone: "",
          context: activity.subject || "CRM follow-up task",
        },
        audienceRoles: profile.audienceRoles,
        ageDays,
        thresholdDays: 0,
        lastDetectedAt: now,
      },
    });
    created += result.created;
    updated += result.updated;
  }

  autoResolved += await autoResolveMissing(
    "crm_task_overdue",
    taskKeys,
    now,
    "Automatically resolved because the CRM task is no longer overdue."
  );

  const clients = await Client.find({
    isArchived: { $ne: true },
    status: "active",
  })
    .select("fullName accountStage reconciled portalActive programStartedAt onboarding")
    .limit(500)
    .lean();

  const activationKeys = [];
  const onboardingKeys = [];

  for (const client of clients) {
    const problems = activationProblems(client);
    if (problems.length) {
      const dedupeKey = `client_activation_inconsistent:${client._id}`;
      activationKeys.push(dedupeKey);
      const severity =
        client.reconciled !== true ||
        client.accountStage !== "active" ||
        !client.programStartedAt
          ? "urgent"
          : "warning";

      const result = await upsertAlert({
        dedupeKey,
        now,
        payload: {
          ruleKey: "client_activation_inconsistent",
          entityType: "Client",
          entityId: String(client._id),
          severity,
          title: `Activation inconsistency: ${client.fullName || "Client"}`,
          summary: `Client is marked active but ${problems.join("; ")}.`,
          recommendedAction:
            "Review the client record and correct the activation prerequisite that is out of sync. Do not create a duplicate client.",
          href: `/dashboard/clients/${client._id}`,
          subject: {
            name: client.fullName || "Client",
            email: "",
            phone: "",
            context: "Activation consistency",
          },
          audienceRoles: ["admin", "staff"],
          ageDays: client.programStartedAt ? overdueDays(client.programStartedAt, now) : 0,
          thresholdDays: 0,
          lastDetectedAt: now,
        },
      });
      created += result.created;
      updated += result.updated;
      continue;
    }

    const daysSinceActivation = overdueDays(client.programStartedAt, now);
    const completed = onboardingProgress(client);
    const stalled =
      completed < ONBOARDING_KEYS.length &&
      ((completed === 0 && daysSinceActivation >= 1) ||
        (completed > 0 && daysSinceActivation >= 3));

    if (!stalled) continue;

    const dedupeKey = `client_onboarding_stalled:${client._id}`;
    onboardingKeys.push(dedupeKey);
    const severity =
      (completed === 0 && daysSinceActivation >= 3) || daysSinceActivation >= 7
        ? "urgent"
        : "warning";

    const result = await upsertAlert({
      dedupeKey,
      now,
      payload: {
        ruleKey: "client_onboarding_stalled",
        entityType: "Client",
        entityId: String(client._id),
        severity,
        title: `Onboarding stalled: ${client.fullName || "Client"}`,
        summary: `${completed} of ${ONBOARDING_KEYS.length} onboarding steps completed after ${daysSinceActivation} day${daysSinceActivation === 1 ? "" : "s"}.`,
        recommendedAction:
          "Open the onboarding queue, contact the client if needed, and help them complete the next onboarding step.",
        href: "/dashboard/coaching?tab=onboarding",
        subject: {
          name: client.fullName || "Client",
          email: "",
          phone: "",
          context: `${completed}/${ONBOARDING_KEYS.length} onboarding steps complete`,
        },
        audienceRoles: ["admin", "coach", "staff"],
        ageDays: daysSinceActivation,
        thresholdDays: completed === 0 ? 1 : 3,
        lastDetectedAt: now,
      },
    });
    created += result.created;
    updated += result.updated;
  }

  autoResolved += await autoResolveMissing(
    "client_activation_inconsistent",
    activationKeys,
    now,
    "Automatically resolved because the client activation fields are now consistent."
  );
  autoResolved += await autoResolveMissing(
    "client_onboarding_stalled",
    onboardingKeys,
    now,
    "Automatically resolved because onboarding is complete, back on schedule, or the client is no longer active."
  );

  const qualificationResult = await scanQualificationReviewQueue(now);
  created += qualificationResult.created;
  updated += qualificationResult.updated;
  autoResolved += qualificationResult.autoResolved;

  const medicalResult = await scanMedicalReviewExceptions(now);
  created += medicalResult.created;
  updated += medicalResult.updated;
  autoResolved += medicalResult.autoResolved;

  const stalledResult = await scanStalledOpportunities(now);
  created += stalledResult.created;
  updated += stalledResult.updated;
  autoResolved += stalledResult.autoResolved;

  const whatsappWindowResult = await scanWhatsAppServiceWindow(now);
  created += whatsappWindowResult.created;
  updated += whatsappWindowResult.updated;
  autoResolved += whatsappWindowResult.autoResolved;

  const inboundKeys = [];
  const inboundWindow = new Date(now.getTime() - DAY);
  const stuckCutoff = new Date(now.getTime() - 10 * MINUTE);

  for (const provider of ["instagram", "whatsapp"]) {
    const [failed, stuck] = await Promise.all([
      InboundMessageReceipt.countDocuments({
        provider,
        status: "failed",
        updatedAt: { $gte: inboundWindow },
      }),
      InboundMessageReceipt.countDocuments({
        provider,
        status: "processing",
        createdAt: { $gte: inboundWindow, $lte: stuckCutoff },
      }),
    ]);

    if (!failed && !stuck) continue;

    const dedupeKey = `social_inbound_processing_health:${provider}`;
    inboundKeys.push(dedupeKey);
    const label = provider === "instagram" ? "Instagram" : "WhatsApp";
    const parts = [];
    if (failed) parts.push(`${failed} failed`);
    if (stuck) parts.push(`${stuck} stuck in processing`);

    const result = await upsertAlert({
      dedupeKey,
      now,
      payload: {
        ruleKey: "social_inbound_processing_health",
        entityType: "InboundMessageReceipt",
        entityId: provider,
        severity: failed ? "urgent" : "warning",
        title: `${label} inbound processing needs attention`,
        summary: `${parts.join(" and ")} inbound message${failed + stuck === 1 ? "" : "s"} in the last 24 hours.`,
        recommendedAction:
          "Check the Meta webhook configuration and backend logs before relying on this channel for new leads.",
        href: "/dashboard/action-centre",
        subject: {
          name: `${label} inbound`,
          email: "",
          phone: "",
          context: "Social lead intake health",
        },
        audienceRoles: ["admin", "sales"],
        ageDays: 0,
        thresholdDays: 0,
        lastDetectedAt: now,
      },
    });
    created += result.created;
    updated += result.updated;
  }

  autoResolved += await autoResolveMissing(
    "social_inbound_processing_health",
    inboundKeys,
    now,
    "Automatically resolved because no recent inbound processing failures remain in the monitoring window."
  );

  return {
    scannedTasks: activities.length,
    scannedActiveClients: clients.length,
    created,
    updated,
    autoResolved,
  };
}

export async function scanOperationalAlerts() {
  if (scanInFlight) return scanInFlight;
  scanInFlight = performScan().finally(() => {
    scanInFlight = null;
  });
  return scanInFlight;
}
