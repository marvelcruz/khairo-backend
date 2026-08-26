import mongoose from "mongoose";

const dailyLogSchema = new mongoose.Schema(
  {
    client: { type: mongoose.Schema.Types.ObjectId, ref: "Client", required: true },
    logDate: { type: String, required: true },

    weightKg: { type: Number },
    calories: { type: Number },
    waterMl: { type: Number },
    steps: { type: Number },
    workoutDone: { type: Boolean, default: false },

    // IDs of Client.mealChecklist items ticked off on this specific day.
    completedMealItemIds: [{ type: mongoose.Schema.Types.ObjectId }],

    // IDs of Client.mealTimetable exercise items completed on this specific day.
    completedExerciseIds: [{ type: mongoose.Schema.Types.ObjectId }],

    notes: { type: String, trim: true },
  },
  { timestamps: true }
);

dailyLogSchema.index({ client: 1, logDate: 1 }, { unique: true });

export default mongoose.model("DailyLog", dailyLogSchema);
