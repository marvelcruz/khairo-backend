import mongoose from "mongoose";

const subjectSchema = new mongoose.Schema(
  {
    name: { type: String, default: "" },
    email: { type: String, default: "" },
    phone: { type: String, default: "" },
    context: { type: String, default: "" },
  },
  { _id: false }
);

const actionAlertSchema = new mongoose.Schema(
  {
    dedupeKey: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },

    ruleKey: {
      type: String,
      required: true,
      index: true,
    },

    entityType: {
      type: String,
      required: true,
      index: true,
    },

    entityId: {
      type: String,
      required: true,
      index: true,
    },

    status: {
      type: String,
      enum: ["open", "resolved", "dismissed"],
      default: "open",
      index: true,
    },

    severity: {
      type: String,
      enum: ["info", "warning", "urgent"],
      default: "warning",
      index: true,
    },

    title: {
      type: String,
      required: true,
      trim: true,
    },

    summary: {
      type: String,
      required: true,
      trim: true,
    },

    recommendedAction: {
      type: String,
      default: "",
      trim: true,
    },

    href: {
      type: String,
      default: "/dashboard/action-centre",
    },

    subject: {
      type: subjectSchema,
      default: () => ({}),
    },

    audienceRoles: {
      type: [String],
      default: ["admin", "sales"],
    },

    ageDays: {
      type: Number,
      default: 0,
      min: 0,
    },

    thresholdDays: {
      type: Number,
      default: 10,
      min: 0,
    },

    firstDetectedAt: {
      type: Date,
      default: Date.now,
    },

    lastDetectedAt: {
      type: Date,
      default: Date.now,
    },

    emailSentAt: {
      type: Date,
      default: null,
    },

    escalatedEmailSentAt: {
      type: Date,
      default: null,
    },

    slaState: {
      type: String,
      enum: ["new", "acknowledged", "escalated", "breached"],
      default: "new",
      index: true,
    },
    slaDueAt: {
      type: Date,
      default: null,
    },
    slaEscalationAt: {
      type: Date,
      default: null,
    },
    slaManagerEscalationAt: {
      type: Date,
      default: null,
    },
    acknowledgedAt: {
      type: Date,
      default: null,
    },
    acknowledgedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    managerEscalatedAt: {
      type: Date,
      default: null,
    },

    resolvedAt: {
      type: Date,
      default: null,
    },

    resolvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    resolutionNote: {
      type: String,
      default: "",
      trim: true,
    },
  },
  {
    timestamps: true,
  }
);

actionAlertSchema.index({
  status: 1,
  severity: 1,
  lastDetectedAt: -1,
});

actionAlertSchema.index({
  ruleKey: 1,
  entityType: 1,
  entityId: 1,
});

export default mongoose.model(
  "ActionAlert",
  actionAlertSchema
);
