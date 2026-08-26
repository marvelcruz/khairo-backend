import CrmOpportunity from "../models/CrmOpportunity.js";
import MedicalReviewCase from "../models/MedicalReviewCase.js";
import { addCrmActivity } from "../services/crmService.js";
import { notifyMedicalReviewScheduled } from "../services/medicalReviewNotificationService.js";
import { dispatchWorkflowEvent } from "../services/workflowService.js";
import { logAudit } from "../utils/auditLogger.js";



function parseLines(value, maxItems = 20) {
  if (!value) return [];
  const lines = String(value).split("\n").map((line) => line.trim()).filter(Boolean);
  return lines.slice(0, maxItems);
}

function cleanStructuredClinicalInput(body) {
  const output = {};

  const vitalsKeys = [
    "heightCm",
    "weightKg",
    "heartRate",
    "temperatureC",
    "bloodGlucoseMmol",
  ];

  if (body.vitals && typeof body.vitals === "object") {
    output.vitals = {};
    for (const key of vitalsKeys) {
      const num = Number(body.vitals[key]);
      output.vitals[key] = Number.isFinite(num) && num >= 0 ? num : undefined;
    }
    output.vitals.bloodPressure = String(body.vitals.bloodPressure || "").trim().slice(0, 40);
    output.vitals.notes = String(body.vitals.notes || "").trim().slice(0, 1000);
  }

  if (body.allergies) {
    output.allergies = parseLines(body.allergies).map((line) => ({
      substance: line.slice(0, 200),
      reaction: "",
      severity: "mild",
    }));
  }

  if (body.problemList) {
    output.problemList = parseLines(body.problemList).map((line) => ({
      diagnosis: line.slice(0, 300),
      status: "active",
      notes: "",
    }));
  }

  if (body.medicationHistory) {
    output.medicationHistory = parseLines(body.medicationHistory).map((line) => ({
      name: line.slice(0, 200),
      dose: "",
      frequency: "",
      prescriber: "",
      ongoing: true,
    }));
  }

  if (body.safetyFlags) {
    output.safetyFlags = parseLines(body.safetyFlags).map((line) => ({
      type: line.slice(0, 200),
      severity: "info",
      note: "",
    }));
  }

  if (body.clinicalConsent && typeof body.clinicalConsent === "object") {
    output.clinicalConsent = {
      consentGiven: Boolean(body.clinicalConsent.consentGiven),
      consentScope: String(body.clinicalConsent.consentScope || "").trim().slice(0, 2000),
      consentAt: body.clinicalConsent.consentGiven ? new Date() : undefined,
      consentBy: body.clinicalConsent.consentGiven ? undefined : undefined,
      consentByName: body.clinicalConsent.consentGiven ? undefined : undefined,
    };
  }

  return output;
}

const CLINICAL_ATTESTATION =
  "I confirm that I personally completed this medical review record and that it accurately reflects my clinical assessment at the time of signing.";

function parseFutureDate(value) {
  if (!value || typeof value !== "string") {
    return { error: "Choose a medical review date and time." };
  }
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return { error: "Choose a valid date and time." };
  if (date.getTime() <= Date.now()) return { error: "Medical review must be scheduled in the future." };
  return { value: date };
}

function parseCompletedDate(value) {
  if (!value || typeof value !== "string") {
    return { error: "Enter when the medical review meeting was completed." };
  }
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return { error: "Enter a valid meeting completion date and time." };
  if (date.getTime() > Date.now()) return { error: "Meeting completion time cannot be in the future." };
  return { value: date };
}

function isDoctorOnly(req) {
  const roles = req.user?.roles || [];
  return roles.includes("doctor") && !roles.includes("admin");
}

function doctorRestrictedQuery(req) {
  if (isDoctorOnly(req)) {
    return { assignedDoctor: req.user._id };
  }
  return {};
}

function assignedDoctorId(medicalCase) {
  return String(medicalCase?.assignedDoctor?._id || medicalCase?.assignedDoctor || "");
}

function requireAssignedDoctor(req, medicalCase) {
  const roles = req.user?.roles || [];
  if (!roles.includes("doctor")) {
    return "Only a doctor can complete clinical medical-review actions.";
  }
  if (!medicalCase?.assignedDoctor || assignedDoctorId(medicalCase) !== String(req.user._id)) {
    return "Only the doctor assigned to this medical review can complete this clinical action.";
  }
  return "";
}

function sanitizeMedicalCaseForResponse(req, medicalCase) {
  if (!medicalCase) return medicalCase;
  const output = typeof medicalCase.toObject === "function"
    ? medicalCase.toObject()
    : JSON.parse(JSON.stringify(medicalCase));

  if (isDoctorOnly(req) && output?.contact) {
    delete output.contact.email;
    delete output.contact.phone;
  }

  return output;
}

async function populatedCaseById(req, id) {
  return MedicalReviewCase.findOne({
    _id: id,
    ...doctorRestrictedQuery(req),
  })
    .populate("assignedDoctor", "name email phone roles")
    .populate("contact", "fullName email phone programInterest tags")
    .populate("opportunity", "stage programInterest assignedTo");
}

function trimmed(value, max) {
  return String(value || "").trim().slice(0, max);
}

function signatureError(req) {
  if (req.body?.attest !== true) {
    return "Confirm the clinical-record attestation before signing.";
  }
  const signatureName = trimmed(req.body?.signatureName, 200);
  const userName = trimmed(req.user?.name, 200);
  if (!signatureName || signatureName.toLowerCase() !== userName.toLowerCase()) {
    return "Type your account name exactly as shown to sign this medical record.";
  }
  return "";
}

function latestSignedFollowUp(medicalCase) {
  const followUps = (medicalCase.addenda || [])
    .filter((entry) => entry.kind === "follow_up" && entry.signedAt && entry.meetingCompletedAt)
    .sort((a, b) => new Date(b.signedAt).getTime() - new Date(a.signedAt).getTime());
  return followUps[0] || null;
}

export const listMedicalReviews = async (req, res, next) => {
  try {
    const query = { ...doctorRestrictedQuery(req) };
    if (req.query.status) query.status = String(req.query.status);

    const cases = await MedicalReviewCase.find(query)
      .sort({ scheduledAt: 1, createdAt: 1 })
      .populate("assignedDoctor", "name email phone roles")
      .populate("contact", "fullName email phone programInterest tags")
      .populate("opportunity", "stage programInterest assignedTo");

    res.status(200).json({
      success: true,
      cases: cases.map((medicalCase) => sanitizeMedicalCaseForResponse(req, medicalCase)),
    });
  } catch (err) {
    next(err);
  }
};

export const getMedicalReview = async (req, res, next) => {
  try {
    const medicalCase = await populatedCaseById(req, req.params.id);
    if (!medicalCase) {
      return res.status(404).json({ success: false, message: "Medical review case not found." });
    }
    res.status(200).json({
      success: true,
      case: sanitizeMedicalCaseForResponse(req, medicalCase),
    });
  } catch (err) {
    next(err);
  }
};

export const scheduleMedicalReview = async (req, res, next) => {
  try {
    const medicalCase = await populatedCaseById(req, req.params.id);
    if (!medicalCase) {
      return res.status(404).json({ success: false, message: "Medical review case not found." });
    }
    if (!medicalCase.assignedDoctor) {
      return res.status(409).json({ success: false, message: "Assign a doctor before scheduling." });
    }
    if (medicalCase.status === "completed") {
      return res.status(409).json({ success: false, message: "Completed medical reviews cannot be rescheduled." });
    }

    const parsed = parseFutureDate(req.body?.scheduledAt);
    if (parsed.error) return res.status(400).json({ success: false, message: parsed.error });

    const provider = String(req.body?.meetingProvider || "video").trim().toLowerCase();
    if (!["video", "phone", "in_person"].includes(provider)) {
      return res.status(400).json({ success: false, message: "Choose video, phone, or in-person." });
    }

    const meetingUrl = trimmed(req.body?.meetingUrl, 1000);
    if (provider === "video" && !meetingUrl) {
      return res.status(400).json({ success: false, message: "Add the video meeting link." });
    }

    const notes = trimmed(req.body?.notes, 3000);
    const rescheduled = medicalCase.status === "scheduled";
    medicalCase.scheduledAt = parsed.value;
    medicalCase.meetingProvider = provider;
    medicalCase.meetingUrl = meetingUrl;
    medicalCase.schedulingNotes = notes;
    medicalCase.status = "scheduled";
    medicalCase.updatedBy = req.user._id;
    await medicalCase.save();

    const contact = medicalCase.contact;
    const opportunity = medicalCase.opportunity;
    const doctor = medicalCase.assignedDoctor;

    await addCrmActivity({
      contact,
      opportunity,
      type: "meeting",
      subject: rescheduled ? "Medical review rescheduled" : "Medical review scheduled",
      body: [
        `${rescheduled ? "Medical review rescheduled" : "Medical review scheduled"} for ${parsed.value.toISOString()}.`,
        `Format: ${provider.replace("_", " ")}.`,
        meetingUrl ? `Meeting: ${meetingUrl}.` : "",
        notes ? `Scheduling notes: ${notes}` : "",
      ].filter(Boolean).join(" "),
      dueAt: parsed.value,
      assignedTo: doctor._id,
      createdBy: req.user._id,
      metadata: {
        event: "medical_review_scheduled",
        medicalReviewCaseId: String(medicalCase._id),
        rescheduled,
      },
    });

    const notification = await notifyMedicalReviewScheduled({
      medicalCase,
      doctor,
      contact,
    });

    await addCrmActivity({
      contact,
      opportunity,
      type: "system",
      subject: "Medical review meeting notification",
      body: `Meeting notifications processed. Doctor push: ${notification.doctorPush?.status || "unknown"}. Doctor email: ${notification.doctorEmail?.status || "unknown"}. Client email: ${notification.clientEmail?.status || "unknown"}.`,
      assignedTo: doctor._id,
      createdBy: req.user._id,
      metadata: {
        event: "medical_review_meeting_notification",
        medicalReviewCaseId: String(medicalCase._id),
        ...notification,
      },
    });

    await logAudit(
      req,
      rescheduled ? "Rescheduled medical review" : "Scheduled medical review",
      "MedicalReviewCase",
      medicalCase._id.toString(),
      `${contact.fullName}: ${parsed.value.toISOString()}`
    );

    res.status(200).json({
      success: true,
      rescheduled,
      case: sanitizeMedicalCaseForResponse(req, medicalCase),
    });
  } catch (err) {
    next(err);
  }
};

export const signMedicalReviewRecord = async (req, res, next) => {
  try {
    const medicalCase = await populatedCaseById(req, req.params.id);
    if (!medicalCase) {
      return res.status(404).json({ success: false, message: "Medical review case not found." });
    }

    const accessError = requireAssignedDoctor(req, medicalCase);
    if (accessError) return res.status(403).json({ success: false, message: accessError });

    if (medicalCase.clinicalRecord?.signedAt) {
      return res.status(409).json({
        success: false,
        message: "This clinical record has already been signed and cannot be edited. Add a signed addendum instead.",
      });
    }

    if (medicalCase.status !== "scheduled" || !medicalCase.scheduledAt) {
      return res.status(409).json({ success: false, message: "Schedule the medical review meeting before completing the clinical record." });
    }
    if (new Date(medicalCase.scheduledAt).getTime() > Date.now()) {
      return res.status(409).json({ success: false, message: "The scheduled medical review has not occurred yet." });
    }

    const completed = parseCompletedDate(req.body?.meetingCompletedAt);
    if (completed.error) return res.status(400).json({ success: false, message: completed.error });

    const meetingDetails = trimmed(req.body?.meetingDetails, 6000);
    const medicalFindings = trimmed(req.body?.medicalFindings, 6000);
    if (!meetingDetails) {
      return res.status(400).json({ success: false, message: "Meeting details are required before the medical record can be signed." });
    }
    if (!medicalFindings) {
      return res.status(400).json({ success: false, message: "Medical findings are required before the medical record can be signed." });
    }

    const signingError = signatureError(req);
    if (signingError) return res.status(400).json({ success: false, message: signingError });

    const signedAt = new Date();
    const structuredClinical = cleanStructuredClinicalInput(req.body);

    medicalCase.clinicalRecord = {
      meetingCompletedAt: completed.value,
      meetingDetails,
      medicalFindings,
      medications: trimmed(req.body?.medications, 4000),
      restrictions: trimmed(req.body?.restrictions, 4000),
      recommendations: trimmed(req.body?.recommendations, 6000),
      clientInstructions: trimmed(req.body?.clientInstructions, 6000),
      ...(structuredClinical.vitals ? { vitals: structuredClinical.vitals } : {}),
      ...(structuredClinical.allergies ? { allergies: structuredClinical.allergies } : {}),
      ...(structuredClinical.problemList ? { problemList: structuredClinical.problemList } : {}),
      ...(structuredClinical.medicationHistory ? { medicationHistory: structuredClinical.medicationHistory } : {}),
      ...(structuredClinical.safetyFlags ? { safetyFlags: structuredClinical.safetyFlags } : {}),
      ...(structuredClinical.clinicalConsent ? { clinicalConsent: structuredClinical.clinicalConsent } : {}),
      signedAt,
      signedBy: req.user._id,
      signedByName: req.user.name,
      attestation: CLINICAL_ATTESTATION,
    };
    medicalCase.updatedBy = req.user._id;
    await medicalCase.save();

    await addCrmActivity({
      contact: medicalCase.contact,
      opportunity: medicalCase.opportunity,
      type: "system",
      subject: "Medical review clinical record signed",
      body: `Clinical record signed by ${req.user.name} at ${signedAt.toISOString()}. Clinical content is stored in the protected medical record.`,
      assignedTo: req.user._id,
      createdBy: req.user._id,
      metadata: {
        event: "medical_review_record_signed",
        medicalReviewCaseId: String(medicalCase._id),
        signedAt: signedAt.toISOString(),
      },
    });

    await logAudit(
      req,
      "Signed medical review clinical record",
      "MedicalReviewCase",
      medicalCase._id.toString(),
      `${medicalCase.contact.fullName}: signed by ${req.user.name}`
    );

    res.status(200).json({
      success: true,
      case: sanitizeMedicalCaseForResponse(req, medicalCase),
    });
  } catch (err) {
    next(err);
  }
};

export const addMedicalReviewAddendum = async (req, res, next) => {
  try {
    const medicalCase = await populatedCaseById(req, req.params.id);
    if (!medicalCase) {
      return res.status(404).json({ success: false, message: "Medical review case not found." });
    }

    const accessError = requireAssignedDoctor(req, medicalCase);
    if (accessError) return res.status(403).json({ success: false, message: accessError });

    if (!medicalCase.clinicalRecord?.signedAt) {
      return res.status(409).json({ success: false, message: "Sign the original clinical record before adding an addendum." });
    }

    const kind = req.body?.kind === "follow_up" ? "follow_up" : "correction";
    const signingError = signatureError(req);
    if (signingError) return res.status(400).json({ success: false, message: signingError });

    const signedAt = new Date();
    let entry;

    if (kind === "follow_up") {
      if (medicalCase.status !== "scheduled" || !medicalCase.scheduledAt) {
        return res.status(409).json({ success: false, message: "Schedule the follow-up medical meeting before recording a follow-up note." });
      }
      if (new Date(medicalCase.scheduledAt).getTime() > Date.now()) {
        return res.status(409).json({ success: false, message: "The scheduled follow-up meeting has not occurred yet." });
      }
      const completed = parseCompletedDate(req.body?.meetingCompletedAt);
      if (completed.error) return res.status(400).json({ success: false, message: completed.error });
      const meetingDetails = trimmed(req.body?.meetingDetails, 6000);
      const medicalFindings = trimmed(req.body?.medicalFindings, 6000);
      if (!meetingDetails || !medicalFindings) {
        return res.status(400).json({ success: false, message: "Meeting details and medical findings are required for a follow-up medical note." });
      }
      entry = {
        kind,
        meetingCompletedAt: completed.value,
        meetingDetails,
        medicalFindings,
        medications: trimmed(req.body?.medications, 4000),
        restrictions: trimmed(req.body?.restrictions, 4000),
        recommendations: trimmed(req.body?.recommendations, 6000),
        clientInstructions: trimmed(req.body?.clientInstructions, 6000),
        signedAt,
        signedBy: req.user._id,
        signedByName: req.user.name,
        attestation: CLINICAL_ATTESTATION,
      };
    } else {
      const text = trimmed(req.body?.text, 6000);
      if (!text) {
        return res.status(400).json({ success: false, message: "Addendum text is required." });
      }
      entry = {
        kind,
        text,
        signedAt,
        signedBy: req.user._id,
        signedByName: req.user.name,
        attestation: CLINICAL_ATTESTATION,
      };
    }

    medicalCase.addenda.push(entry);
    medicalCase.updatedBy = req.user._id;
    await medicalCase.save();

    await addCrmActivity({
      contact: medicalCase.contact,
      opportunity: medicalCase.opportunity,
      type: "system",
      subject: kind === "follow_up" ? "Medical follow-up note signed" : "Medical record addendum signed",
      body: `${kind === "follow_up" ? "Follow-up note" : "Addendum"} signed by ${req.user.name} at ${signedAt.toISOString()}. Clinical content is stored in the protected medical record.`,
      assignedTo: req.user._id,
      createdBy: req.user._id,
      metadata: {
        event: kind === "follow_up" ? "medical_review_follow_up_signed" : "medical_review_addendum_signed",
        medicalReviewCaseId: String(medicalCase._id),
        signedAt: signedAt.toISOString(),
      },
    });

    await logAudit(
      req,
      kind === "follow_up" ? "Signed medical follow-up note" : "Signed medical record addendum",
      "MedicalReviewCase",
      medicalCase._id.toString(),
      `${medicalCase.contact.fullName}: signed by ${req.user.name}`
    );

    res.status(201).json({
      success: true,
      case: sanitizeMedicalCaseForResponse(req, medicalCase),
    });
  } catch (err) {
    next(err);
  }
};

export const recordMedicalReviewOutcome = async (req, res, next) => {
  try {
    const medicalCase = await populatedCaseById(req, req.params.id);
    if (!medicalCase) {
      return res.status(404).json({ success: false, message: "Medical review case not found." });
    }

    const accessError = requireAssignedDoctor(req, medicalCase);
    if (accessError) return res.status(403).json({ success: false, message: accessError });

    if (medicalCase.status !== "scheduled") {
      return res.status(409).json({ success: false, message: "A scheduled medical meeting is required before recording an outcome." });
    }

    if (!medicalCase.clinicalRecord?.signedAt) {
      return res.status(409).json({ success: false, message: "Sign the medical review record before recording the outcome." });
    }

    if (medicalCase.outcome === "follow_up_required") {
      const followUp = latestSignedFollowUp(medicalCase);
      if (!followUp || new Date(followUp.signedAt).getTime() < new Date(medicalCase.scheduledAt).getTime()) {
        return res.status(409).json({ success: false, message: "Sign the follow-up medical note before recording the new outcome." });
      }
    }

    if (trimmed(req.body?.notes, 5000)) {
      return res.status(400).json({
        success: false,
        message: "Clinical notes cannot be added through the outcome field. Record and sign them in the protected medical record first.",
      });
    }

    const outcome = String(req.body?.outcome || "").trim().toLowerCase();
    if (!["cleared", "follow_up_required", "not_cleared"].includes(outcome)) {
      return res.status(400).json({
        success: false,
        message: "Choose cleared, follow_up_required, or not_cleared.",
      });
    }

    const contact = medicalCase.contact;
    const opportunity = await CrmOpportunity.findById(medicalCase.opportunity._id || medicalCase.opportunity);
    if (!opportunity) {
      return res.status(409).json({ success: false, message: "CRM opportunity is unavailable." });
    }

    let targetStage = opportunity.stage;
    if (outcome === "cleared") targetStage = "payment_pending";
    if (outcome === "not_cleared") targetStage = "nurture";

    medicalCase.outcome = outcome;
    medicalCase.outcomeNotes = "";
    medicalCase.updatedBy = req.user._id;

    if (outcome === "follow_up_required") {
      medicalCase.status = "awaiting_scheduling";
      medicalCase.scheduledAt = undefined;
      medicalCase.meetingUrl = "";
      await medicalCase.save();

      const dueAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
      await addCrmActivity({
        contact,
        opportunity,
        type: "task",
        subject: "Medical review follow-up required",
        body: `Arrange a follow-up medical review for ${contact.fullName}.`,
        dueAt,
        assignedTo: req.user._id,
        createdBy: req.user._id,
        metadata: {
          event: "medical_review_follow_up_required",
          medicalReviewCaseId: String(medicalCase._id),
        },
      });
    } else {
      medicalCase.status = "completed";
      medicalCase.completedAt = new Date();
      await medicalCase.save();

      const previousStage = opportunity.stage;
      if (previousStage !== targetStage) {
        opportunity.stage = targetStage;
        opportunity.stageEnteredAt = new Date();
        opportunity.updatedBy = req.user._id;
        await opportunity.save();

        await addCrmActivity({
          contact,
          opportunity,
          type: "stage_change",
          subject: "Pipeline stage changed",
          body: `Stage moved from ${previousStage} to ${targetStage} by signed medical review outcome.`,
          createdBy: req.user._id,
          metadata: {
            from: previousStage,
            to: targetStage,
            event: "medical_review_outcome",
          },
        });

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
            medicalReviewOutcome: outcome,
          },
        }).catch((error) =>
          console.error("Medical review workflow stage trigger failed:", error.message)
        );
      }
    }

    const label = {
      cleared: "Cleared",
      follow_up_required: "Follow-up required",
      not_cleared: "Not cleared",
    }[outcome];

    await addCrmActivity({
      contact,
      opportunity,
      type: "system",
      subject: "Medical review outcome",
      body: `${label} recorded by ${req.user.name}. Supporting clinical content is retained only in the signed medical record.`,
      assignedTo: req.user._id,
      createdBy: req.user._id,
      metadata: {
        event: "medical_review_outcome",
        medicalReviewCaseId: String(medicalCase._id),
        outcome,
        toStage: targetStage,
      },
    });

    await logAudit(
      req,
      "Recorded signed medical review outcome",
      "MedicalReviewCase",
      medicalCase._id.toString(),
      `${contact.fullName}: ${label}`
    );

    res.status(200).json({
      success: true,
      outcome,
      case: sanitizeMedicalCaseForResponse(req, medicalCase),
    });
  } catch (err) {
    next(err);
  }
};
