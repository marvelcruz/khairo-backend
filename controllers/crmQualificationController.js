import Application from "../models/Application.js";
import CrmActivity from "../models/CrmActivity.js";
import CrmContact from "../models/CrmContact.js";
import CrmOpportunity from "../models/CrmOpportunity.js";
import { addCrmActivity } from "../services/crmService.js";
import { dispatchWorkflowEvent } from "../services/workflowService.js";
import { logAudit } from "../utils/auditLogger.js";

const DECISION_STAGE = {
  qualified: "qualified",
  nurture: "nurture",
  lost: "lost",
};

const DECISION_LABEL = {
  qualified: "Qualified",
  nurture: "Nurture",
  lost: "Lost",
};

export const recordQualificationDecision = async (req, res, next) => {
  try {
    const decision = String(req.body?.decision || "").trim().toLowerCase();
    const targetStage = DECISION_STAGE[decision];

    if (!targetStage) {
      return res.status(400).json({
        success: false,
        message: "Choose a valid qualification decision: qualified, nurture, or lost.",
      });
    }

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

    if (contact.application) {
      const linkedApplication = await Application.exists({ _id: contact.application });
      if (linkedApplication) {
        return res.status(409).json({
          success: false,
          code: "application_qualification_required",
          message: "This lead is linked to an application. Record the qualification decision in Applications so the questionnaire, recommendation, and audit record remain the single source of truth.",
          applicationId: String(contact.application),
        });
      }
    }

    const opportunity = await CrmOpportunity.findOne({
      contact: contact._id,
      status: "open",
    }).sort({ updatedAt: -1 });

    if (!opportunity) {
      return res.status(409).json({
        success: false,
        message: "This lead does not have an open CRM opportunity.",
      });
    }

    if (opportunity.stage !== "qualification") {
      return res.status(409).json({
        success: false,
        message: `Qualification decisions can only be recorded while the lead is in Qualification. Current stage: ${opportunity.stage}.`,
      });
    }

    const now = new Date();
    const previousStage = opportunity.stage;
    const reason = String(req.body?.reason || "").trim();

    opportunity.stage = targetStage;
    opportunity.stageEnteredAt = now;
    opportunity.updatedBy = req.user._id;

    if (targetStage === "lost") {
      opportunity.status = "lost";
      opportunity.closedAt = now;
      opportunity.nextFollowUpAt = undefined;
      opportunity.lostReason = reason || "Qualification decision: Lost";
    } else {
      opportunity.status = "open";
      opportunity.closedAt = undefined;
      opportunity.lostReason = "";
    }

    await opportunity.save();

    const reviewTaskResult = await CrmActivity.updateMany(
      {
        contact: contact._id,
        type: "task",
        subject: /^Review qualification$/i,
        $or: [
          { completedAt: { $exists: false } },
          { completedAt: null },
        ],
      },
      { $set: { completedAt: now } }
    );

    contact.lastActivityAt = now;
    contact.updatedBy = req.user._id;
    await contact.save();

    await addCrmActivity({
      contact,
      opportunity,
      type: "stage_change",
      subject: "Pipeline stage changed",
      body: `Stage moved from ${previousStage} to ${targetStage} by qualification decision.`,
      createdBy: req.user._id,
      metadata: {
        from: previousStage,
        to: targetStage,
        event: "qualification_decision",
      },
    });

    await addCrmActivity({
      contact,
      opportunity,
      type: "system",
      subject: "Qualification decision",
      body: `${DECISION_LABEL[decision]} selected by ${req.user.name || "staff"}.${reason ? ` Reason: ${reason}` : ""}`,
      createdBy: req.user._id,
      metadata: {
        event: "qualification_decision",
        decision,
        completedReviewTasks: reviewTaskResult.modifiedCount || 0,
      },
    });

    await logAudit(
      req,
      "Recorded qualification decision",
      "CrmOpportunity",
      opportunity._id.toString(),
      `${contact.fullName}: ${DECISION_LABEL[decision]}`
    );

    dispatchWorkflowEvent({
      type: "crm_stage_changed",
      eventKey: `crm_stage_changed:${opportunity._id}:${opportunity.updatedAt?.getTime?.() || Date.now()}`,
      contactId: contact._id,
      opportunityId: opportunity._id,
      actorUserId: req.user._id,
      actorName: req.user.name,
      data: {
        fromStage: previousStage,
        toStage: targetStage,
        programInterest: opportunity.programInterest,
        qualificationDecision: decision,
      },
    }).catch((error) =>
      console.error("Workflow qualification decision trigger failed:", error.message)
    );

    await opportunity.populate("assignedTo", "name roles");

    res.status(200).json({
      success: true,
      decision,
      completedReviewTasks: reviewTaskResult.modifiedCount || 0,
      opportunity,
    });
  } catch (err) {
    next(err);
  }
};
