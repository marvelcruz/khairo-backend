import mongoose from "mongoose";

const customFieldValueSchema = new mongoose.Schema(
  {
    entityType: {
      type: String,
      required: true,
      enum: ["crm_contact", "application", "client"],
    },
    entityId: { type: mongoose.Schema.Types.ObjectId, required: true },
    field: { type: mongoose.Schema.Types.ObjectId, ref: "CustomFieldDefinition", required: true },
    value: { type: mongoose.Schema.Types.Mixed, default: null },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

customFieldValueSchema.index({ entityType: 1, entityId: 1, field: 1 }, { unique: true });
customFieldValueSchema.index({ field: 1 });

export default mongoose.model("CustomFieldValue", customFieldValueSchema);
