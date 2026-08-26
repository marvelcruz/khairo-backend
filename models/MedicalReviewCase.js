import mongoose from "mongoose";

export const MEDICAL_REVIEW_STATUS_VALUES = [
  "awaiting_scheduling",
  "scheduled",
  "completed",
  "cancelled",
];

export const MEDICAL_REVIEW_OUTCOME_VALUES = [
  "pending",
  "cleared",
  "follow_up_required",
  "not_cleared",
];

const clinicalAddendumSchema = new mongoose.Schema(
  {
    kind: {
      type: String,
      enum: ["correction", "follow_up"],
      default: "correction",
      required: true,
    },
    text: { type: String, trim: true, maxlength: 6000, default: "" },
    meetingCompletedAt: { type: Date },
    meetingDetails: { type: String, trim: true, maxlength: 6000, default: "" },
    medicalFindings: { type: String, trim: true, maxlength: 6000, default: "" },
    vitals: {
      heightCm: { type: Number, min: 0 },
      weightKg: { type: Number, min: 0 },
      bloodPressure: { type: String, trim: true, maxlength: 40, default: "" },
      heartRate: { type: Number, min: 0 },
      temperatureC: { type: Number, min: 0 },
      bloodGlucoseMmol: { type: Number, min: 0 },
      notes: { type: String, trim: true, maxlength: 1000, default: "" },
    },
    allergies: [{
      substance: { type: String, trim: true, maxlength: 200, default: "" },
      reaction: { type: String, trim: true, maxlength: 500, default: "" },
      severity: { type: String, enum: ["mild", "moderate", "severe"], default: "mild" },
    }],
    problemList: [{
      diagnosis: { type: String, trim: true, maxlength: 300, default: "" },
      status: { type: String, enum: ["active", "resolved", "managed"], default: "active" },
      notes: { type: String, trim: true, maxlength: 500, default: "" },
    }],
    medicationHistory: [{
      name: { type: String, trim: true, maxlength: 200, default: "" },
      dose: { type: String, trim: true, maxlength: 200, default: "" },
      frequency: { type: String, trim: true, maxlength: 200, default: "" },
      prescriber: { type: String, trim: true, maxlength: 200, default: "" },
      ongoing: { type: Boolean, default: true },
    }],
    clinicalConsent: {
      consentGiven: { type: Boolean, default: false },
      consentScope: { type: String, trim: true, maxlength: 2000, default: "" },
      consentAt: { type: Date },
      consentBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
      consentByName: { type: String, trim: true, maxlength: 200, default: "" },
    },
    safetyFlags: [{
      type: { type: String, trim: true, maxlength: 200, default: "" },
      severity: { type: String, enum: ["info", "warning", "urgent"], default: "info" },
      note: { type: String, trim: true, maxlength: 1000, default: "" },
    }],
    medications: { type: String, trim: true, maxlength: 4000, default: "" },
    restrictions: { type: String, trim: true, maxlength: 4000, default: "" },
    recommendations: { type: String, trim: true, maxlength: 6000, default: "" },
    clientInstructions: { type: String, trim: true, maxlength: 6000, default: "" },
    clientInstructionsReleasedAt: { type: Date },
    clientInstructionsReleasedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    signedAt: { type: Date, required: true },
    signedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    signedByName: { type: String, required: true, trim: true },
    attestation: { type: String, required: true, trim: true },
  },
  { _id: true }
);

const clinicalRecordSchema = new mongoose.Schema(
  {
    meetingCompletedAt: { type: Date },
    meetingDetails: { type: String, trim: true, maxlength: 6000, default: "" },
    medicalFindings: { type: String, trim: true, maxlength: 6000, default: "" },
    medications: { type: String, trim: true, maxlength: 4000, default: "" },
    restrictions: { type: String, trim: true, maxlength: 4000, default: "" },
    recommendations: { type: String, trim: true, maxlength: 6000, default: "" },
    clientInstructions: { type: String, trim: true, maxlength: 6000, default: "" },
    clientInstructionsReleasedAt: { type: Date },
    clientInstructionsReleasedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    signedAt: { type: Date },
    signedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    signedByName: { type: String, trim: true, default: "" },
    attestation: { type: String, trim: true, default: "" },
  },
  { _id: false }
);

const medicalReviewCaseSchema = new mongoose.Schema(
  {
    contact: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "CrmContact",
      required: true,
      index: true,
    },
    opportunity: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "CrmOpportunity",
      required: true,
      unique: true,
      index: true,
    },
    assignedDoctor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: undefined,
      index: true,
    },
    assignedAt: { type: Date },
    status: {
      type: String,
      enum: MEDICAL_REVIEW_STATUS_VALUES,
      default: "awaiting_scheduling",
      index: true,
    },
    scheduledAt: { type: Date, index: true },
    meetingProvider: {
      type: String,
      enum: ["video", "phone", "in_person"],
      default: "video",
    },
    meetingUrl: { type: String, trim: true, maxlength: 1000, default: "" },
    schedulingNotes: { type: String, trim: true, maxlength: 3000, default: "" },
    outcome: {
      type: String,
      enum: MEDICAL_REVIEW_OUTCOME_VALUES,
      default: "pending",
      index: true,
    },
    outcomeNotes: { type: String, trim: true, maxlength: 5000, default: "" },
    completedAt: { type: Date },
    qualificationSummary: {
      goals: { type: String, default: "" },
      healthNotes: { type: String, default: "" },
      startTimeline: { type: String, default: "" },
      readyToSpeak: { type: String, default: "" },
      submissionId: { type: mongoose.Schema.Types.ObjectId, ref: "FormSubmission" },
    },
    clinicalRecord: {
      type: clinicalRecordSchema,
      default: () => ({}),
    },
    addenda: {
      type: [clinicalAddendumSchema],
      default: [],
    },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

medicalReviewCaseSchema.index({ assignedDoctor: 1, status: 1, scheduledAt: 1 });
medicalReviewCaseSchema.index({ status: 1, createdAt: 1 });
medicalReviewCaseSchema.index({ "clinicalRecord.signedAt": 1 });
medicalReviewCaseSchema.index({ "addenda.kind": 1, "addenda.signedAt": 1 });

export default mongoose.model("MedicalReviewCase", medicalReviewCaseSchema);
