import mongoose from "mongoose";

const sessionSchema = new mongoose.Schema(
  {
    client: { type: mongoose.Schema.Types.ObjectId, ref: "Client", default: null },
    isTeam: { type: Boolean, default: false },
    title: { type: String, default: "" },
    staff: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    requestedBy: { type: String, enum: ["client", "staff"], default: "staff" },
    sessionType: { type: String, enum: ["consultation", "training", "review"], default: "consultation" },
    startsAt: { type: Date, required: true },
    durationMins: { type: Number, default: 30 },
    zoomLink: { type: String, default: "" },
    note: { type: String, default: "" },
    status: { type: String, enum: ["pending", "confirmed", "declined", "completed", "cancelled"], default: "pending" },
    decidedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    decidedAt: { type: Date, default: null },
    confirmedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    confirmedAt: { type: Date, default: null },
    archived: { type: Boolean, default: false },
  },
  { timestamps: true }
);

export default mongoose.model("Session", sessionSchema);
