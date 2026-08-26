import mongoose from "mongoose";

const optionSchema = new mongoose.Schema(
  {
    value: { type: String, required: true, trim: true, maxlength: 120 },
    label: { type: String, required: true, trim: true, maxlength: 120 },
  },
  { _id: false }
);

const customFieldDefinitionSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^[a-z][a-z0-9_]{1,63}$/, "Field key must use lowercase letters, numbers, and underscores."],
    },
    label: { type: String, required: true, trim: true, maxlength: 120 },
    description: { type: String, trim: true, maxlength: 500, default: "" },
    placeholder: { type: String, trim: true, maxlength: 160, default: "" },
    type: {
      type: String,
      required: true,
      enum: ["text", "long_text", "number", "date", "boolean", "select", "multi_select", "email", "phone"],
    },
    entityTypes: {
      type: [String],
      enum: ["crm_contact", "application", "client"],
      validate: {
        validator: (value) => Array.isArray(value) && value.length > 0,
        message: "Choose at least one record type.",
      },
    },
    required: { type: Boolean, default: false },
    active: { type: Boolean, default: true },
    sortOrder: { type: Number, default: 0 },
    options: { type: [optionSchema], default: [] },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

customFieldDefinitionSchema.index({ entityTypes: 1, active: 1, sortOrder: 1 });

export default mongoose.model("CustomFieldDefinition", customFieldDefinitionSchema);
