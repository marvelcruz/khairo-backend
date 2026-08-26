import CrmContact from "../models/CrmContact.js";
import CrmOpportunity from "../models/CrmOpportunity.js";
import FormSubmission from "../models/FormSubmission.js";
import MedicalReviewCase from "../models/MedicalReviewCase.js";
import User from "../models/User.js";
import { addCrmActivity } from "./crmService.js";
import { notifyMedicalReviewAssignment } from "./medicalReviewNotificationService.js";

const ACTIVE_CASE_STATUSES = ["awaiting_scheduling", "scheduled"];

function extractAnswer(submission, standardKey) {
  const elements = Array.isArray(submission?.schemaSnapshot)
    ? submission.schemaSnapshot
    : [];
  const field = elements.find(
    (item) => item?.standardKey === standardKey || item?.key === standardKey
  );
  if (!field) return "";

  const fieldId = String(field.id || field._id || "");
  const raw = submission?.answers?.[fieldId];
  if (raw === undefined || raw === null) return "";
  if (Array.isArray(raw)) return raw.join(", ");
  if (typeof raw === "object") return JSON.stringify(raw);
  return String(raw).trim();
}

async function qualificationSummary(contactId) {
  const submission = await FormSubmission.findOne({
    entityType: "crm_contact",
    entityId: contactId,
    formSlug: "khairo-qualification",
  })
    .sort({ createdAt: -1 })
    .lean();

  if (!submission) {
    return {
      goals: "",
      healthNotes: "",
      startTimeline: "",
      readyToSpeak: "",
    };
  }

  return {
    goals: extractAnswer(submission, "goals"),
    healthNotes: extractAnswer(submission, "healthNotes"),
    startTimeline: extractAnswer(submission, "startTimeline"),
    readyToSpeak: extractAnswer(submission, "readyToSpeak"),
    submissionId: submission._id,
  };
}

async function chooseLeastLoadedDoctor() {
  const doctors = await User.find({
    isActive: true,
    roles: "doctor",
  })
    .select("_id name email phone")
    .lean();

  if (!doctors.length) return null;

  const ids = doctors.map((doctor) => doctor._id);
  const rows = await MedicalReviewCase.aggregate([
    {
      $match: {
        assignedDoctor: { $in: ids },
        status: { $in: ACTIVE_CASE_STATUSES },
      },
    },
    {
      $group: {
        _id: "$assignedDoctor",
        openCount: { $sum: 1 },
        lastAssignedAt: { $max: "$assignedAt" },
      },
    },
  ]);

  const stats = new Map(
    rows.map((row) => [
      String(row._id),
      {
        openCount: Number(row.openCount || 0),
        lastAssignedAt: row.lastAssignedAt
          ? new Date(row.lastAssignedAt).getTime()
          : 0,
      },
    ])
  );

  return doctors
    .map((doctor) => ({
      ...doctor,
      ...(stats.get(String(doctor._id)) || {
        openCount: 0,
        lastAssignedAt: 0,
      }),
    }))
    .sort(
      (a, b) =>
        a.openCount - b.openCount ||
        a.lastAssignedAt - b.lastAssignedAt ||
        String(a._id).localeCompare(String(b._id))
    )[0];
}

export async function ensureMedicalReviewCaseForOpportunity(opportunityOrId) {
  const opportunity =
    typeof opportunityOrId === "object" && opportunityOrId?._id
      ? opportunityOrId
      : await CrmOpportunity.findById(opportunityOrId);

  if (!opportunity || opportunity.stage !== "medical_review") return null;

  let medicalCase = await MedicalReviewCase.findOne({
    opportunity: opportunity._id,
  });
  if (medicalCase) return medicalCase;

  const contact = await CrmContact.findOne({
    _id: opportunity.contact,
    isArchived: false,
  });
  if (!contact) return null;

  const doctor = await chooseLeastLoadedDoctor();
  const summary = await qualificationSummary(contact._id);
  const now = new Date();

  try {
    medicalCase = await MedicalReviewCase.create({
      contact: contact._id,
      opportunity: opportunity._id,
      assignedDoctor: doctor?._id,
      assignedAt: doctor ? now : undefined,
      status: "awaiting_scheduling",
      qualificationSummary: summary,
      createdBy: opportunity.updatedBy || opportunity.createdBy,
      updatedBy: opportunity.updatedBy || opportunity.createdBy,
    });
  } catch (error) {
    if (error?.code === 11000) {
      return MedicalReviewCase.findOne({ opportunity: opportunity._id });
    }
    throw error;
  }

  if (!doctor) {
    await addCrmActivity({
      contact,
      opportunity,
      type: "system",
      subject: "Medical review awaiting doctor",
      body: "Medical review case created, but no active doctor account is available for automatic assignment.",
      createdBy: opportunity.updatedBy || opportunity.createdBy,
      metadata: {
        event: "medical_review_assignment",
        status: "doctor_unavailable",
        medicalReviewCaseId: String(medicalCase._id),
      },
    });
    return medicalCase;
  }

  const taskDue = new Date(Date.now() + 24 * 60 * 60 * 1000);
  await addCrmActivity({
    contact,
    opportunity,
    type: "task",
    subject: "Medical review assigned",
    body: `Review ${contact.fullName}'s medical information and arrange the medical review meeting.`,
    dueAt: taskDue,
    assignedTo: doctor._id,
    createdBy: opportunity.updatedBy || opportunity.createdBy,
    metadata: {
      event: "medical_review_assignment",
      medicalReviewCaseId: String(medicalCase._id),
      assignedDoctorId: String(doctor._id),
    },
  });

  const notification = await notifyMedicalReviewAssignment({
    medicalCase,
    doctor,
    contact,
    opportunity,
  });

  await addCrmActivity({
    contact,
    opportunity,
    type: "system",
    subject: "Medical reviewer assigned",
    body: `${doctor.name} assigned automatically. Doctor push: ${notification.push?.status || "unknown"}. Doctor email: ${notification.email?.status || "unknown"}.`,
    assignedTo: doctor._id,
    createdBy: opportunity.updatedBy || opportunity.createdBy,
    metadata: {
      event: "medical_review_assignment_notification",
      medicalReviewCaseId: String(medicalCase._id),
      assignedDoctorId: String(doctor._id),
      push: notification.push,
      email: notification.email,
    },
  });

  return medicalCase;
}

export async function pauseLegacyMedicalReviewTaskWorkflow() {
  const WorkflowDefinition = (await import("../models/WorkflowDefinition.js")).default;
  const result = await WorkflowDefinition.updateMany(
    {
      name: "Medical Review Task",
      status: "active",
    },
    {
      $set: {
        status: "paused",
        description:
          "Superseded by the native Medical Review module, which assigns the doctor, creates the doctor task, and sends assignment notifications.",
      },
    }
  );
  return { changed: Number(result.modifiedCount || 0) };
}
