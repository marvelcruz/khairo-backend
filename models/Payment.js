import mongoose from "mongoose";

const paymentSchema = new mongoose.Schema(
  {
    receiptNumber: { type: String, unique: true, required: true }, // FL-PAY-2026-0001
    client: { type: mongoose.Schema.Types.ObjectId, ref: "Client" },
    application: { type: mongoose.Schema.Types.ObjectId, ref: "Application" },
    subscription: { type: mongoose.Schema.Types.ObjectId, ref: "Subscription" },

    purpose: {
      type: String,
      enum: ["new_subscription", "renewal", "upgrade", "consultation", "combined", "program"],
      required: true,
    },

    amount: { type: Number, required: true, min: 0 },
    originalAmount: { type: Number, min: 0, default: 0 },
    promoCode: { type: String, trim: true, uppercase: true, default: "" },
    promoUseCounted: { type: Boolean, default: false },
    giftCardCode: { type: String, trim: true, uppercase: true, default: "" },
    giftCardAmount: { type: Number, min: 0, default: 0 },
    giftCardUseCounted: { type: Boolean, default: false },
    currency: { type: String, default: "NGN" },

    reference: { type: String, unique: true, required: true }, // Paystack transaction reference
    paymentLink: { type: String, trim: true, default: "" }, // Paystack authorization_url
    status: {
      type: String,
      enum: ["pending", "success", "failed", "abandoned"],
      default: "pending",
    },

    channel: { type: String, trim: true },
    authorizationCode: { type: String },
    cardLast4: { type: String },
    bank: { type: String },

    paidAt: { type: Date },
    rawWebhookEvent: { type: mongoose.Schema.Types.Mixed }, // full Paystack payload, for auditing
  },
  { timestamps: true }
);

paymentSchema.pre("validate", function (next) {
  if (!this.client && !this.application) {
    return next(new Error("Payment must belong to a client or an application."));
  }
  next();
});

paymentSchema.index({ client: 1, createdAt: -1 });
paymentSchema.index({ application: 1, createdAt: -1 });

export default mongoose.model("Payment", paymentSchema);
