import CrmContact from "../models/CrmContact.js";
import CrmOpportunity from "../models/CrmOpportunity.js";
import { addCrmActivity } from "../services/crmService.js";
import { dispatchWorkflowEvent } from "../services/workflowService.js";
import { logAudit } from "../utils/auditLogger.js";

const BOOKABLE_STAGES = new Set(["qualified", "consultation_booked"]);
const CONSULTATION_CHANNELS = new Set(["phone", "video", "in_person"]);
const OUTCOME_TARGETS = {
  completed: "consultation_completed",
  nurture: "nurture",
  lost: "lost",
};

function parseScheduledAt(value) {
  if (!value || typeof value !== "string") {
    return { error: "Choose a consultation date and time." };
  }

  if (!/(?:Z|[+-]\d{2}:\d{2})$/i.test(value.trim())) {
    return { error: "Consultation date and time must include a timezone." };
  }

  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    return { error: "Choose a valid consultation date and time." };
  }

  if (date.getTime() <= Date.now()) {
    return { error: "Consultation date and time must be in the future." };
  }

  return { value: date };
}

async function getContactAndOpportunity(contactId) {
  const contact = await CrmContact.findOne({
    _id: contactId,
    isArchived: false,
  });

  if (!contact) return { errorStatus: 404, message: "CRM contact not found." };

  const opportunity = await CrmOpportunity.findOne({
    contact: contact._id,
    status: "open",
  }).sort({ updatedAt: -1 });

  if (!opportunity) {
    return {
      errorStatus: 409,
      message: "This contact does not have an open CRM opportunity.",
    };
  }

  return { contact, opportunity };
}

async function recordStageChange({ req, contact, opportunity, fromStage, toStage, event }) {
  await addCrmActivity({
    contact,
    opportunity,
    type: "stage_change",
    subject: "Pipeline stage changed",
    body: `Stage moved from ${fromStage} to ${toStage} by ${event}.`,
    createdBy: req.user._id,
    metadata: {
      from: fromStage,
      to: toStage,
      event,
    },
  });

  await logAudit(
    req,
    "Moved CRM opportunity",
    "CrmOpportunity",
    opportunity._id.toString(),
    `${fromStage} → ${toStage}`
  );

  dispatchWorkflowEvent({
    type: "crm_stage_changed",
    eventKey: `crm_stage_changed:${opportunity._id}:${opportunity.updatedAt?.getTime?.() || Date.now()}`,
    contactId: contact._id,
    opportunityId: opportunity._id,
    actorUserId: req.user._id,
    actorName: req.user.name,
    data: {
      fromStage,
      toStage,
      programInterest: opportunity.programInterest,
      consultationEvent: event,
    },
  }).catch((error) =>
    console.error("Consultation workflow stage trigger failed:", error.message)
  );
}

export const bookCrmConsultation = async (req, res, next) => {
  try {
    const resolved = await getContactAndOpportunity(req.params.id);
    if (resolved.errorStatus) {
      return res.status(resolved.errorStatus).json({
        success: false,
        message: resolved.message,
      });
    }

    const { contact, opportunity } = resolved;

    if (!BOOKABLE_STAGES.has(opportunity.stage)) {
      return res.status(409).json({
        success: false,
        message: `Consultations can be booked only after qualification. Current stage: ${opportunity.stage}.`,
      });
    }

    const parsed = parseScheduledAt(req.body?.scheduledAt);
    if (parsed.error) {
      return res.status(400).json({ success: false, message: parsed.error });
    }

    const channel = String(req.body?.channel || "video").trim().toLowerCase();
    if (!CONSULTATION_CHANNELS.has(channel)) {
      return res.status(400).json({
        success: false,
        message: "Choose phone, video, or in-person consultation.",
      });
    }

    const location = String(req.body?.location || "").trim().slice(0, 500);
    const notes = String(req.body?.notes || "").trim().slice(0, 2000);
    const previousStage = opportunity.stage;
    const rescheduled = previousStage === "consultation_booked";

    opportunity.stage = "consultation_booked";
    if (previousStage !== "consultation_booked") {
      opportunity.stageEnteredAt = new Date();
    }
    opportunity.status = "open";
    opportunity.closedAt = undefined;
    opportunity.lostReason = "";
    opportunity.nextFollowUpAt = parsed.value;
    opportunity.updatedBy = req.user._id;
    await opportunity.save();

    await addCrmActivity({
      contact,
      opportunity,
      type: "meeting",
      subject: rescheduled ? "Consultation rescheduled" : "Consultation booked",
      body: [
        `${rescheduled ? "Consultation rescheduled" : "Consultation booked"} for ${parsed.value.toISOString()}.`,
        `Format: ${channel.replace("_", " ")}.`,
        location ? `Location/link: ${location}.` : "",
        notes ? `Notes: ${notes}` : "",
      ]
        .filter(Boolean)
        .join(" "),
      dueAt: parsed.value,
      assignedTo: opportunity.assignedTo || contact.assignedTo,
      createdBy: req.user._id,
      metadata: {
        event: "crm_consultation_booking",
        scheduledAt: parsed.value,
        channel,
        location,
        rescheduled,
      },
    });

    if (previousStage !== "consultation_booked") {
      await recordStageChange({
        req,
        contact,
        opportunity,
        fromStage: previousStage,
        toStage: "consultation_booked",
        event: "consultation booking",
      });
    }

    dispatchWorkflowEvent({
      type: "appointment_booked",
      eventKey: `appointment_booked:${opportunity._id}:${parsed.value.toISOString()}`,
      contactId: contact._id,
      opportunityId: opportunity._id,
      actorUserId: req.user._id,
      actorName: req.user.name,
      data: {
        programInterest: opportunity.programInterest,
        scheduledAt: parsed.value.toISOString(),
        channel,
        rescheduled,
      },
    }).catch((error) =>
      console.error("Appointment booked workflow trigger failed:", error.message)
    );

    await logAudit(
      req,
      rescheduled ? "Rescheduled CRM consultation" : "Booked CRM consultation",
      "CrmOpportunity",
      opportunity._id.toString(),
      `${contact.fullName}: ${parsed.value.toISOString()}`
    );

    await opportunity.populate("assignedTo", "name roles");

    res.status(200).json({
      success: true,
      rescheduled,
      scheduledAt: parsed.value,
      opportunity,
    });
  } catch (err) {
    next(err);
  }
};

export const cancelCrmConsultation = async (req, res, next) => {
  try {
    const resolved = await getContactAndOpportunity(req.params.id);
    if (resolved.errorStatus) {
      return res.status(resolved.errorStatus).json({ success: false, message: resolved.message });
    }

    const { contact, opportunity } = resolved;
    if (opportunity.stage !== "consultation_booked") {
      return res.status(409).json({
        success: false,
        message: `Only a booked consultation can be cancelled. Current stage: ${opportunity.stage}.`,
      });
    }

    const reason = String(req.body?.reason || "").trim().slice(0, 1000);
    if (!reason) {
      return res.status(400).json({ success: false, message: "Add a brief cancellation reason." });
    }

    const previousStage = opportunity.stage;
    const previousScheduledAt = opportunity.nextFollowUpAt;
    const rebookDueAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    opportunity.stage = "qualified";
    opportunity.stageEnteredAt = new Date();
    opportunity.nextFollowUpAt = rebookDueAt;
    opportunity.updatedBy = req.user._id;
    await opportunity.save();

    await addCrmActivity({
      contact,
      opportunity,
      type: "meeting",
      subject: "Consultation cancelled",
      body: `Consultation${previousScheduledAt ? ` scheduled for ${new Date(previousScheduledAt).toISOString()}` : ""} was cancelled. Reason: ${reason}`,
      createdBy: req.user._id,
      metadata: {
        event: "crm_consultation_cancelled",
        scheduledAt: previousScheduledAt,
        reason,
      },
    });

    const followUpTask = await addCrmActivity({
      contact,
      opportunity,
      type: "task",
      subject: "Rebook consultation",
      body: `Follow up with ${contact.fullName} to rebook the cancelled consultation.`,
      dueAt: rebookDueAt,
      assignedTo: opportunity.assignedTo || contact.assignedTo,
      createdBy: req.user._id,
      metadata: {
        event: "crm_consultation_rebook_required",
        cancelledScheduledAt: previousScheduledAt,
      },
    });

    await recordStageChange({
      req,
      contact,
      opportunity,
      fromStage: previousStage,
      toStage: "qualified",
      event: "consultation cancellation",
    });

    await logAudit(
      req,
      "Cancelled CRM consultation",
      "CrmOpportunity",
      opportunity._id.toString(),
      `${contact.fullName}: ${reason}`
    );

    await opportunity.populate("assignedTo", "name roles");
    return res.status(200).json({ success: true, followUpTask, opportunity });
  } catch (err) {
    next(err);
  }
};

export const recordCrmConsultationOutcome = async (req, res, next) => {
  try {
    const resolved = await getContactAndOpportunity(req.params.id);
    if (resolved.errorStatus) {
      return res.status(resolved.errorStatus).json({
        success: false,
        message: resolved.message,
      });
    }

    const { contact, opportunity } = resolved;

    if (opportunity.stage !== "consultation_booked") {
      return res.status(409).json({
        success: false,
        message: `Consultation outcomes can be recorded only while the lead is in Consultation Booked. Current stage: ${opportunity.stage}.`,
      });
    }

    const outcome = String(req.body?.outcome || "").trim().toLowerCase();
    const notes = String(req.body?.notes || "").trim().slice(0, 2000);

    if (!["completed", "no_show", "nurture", "lost"].includes(outcome)) {
      return res.status(400).json({
        success: false,
        message: "Choose completed, no_show, nurture, or lost.",
      });
    }

    const previousStage = opportunity.stage;
    let targetStage = previousStage;
    let followUpTask = null;

    if (outcome === "no_show") {
      const dueAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
      opportunity.nextFollowUpAt = dueAt;
      opportunity.updatedBy = req.user._id;
      await opportunity.save();

      followUpTask = await addCrmActivity({
        contact,
        opportunity,
        type: "task",
        subject: "Follow up after missed consultation",
        body: `Follow up with ${contact.fullName} after the missed consultation.`,
        dueAt,
        assignedTo: opportunity.assignedTo || contact.assignedTo,
        createdBy: req.user._id,
        metadata: {
          event: "crm_consultation_no_show_follow_up",
          consultationOutcome: "no_show",
        },
      });
    } else {
      targetStage = OUTCOME_TARGETS[outcome];
      opportunity.stage = targetStage;
      opportunity.stageEnteredAt = new Date();
      opportunity.nextFollowUpAt = undefined;
      opportunity.updatedBy = req.user._id;

      if (targetStage === "lost") {
        opportunity.status = "lost";
        opportunity.closedAt = new Date();
        opportunity.lostReason = notes || "Consultation outcome: Lost";
      } else {
        opportunity.status = "open";
        opportunity.closedAt = undefined;
        opportunity.lostReason = "";
      }

      await opportunity.save();

      await recordStageChange({
        req,
        contact,
        opportunity,
        fromStage: previousStage,
        toStage: targetStage,
        event: "consultation outcome",
      });
    }

    const outcomeLabel = {
      completed: "Completed",
      no_show: "No-show",
      nurture: "Nurture",
      lost: "Lost",
    }[outcome];

    await addCrmActivity({
      contact,
      opportunity,
      type: "system",
      subject: "Consultation outcome",
      body: `${outcomeLabel} recorded by ${req.user.name || "staff"}.${notes ? ` Notes: ${notes}` : ""}`,
      createdBy: req.user._id,
      metadata: {
        event: "crm_consultation_outcome",
        outcome,
        fromStage: previousStage,
        toStage: targetStage,
        followUpTaskId: followUpTask?._id,
      },
    });

    if (outcome === "completed" || outcome === "no_show") {
      dispatchWorkflowEvent({
        type: outcome === "completed" ? "appointment_completed" : "appointment_no_show",
        eventKey: `appointment_${outcome}:${opportunity._id}:${Date.now()}`,
        contactId: contact._id,
        opportunityId: opportunity._id,
        actorUserId: req.user._id,
        actorName: req.user.name,
        data: {
          programInterest: opportunity.programInterest,
          outcome,
          toStage: targetStage,
        },
      }).catch((error) =>
        console.error("Appointment outcome workflow trigger failed:", error.message)
      );
    }

    await logAudit(
      req,
      "Recorded CRM consultation outcome",
      "CrmOpportunity",
      opportunity._id.toString(),
      `${contact.fullName}: ${outcomeLabel}`
    );

    await opportunity.populate("assignedTo", "name roles");

    res.status(200).json({
      success: true,
      outcome,
      followUpTask,
      opportunity,
    });
  } catch (err) {
    next(err);
  }
};
