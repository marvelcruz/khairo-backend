import mongoose from "mongoose";

const transcriptSchema = new mongoose.Schema(
  {
    session: { type: mongoose.Schema.Types.ObjectId, ref: "Session", required: true },
    client: { type: mongoose.Schema.Types.ObjectId, ref: "Client", default: null },
    text: { type: String, required: true },
    source: { type: String, enum: ["pasted", "webhook", "file"], default: "pasted" },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

export default mongoose.model("Transcript", transcriptSchema);
