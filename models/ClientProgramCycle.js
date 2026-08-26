import mongoose from "mongoose";

const clientProgramCycleSchema = new mongoose.Schema(
  {
    client: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Client",
      required: true,
      index: true,
    },
    triggerPayment: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Payment",
      required: true,
      unique: true,
    },
    program: { type: String, trim: true },
    offering: { type: mongoose.Schema.Types.ObjectId, ref: "CatalogueItem" },
    startedAt: { type: Date },
    endedAt: { type: Date },
    statusAtClose: { type: String, trim: true },
    onboarding: {
      loggedWeight: { type: Boolean, default: false },
      tickedMeal: { type: Boolean, default: false },
      bookedCall: { type: Boolean, default: false },
      joinedGroup: { type: Boolean, default: false },
    },
    week3Review: { type: mongoose.Schema.Types.Mixed },
    lastReviewedAt: { type: Date },
    archivedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

clientProgramCycleSchema.index({ client: 1, startedAt: -1 });

export default mongoose.model("ClientProgramCycle", clientProgramCycleSchema);
