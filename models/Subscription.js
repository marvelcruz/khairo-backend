import mongoose from "mongoose";

const subscriptionSchema = new mongoose.Schema(
  {
    client: { type: mongoose.Schema.Types.ObjectId, ref: "Client", required: true },
    program: { type: String, enum: ["core", "plus", "vip"], required: true },
    // Stable offering identity. The program string remains as a legacy alias
    // until payment/order/client flows are fully catalogue-backed.
    offering: { type: mongoose.Schema.Types.ObjectId, ref: "CatalogueItem" },
    amount: { type: Number, required: true, min: 0 }, // snapshot at activation, Naira

    cycleDays: { type: Number, default: 30 },
    currentPeriodStart: { type: Date },
    currentPeriodEnd: { type: Date },

    status: {
      type: String,
      enum: ["pending", "active", "grace_period", "paused", "expired", "cancelled"],
      default: "pending",
    },

    autoRenew: { type: Boolean, default: true },

    paystackCustomerCode: { type: String },
    paystackAuthorizationCode: { type: String }, // saved card, for auto-renewal charges

    lastPaymentAt: { type: Date },
    gracePeriodEnd: { type: Date },
    gracePeriodNotifiedAt: { type: Date },
    renewalRemindersSent: {
      day27: { type: Boolean, default: false },
      day29: { type: Boolean, default: false },
    },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

subscriptionSchema.index({ client: 1, status: 1 });

export default mongoose.model("Subscription", subscriptionSchema);
