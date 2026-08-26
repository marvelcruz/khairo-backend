import mongoose from "mongoose";

const qualificationSchema = new mongoose.Schema(
  {
    questionnaireVersion: {
      type: String,
      trim: true,
      default: "v1",
      maxlength: 40,
    },
    answers: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    result: {
      type: String,
      enum: ["unreviewed", "qualified", "needs_review", "not_qualified"],
      default: "unreviewed",
    },
    reasons: [{ type: String, trim: true, maxlength: 160 }],
    disposition: {
      type: String,
      enum: ["none", "nurture", "lost"],
      default: "none",
    },
    reviewNotes: { type: String, trim: true, maxlength: 2000 },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    reviewedAt: { type: Date },
  },
  { _id: false }
);

const applicationSchema = new mongoose.Schema(
  {
    clientId: { type: mongoose.Schema.Types.ObjectId, ref: "Client" },
    program: { type: String, enum: ["core", "plus", "vip"] },
    // Stable catalogue reference for the selected programme. Legacy string is
    // retained during the compatibility migration.
    programOffering: { type: mongoose.Schema.Types.ObjectId, ref: "CatalogueItem" },
    timeline: { type: mongoose.Schema.Types.Mixed, default: {} },

    consultationDecision: {
      type: String,
      enum: ["yes", "no", "pending"],
      default: "pending",
    },
    assignedDoctor: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    consultationPaid: { type: Boolean, default: false },
    consultationReconciled: { type: Boolean, default: false },

    source: { type: String, default: "web" },
    submittedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },

    fullName: {
      type: String,
      required: [true, "Full name is required"],
      trim: true,
    },
    email: {
      type: String,
      required: [true, "Email is required"],
      trim: true,
      lowercase: true,
    },
    phone: {
      type: String,
      required: [true, "Phone is required"],
      trim: true,
    },

    programInterest: {
      type: String,
      enum: ["core", "plus", "vip", "not_sure"],
      default: "not_sure",
    },
    programInterestOffering: { type: mongoose.Schema.Types.ObjectId, ref: "CatalogueItem" },
    goals: { type: String, trim: true },
    healthNotes: { type: String, trim: true },

    qualification: {
      type: qualificationSchema,
      default: () => ({}),
    },

    status: {
      type: String,
      enum: ["pending", "contacted", "approved", "declined"],
      default: "pending",
    },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    reviewNotes: { type: String, trim: true },
  },
  { timestamps: true }
);

export default mongoose.model("Application", applicationSchema);
