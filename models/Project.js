import mongoose from "mongoose";

const projectSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 160,
    },
    description: {
      type: String,
      trim: true,
      maxlength: 1200,
      default: "",
    },
    status: {
      type: String,
      enum: [
        "active",
        "completed",
        "archived",
      ],
      default: "active",
      index: true,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
  },
  {
    timestamps: true,
  }
);

projectSchema.index({
  status: 1,
  updatedAt: -1,
});

projectSchema.index({
  name: 1,
});

export default mongoose.model(
  "Project",
  projectSchema
);
