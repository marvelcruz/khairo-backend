import mongoose from "mongoose";
import CrmActivity from "./CrmActivity.js";
import CrmContact from "./CrmContact.js";
import CrmTag from "./CrmTag.js";
import {
  automaticMilestoneTags,
  automaticStageTags,
  automationTagDefinition,
  automationTagLifecycleMode,
  STAGE_MANAGED_TAG_KEYS,
} from "../services/crmTagAutomationPolicy.js";
import { dispatchCrmTagChange } from "../services/crmTagWorkflowService.js";

export const CRM_STAGE_VALUES = [
  "new",
  "qualification",
  "qualified",
  "consultation_booked",
  "consultation_completed",
  "medical_review",
  "payment_pending",
  "nurture",
  "lost",
];

export const CRM_LEAD_PRIORITY_VALUES = [
  "normal",
  "high",
  "urgent",
];

async function ensureAutomationTagDefinition(key) {
  const definition = automationTagDefinition(key);
  if (!definition) return;

  await CrmTag.findOneAndUpdate(
    { key },
    {
      $setOnInsert: {
        key,
        name: definition.name,
        normalizedName: definition.name.trim().toLowerCase(),
        category: definition.category,
        description: definition.description,
        active: true,
      },
      $set: {
        automationManaged: true,
        automationRule: definition.automationRule,
        lifecycleMode: automationTagLifecycleMode(key),
      },
    },
    {
      upsert: true,
      new: true,
      setDefaultsOnInsert: true,
    }
  );
}

const crmOpportunitySchema = new mongoose.Schema(
  {
    contact: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "CrmContact",
      required: true,
      index: true,
    },
    name: { type: String, trim: true, maxlength: 180 },
    stage: {
      type: String,
      enum: CRM_STAGE_VALUES,
      default: "new",
      index: true,
    },
    status: {
      type: String,
      enum: ["open", "won", "lost"],
      default: "open",
      index: true,
    },
    leadPriority: {
      type: String,
      enum: CRM_LEAD_PRIORITY_VALUES,
      default: "normal",
      index: true,
    },
    stageEnteredAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
    programInterest: {
      type: String,
      enum: ["core", "plus", "vip", "not_sure"],
      default: "not_sure",
    },
    programInterestOffering: { type: mongoose.Schema.Types.ObjectId, ref: "CatalogueItem" },
    estimatedValue: { type: Number, min: 0, default: 0 },
    assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    nextFollowUpAt: { type: Date },
    lostReason: { type: String, trim: true, maxlength: 500 },
    application: { type: mongoose.Schema.Types.ObjectId, ref: "Application" },
    client: { type: mongoose.Schema.Types.ObjectId, ref: "Client" },
    wonAt: { type: Date },
    closedAt: { type: Date },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

crmOpportunitySchema.pre("save", function (next) {
  this.$locals.shouldSyncStageTags = this.isNew || this.isModified("stage");
  next();
});

crmOpportunitySchema.post("save", async function (doc) {
  if (!doc.$locals.shouldSyncStageTags) return;

  try {
    if (doc.stage === "medical_review") {
      const { ensureMedicalReviewCaseForOpportunity } = await import(
        "../services/medicalReviewService.js"
      );
      await ensureMedicalReviewCaseForOpportunity(doc);
    }

    if (doc.stage === "payment_pending") {
      const { ensurePaymentPendingClientForOpportunity } = await import(
        "../services/paymentPendingService.js"
      );
      await ensurePaymentPendingClientForOpportunity(doc);
    }

    const desiredStageTags = automaticStageTags(doc.stage);
    const milestoneTags = automaticMilestoneTags(doc.stage);
    const definitionsToEnsure = [...new Set([...desiredStageTags, ...milestoneTags])];
    await Promise.all(definitionsToEnsure.map(ensureAutomationTagDefinition));

    const contact = await CrmContact.findById(doc.contact);
    if (!contact) return;

    const beforeTags = [...(contact.tags || [])];
    const workflowLimitedAtStage = await CrmTag.find({
      lifecycleMode: "workflow_limited",
      removeOnStages: doc.stage,
      key: { $in: beforeTags },
    })
      .select("key")
      .lean();

    const workflowLimitedKeys = new Set(
      workflowLimitedAtStage.map((tag) => tag.key)
    );
    const managed = new Set(STAGE_MANAGED_TAG_KEYS);
    const nextTags = beforeTags.filter(
      (tag) => !managed.has(tag) && !workflowLimitedKeys.has(tag)
    );

    for (const tag of desiredStageTags) {
      if (!nextTags.includes(tag)) nextTags.push(tag);
    }

    const newlyAddedMilestones = [];
    for (const tag of milestoneTags) {
      if (!nextTags.includes(tag)) {
        nextTags.push(tag);
        newlyAddedMilestones.push(tag);
      }
    }

    const before = [...beforeTags].sort();
    const after = [...nextTags].sort();

    if (JSON.stringify(before) === JSON.stringify(after)) return;

    const beforeSet = new Set(beforeTags);
    const afterSet = new Set(nextTags);
    const added = nextTags.filter((tag) => !beforeSet.has(tag));
    const removed = beforeTags.filter((tag) => !afterSet.has(tag));

    contact.tags = nextTags;
    contact.updatedBy = doc.updatedBy || doc.createdBy;
    contact.lastActivityAt = new Date();
    await contact.save();

    for (const tag of removed) {
      await dispatchCrmTagChange({
        contact,
        tag,
        change: "removed",
        actorUserId: doc.updatedBy || doc.createdBy,
        actorName: "System (pipeline lifecycle)",
      });
    }

    for (const tag of added) {
      await dispatchCrmTagChange({
        contact,
        tag,
        change: "added",
        actorUserId: doc.updatedBy || doc.createdBy,
        actorName: "System (pipeline lifecycle)",
      });
    }

    for (const tag of newlyAddedMilestones) {
      const definition = automationTagDefinition(tag);
      await CrmActivity.create({
        contact: contact._id,
        opportunity: doc._id,
        type: "system",
        subject: "CRM milestone recorded",
        body: `${definition?.name || tag} added as a permanent audit milestone.`,
        createdBy: doc.updatedBy || doc.createdBy,
        metadata: {
          event: "crm_milestone_recorded",
          tag,
          stage: doc.stage,
          permanent: true,
        },
      });
    }
  } catch (error) {
    console.error("CRM stage automation failed:", error?.message || error);
  }
});

crmOpportunitySchema.index({ contact: 1, status: 1, updatedAt: -1 });
crmOpportunitySchema.index({ stage: 1, status: 1, nextFollowUpAt: 1 });
crmOpportunitySchema.index({ stage: 1, status: 1, stageEnteredAt: 1 });
crmOpportunitySchema.index({ leadPriority: 1, status: 1 });
crmOpportunitySchema.index({ assignedTo: 1, status: 1, nextFollowUpAt: 1 });

export default mongoose.model("CrmOpportunity", crmOpportunitySchema);
