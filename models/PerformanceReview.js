import mongoose from "mongoose";

const reviewSchema = new mongoose.Schema({
  client: { type: mongoose.Schema.Types.ObjectId, ref: "Client", required: true },
  periodStart: { type: Date, required: true },
  periodEnd: { type: Date, required: true },
  startingWeight: Number,
  endingWeight: Number,
  weightChange: Number,
  averageCalories: Number,
  adherencePercent: Number,
  totalWorkouts: Number,
  daysLogged: Number,
  summary: String,
  generatedAt: { type: Date, default: Date.now }
});

export default mongoose.model("PerformanceReview", reviewSchema);
