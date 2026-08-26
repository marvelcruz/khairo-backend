import mongoose from "mongoose";

const buddyPairSchema = new mongoose.Schema({
  mentee: { type: mongoose.Schema.Types.ObjectId, ref: "Client", required: true },
  mentor: { type: mongoose.Schema.Types.ObjectId, ref: "Client", required: true },
  pairedAt: { type: Date, default: Date.now },
  status: { type: String, enum: ["active", "completed", "cancelled"], default: "active" },
  notes: { type: String, default: "" }
});

buddyPairSchema.index({ mentee: 1 }, { unique: true });

export default mongoose.model("BuddyPair", buddyPairSchema);
