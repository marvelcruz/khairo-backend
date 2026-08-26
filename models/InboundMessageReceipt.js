import mongoose from "mongoose";

const inboundMessageReceiptSchema = new mongoose.Schema(
  {
    provider: {
      type: String,
      enum: ["instagram", "whatsapp"],
      required: true,
      index: true,
    },
    externalMessageId: {
      type: String,
      required: true,
      trim: true,
      maxlength: 240,
    },
    senderExternalId: { type: String, trim: true, default: "", maxlength: 180 },
    senderPhone: { type: String, trim: true, default: "", maxlength: 80 },
    messageType: { type: String, trim: true, default: "text", maxlength: 80 },
    receivedAt: { type: Date },
    processedAt: { type: Date },
    status: {
      type: String,
      enum: ["processing", "processed", "failed"],
      default: "processing",
      index: true,
    },
    contact: { type: mongoose.Schema.Types.ObjectId, ref: "CrmContact" },
    opportunity: { type: mongoose.Schema.Types.ObjectId, ref: "CrmOpportunity" },
    error: { type: String, trim: true, default: "", maxlength: 1000 },
  },
  { timestamps: true }
);

inboundMessageReceiptSchema.index(
  { provider: 1, externalMessageId: 1 },
  { unique: true }
);

export default mongoose.model("InboundMessageReceipt", inboundMessageReceiptSchema);
