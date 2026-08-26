import Application from "../models/Application.js";
import CrmActivity from "../models/CrmActivity.js";
import CrmContact from "../models/CrmContact.js";
import CrmOpportunity from "../models/CrmOpportunity.js";
import { addCrmActivity, findCrmContact, syncApplicationToCrm } from "../services/crmService.js";
import { sendQualificationOutcomeCommunication } from "../services/qualificationCommunicationService.js";
import { dispatchWorkflowEvent } from "../services/workflowService.js";
import { logAudit } from "../utils/auditLogger.js";

const QUALIFICATION_RESULTS = ["qualified", "needs_review", "not_qualified"];
const NOT_QUALIFIED_DISPOSITIONS = ["nurture", "lost"];
const START_TIMELINES = ["asap", "within_2_weeks", "within_a_month", "exploring"];
const READY_TO_SPEAK = ["yes", "questions", "not_yet"];
const READY_START_TIMELINES = new Set(["asap", "within_2_weeks", "within_a_month"]);
const ADVANCED_STAGES = new Set([
  "consultation_booked",
  "consultation_completed",
  "medical_review",
  "payment_pending",
]);

function badRequest(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

function normalizeReasons(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw badRequest("Qualification reasons must be a list.");
  }

  const reasons = [...new Set(
    value
      .map((item) => String(item || "").trim())
      .filter(Boolean)
  )];

  if (reasons.length > 8 || reasons.some((reason) => reason.length > 160)) {
    throw badRequest("Use no more than 8 qualification reasons, with each reason under 160 characters.");
  }

  return reasons;
}

function normalizeAnswers(value) {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw badRequest("Qualification answers must be a structured object.");
  }

  const encoded = JSON.stringify(value);
  if (encoded.length > 20000) {
    throw badRequest("Qualification answers are too large.");
  }

  return value;
}

function qualificationV1Recommendation(rawAnswers) {
  const answers = normalizeAnswers(rawAnswers);
  const startTimeline = String(answers?.startTimeline || "").trim();
  const readyToSpeak = String(answers?.readyToSpeak || "").trim();

  if (!START_TIMELINES.includes(startTimeline)) {
    throw badRequest("Answer when the applicant would ideally like to get started.");
  }
  if (!READY_TO_SPEAK.includes(readyToSpeak)) {
    throw badRequest("Answer whether the applicant is ready to speak with Khairo Diet Clinic about the next step.");
  }

  if (readyToSpeak === "yes" && READY_START_TIMELINES.has(startTimeline)) {
    return {
      result: "qualified",
      disposition: "none",
      label: "Qualified",
      reasons: [
        "Ready to speak with Khairo Diet Clinic about the next step",
        "Wants to start within one month",
      ],
    };
  }

  if (readyToSpeak === "not_yet" || (startTimeline === "exploring" && readyToSpeak !== "yes")) {
    return {
      result: "not_qualified",
      disposition: "nurture",
      label: "Nurture",
      reasons: [
        readyToSpeak === "not_yet"
          ? "Not ready to speak with Khairo Diet Clinic yet"
          : "Still exploring timing and has questions before the next step",
      ],
    };
  }

  return {
    result: "needs_review",
    disposition: "none",
    label: "Needs Review",
    reasons: [
      readyToSpeak === "questions"
        ? "Has questions before taking the next step"
        : "Interest and timing signals need staff review",
    ],
  };
}

async function resolveApplicationCrm(application, actor) {
  let contact = await findCrmContact({
    email: application.email,
    phone: application.phone,
  });

  let opportunity = contact
    ? await CrmOpportunity.findOne({ contact: contact._id })
        .sort({ updatedAt: -1 })
    : null;

  if (!contact || !opportunity) {
    return syncApplicationToCrm(application, actor);
  }

  let contactChanged = false;
  if (!contact.application || String(contact.application) !== String(application._id)) {
    contact.application = application._id;
    contactChanged = true;
  }
  if (contact.lifecycleStage === "lead") {
    contact.lifecycleStage = "applicant";
    contactChanged = true;
  }
  if (actor.userId) {
    contact.updatedBy = actor.userId;
    contactChanged = true;
  }
  if (contactChanged) await contact.save();

  let opportunityChanged = false;
  if (!opportunity.application || String(opportunity.application) !== String(application._id)) {
    opportunity.application = application._id;
    opportunityChanged = true;
  }
  if (actor.userId) {
    opportunity.updatedBy = actor.userId;
    opportunityChanged = true;
  }
  if (opportunityChanged) await opportunity.save();

  return { contact, opportunity };
}

function targetStageForDecision(result, disposition) {
  if (result === "qualified") return "qualified";
  if (result === "needs_review") return "qualification";
  return disposition;
}

function decisionLabel(result, disposition) {
  if (result === "qualified") return "Qualified";
  if (result === "needs_review") return "Needs review";
  return disposition === "lost" ? "Not qualified — Lost" : "Not qualified — Nurture";
}

export const recommendQualification = async (req, res, next) => {
  try {
    const application = await Application.findById(req.params.id).select("_id");
    if (!application) {
      return res.status(404).json({ success: false, message: "Application not found." });
    }

    const recommendation = qualificationV1Recommendation(req.body?.answers);

    res.status(200).json({
      success: true,
      questionnaireVersion: "v1",
      recommendation,
    });
  } catch (error) {
    if (error?.statusCode) {
      return res.status(error.statusCode).json({ success: false, message: error.message });
    }
    next(error);
  }
};

export const recordQualificationDecision = async (req, res, next) => {
  try {
    const application = await Application.findById(req.params.id);
    if (!application) {
      return res.status(404).json({ success: false, message: "Application not found." });
    }

    const result = String(req.body?.result || "").trim();
    if (!QUALIFICATION_RESULTS.includes(result)) {
      return res.status(400).json({
        success: false,
        message: "Choose Qualified, Needs Review, or Not Qualified.",
      });
    }

    const disposition = result === "not_qualified"
      ? String(req.body?.disposition || "").trim()
      : "none";

    if (result === "not_qualified" && !NOT_QUALIFIED_DISPOSITIONS.includes(disposition)) {
      return res.status(400).json({
        success: false,
        message: "For Not Qualified, choose whether the lead should be nurtured or closed as lost.",
      });
    }

    const answers = normalizeAnswers(req.body?.answers);
    const reviewNotes = String(req.body?.reviewNotes || "").trim();
    const questionnaireVersion = String(req.body?.questionnaireVersion || application.qualification?.questionnaireVersion || "v1").trim();

    if (reviewNotes.length > 2000) {
      return res.status(400).json({ success: false, message: "Qualification notes must be 2000 characters or fewer." });
    }
    if (!questionnaireVersion || questionnaireVersion.length > 40) {
      return res.status(400).json({ success: false, message: "Choose a valid qualification questionnaire version." });
    }

    const recommendation = questionnaireVersion === "v1"
      ? qualificationV1Recommendation(answers)
      : null;
    const suppliedReasons = normalizeReasons(req.body?.reasons);
    const reasons = suppliedReasons.length
      ? suppliedReasons
      : (recommendation?.reasons || []);

    const actor = {
      userId: req.user._id,
      userName: req.user.name,
    };
    const { contact, opportunity } = await resolveApplicationCrm(application, actor);
    const previousStage = opportunity.stage;
    const requestedStage = targetStageForDecision(result, disposition);

    if (ADVANCED_STAGES.has(previousStage) && result !== "qualified") {
      return res.status(409).json({
        success: false,
        message: "This lead has already advanced beyond qualification. Use a deliberate CRM stage action instead of moving them backward through qualification.",
        currentStage: previousStage,
      });
    }

    const targetStage = ADVANCED_STAGES.has(previousStage) && result === "qualified"
      ? previousStage
      : requestedStage;

    application.qualification = {
      questionnaireVersion,
      answers: answers !== undefined ? answers : (application.qualification?.answers || {}),
      result,
      reasons,
      disposition,
      reviewNotes,
      reviewedBy: req.user._id,
      reviewedAt: new Date(),
    };
    await application.save();

    if (opportunity.stage !== targetStage) {
      opportunity.stage = targetStage;
      opportunity.stageEnteredAt = new Date();
    }

    if (targetStage === "lost") {
      opportunity.status = "lost";
      opportunity.closedAt = new Date();
      opportunity.lostReason = reviewNotes || reasons.join("; ") || "Not qualified";
    } else if (opportunity.status === "lost") {
      opportunity.status = "open";
      opportunity.closedAt = undefined;
      opportunity.lostReason = "";
    }

    opportunity.updatedBy = req.user._id;
    await opportunity.save();

    if (previousStage !== targetStage) {
      await addCrmActivity({
        contact,
        opportunity,
        type: "stage_change",
        subject: "Qualification stage changed",
        body: `Qualification moved the pipeline from ${previousStage} to ${targetStage}.`,
        createdBy: req.user._id,
        metadata: {
          from: previousStage,
          to: targetStage,
          event: "qualification_decision",
          applicationId: application._id.toString(),
          result,
        },
      });

      dispatchWorkflowEvent({
        type: "crm_stage_changed",
        eventKey: `crm_stage_changed:${opportunity._id}:qualification:${application.qualification.reviewedAt.getTime()}`,
        contactId: contact._id,
        opportunityId: opportunity._id,
        actorUserId: req.user._id,
        actorName: req.user.name,
        data: {
          fromStage: previousStage,
          toStage: targetStage,
          programInterest: opportunity.programInterest,
          qualificationResult: result,
        },
      }).catch((error) => console.error("Qualification workflow stage trigger failed:", error.message));
    }

    await addCrmActivity({
      contact,
      opportunity,
      type: "system",
      subject: "Qualification decision recorded",
      body: `${decisionLabel(result, disposition)}${reasons.length ? `. Reasons: ${reasons.join("; ")}` : ""}${reviewNotes ? `. Notes: ${reviewNotes}` : ""}`,
      createdBy: req.user._id,
      metadata: {
        event: "qualification_decision",
        applicationId: application._id.toString(),
        questionnaireVersion,
        result,
        disposition,
        reasons,
        recommendedResult: recommendation?.result || "",
        recommendedDisposition: recommendation?.disposition || "none",
      },
    });

    const communication = await sendQualificationOutcomeCommunication({
      application,
      contact,
      opportunity,
      result,
      disposition,
      actorUserId: req.user._id,
    });

    if (result === "needs_review") {
      const existingTask = await CrmActivity.exists({
        contact: contact._id,
        type: "task",
        completedAt: { $exists: false },
        "metadata.event": "qualification_review_required",
        "metadata.applicationId": application._id.toString(),
      });

      if (!existingTask) {
        await addCrmActivity({
          contact,
          opportunity,
          type: "task",
          subject: "Review qualification",
          body: "Review the qualification information and record a final Qualified or Not Qualified decision.",
          dueAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
          assignedTo: opportunity.assignedTo || contact.assignedTo,
          createdBy: req.user._id,
          metadata: {
            event: "qualification_review_required",
            applicationId: application._id.toString(),
          },
        });
      }
    }

    await logAudit(
      req,
      "Recorded qualification decision",
      "Application",
      application._id.toString(),
      `${decisionLabel(result, disposition)}${reasons.length ? ` — ${reasons.join("; ")}` : ""}`
    );

    res.status(200).json({
      success: true,
      qualification: application.qualification,
      recommendation,
      communication,
      opportunity: {
        _id: opportunity._id,
        stage: opportunity.stage,
        status: opportunity.status,
        stageEnteredAt: opportunity.stageEnteredAt,
      },
    });
  } catch (error) {
    if (error?.statusCode) {
      return res.status(error.statusCode).json({ success: false, message: error.message });
    }
    next(error);
  }
};
