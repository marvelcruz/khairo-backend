import mongoose from "mongoose";

const checklistItemSchema = new mongoose.Schema(
  {
    text: { type: String, required: true, trim: true, maxlength: 300 },
    completed: { type: Boolean, default: false },
    completedAt: { type: Date, default: null },
    completedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { _id: true }
);

const internalTaskSchema = new mongoose.Schema(
  {
    project: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Project",
      default: null,
      index: true,
    },
    sop: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Sop",
      default: null,
      index: true,
    },
    source: {
      type: String,
      enum: ["manual", "sop", "automation"],
      default: "manual",
      index: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 300,
    },
    description: {
      type: String,
      trim: true,
      maxlength: 3000,
      default: "",
    },
    checklist: {
      type: [checklistItemSchema],
      validate: {
        validator(value) {
          return Array.isArray(value) && value.length <= 30;
        },
        message: "A task can contain up to 30 checklist items.",
      },
      default: [],
    },
    status: {
      type: String,
      enum: ["todo", "in_progress", "done"],
      default: "todo",
      index: true,
    },
    assignedTo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true,
    },
    dueAt: { type: Date, default: null, index: true },
    completedAt: { type: Date, default: null },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

internalTaskSchema.index({ project: 1, status: 1, dueAt: 1 });
internalTaskSchema.index({ assignedTo: 1, status: 1, dueAt: 1 });
internalTaskSchema.index({ sop: 1, status: 1 });

export default mongoose.model("InternalTask", internalTaskSchema);
