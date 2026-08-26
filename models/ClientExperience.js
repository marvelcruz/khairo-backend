import mongoose from "mongoose";

const measurementSchema = new mongoose.Schema(
  {
    date: {
      type: Date,
      default: Date.now,
    },
    waistCm: Number,
    hipsCm: Number,
    chestCm: Number,
    thighCm: Number,
    energy: {
      type: Number,
      min: 1,
      max: 5,
    },
    sleep: {
      type: Number,
      min: 1,
      max: 5,
    },
    mobility: {
      type: Number,
      min: 1,
      max: 5,
    },
    confidence: {
      type: Number,
      min: 1,
      max: 5,
    },
    notes: {
      type: String,
      trim: true,
      maxlength: 1000,
    },
  },
  { _id: true }
);

const sharedItemSchema = new mongoose.Schema(
  {
    kind: {
      type: String,
      enum: ["document", "form"],
      required: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 160,
    },
    url: {
      type: String,
      trim: true,
      maxlength: 2000,
    },
    status: {
      type: String,
      enum: [
        "available",
        "action_required",
        "completed",
      ],
      default: "available",
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
  },
  { _id: true }
);

const clientExperienceSchema =
  new mongoose.Schema(
    {
      client: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Client",
        required: true,
        unique: true,
        index: true,
      },

      measurements: {
        type: [measurementSchema],
        default: [],
      },

      preferences: {
        emailReminders: {
          type: Boolean,
          default: true,
        },
        smsReminders: {
          type: Boolean,
          default: true,
        },
        portalReminders: {
          type: Boolean,
          default: true,
        },
        weeklyCheckInReminder: {
          type: Boolean,
          default: true,
        },
        progressPhotoReminder: {
          type: Boolean,
          default: true,
        },
        appointmentReminder: {
          type: Boolean,
          default: true,
        },
      },

      sharedItems: {
        type: [sharedItemSchema],
        default: [],
      },
    },
    { timestamps: true }
  );

export default mongoose.model(
  "ClientExperience",
  clientExperienceSchema
);
