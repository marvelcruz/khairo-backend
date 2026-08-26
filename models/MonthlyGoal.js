import mongoose from "mongoose";

const monthlyGoalSchema = new mongoose.Schema({
  month: { type: String, required: true, unique: true }, // "2026-08"
  target: { type: Number, required: true, default: 0 },
  updatedAt: { type: Date, default: Date.now },
});

export default mongoose.model("MonthlyGoal", monthlyGoalSchema);
