import mongoose from "mongoose";

const formSubmissionSchema = new mongoose.Schema(
  {
    form: { type: mongoose.Schema.Types.ObjectId, ref: "FormDefinition", required: true, index: true },
    formName: { type: String, required: true, trim: true },
    formSlug: { type: String, required: true, trim: true },
    visibility: { type: String, enum: ["internal", "public"], required: true },
    entityType: { type: String, enum: ["crm_contact", "application", "client"], default: undefined },
    entityId: { type: mongoose.Schema.Types.ObjectId, default: undefined },
    answers: { type: mongoose.Schema.Types.Mixed, default: {} },
    schemaSnapshot: { type: mongoose.Schema.Types.Mixed, default: [] },
    submittedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: undefined },
    submitterName: { type: String, trim: true, maxlength: 160, default: "" },
    source: { type: String, trim: true, maxlength: 80, default: "internal" },
  },
  { timestamps: true }
);

formSubmissionSchema.index({ entityType: 1, entityId: 1, createdAt: -1 });
formSubmissionSchema.index({ form: 1, createdAt: -1 });

export default mongoose.model("FormSubmission", formSubmissionSchema);
