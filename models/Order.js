import mongoose from "mongoose";

const stageSchema = new mongoose.Schema(
  {
    done: { type: Boolean, default: false },
    at: { type: Date },
    by: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { _id: false }
);

const orderLineItemSchema = new mongoose.Schema(
  {
    offering: { type: mongoose.Schema.Types.ObjectId, ref: "CatalogueItem" },
    name: { type: String, required: true, trim: true, maxlength: 180 },
    type: { type: String, trim: true, maxlength: 60 },
    sku: { type: String, trim: true, maxlength: 80 },
    quantity: { type: Number, min: 1, default: 1 },
    unitPrice: { type: Number, min: 0, default: 0 },
    currency: { type: String, trim: true, uppercase: true, default: "NGN" },
    billingType: { type: String, trim: true },
    billingInterval: { type: String, trim: true },
  },
  { _id: true }
);

const orderSchema = new mongoose.Schema(
  {
    client: { type: mongoose.Schema.Types.ObjectId, ref: "Client", required: true },

    // One subscription purchase creates one permanent order record. Renewals or
    // other subscriptions create their own order rather than reusing another one.
    subscription: { type: mongoose.Schema.Types.ObjectId, ref: "Subscription" },
    sourceType: {
      type: String,
      enum: ["subscription", "purchase", "manual"],
      default: "subscription",
      index: true,
    },

    // Legacy alias retained while Core/Plus/VIP flows migrate fully to catalogue.
    program: { type: String, trim: true },
    offering: { type: mongoose.Schema.Types.ObjectId, ref: "CatalogueItem" },

    // Commercial snapshot. The order remains intelligible even if catalogue
    // names/prices change later.
    lineItems: { type: [orderLineItemSchema], default: [] },
    currency: { type: String, trim: true, uppercase: true, default: "NGN" },
    totalAmount: { type: Number, min: 0, default: 0 },
    fulfillmentRequired: { type: Boolean, default: true },

    // Pipeline stages, in order. currentStage always reflects the furthest
    // completed stage - "created" means nothing below it is done yet.
    prepared: { type: stageSchema, default: () => ({}) },
    packed: { type: stageSchema, default: () => ({}) },
    shipped: {
      type: new mongoose.Schema(
        {
          done: { type: Boolean, default: false },
          at: { type: Date },
          by: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
          courier: { type: String, trim: true },
          trackingNumber: { type: String, trim: true },
        },
        { _id: false }
      ),
      default: () => ({}),
    },
    delivered: { type: stageSchema, default: () => ({}) },

    deliveryAddress: { type: String, trim: true },
    notes: { type: String, trim: true },

    assignedStaff: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

orderSchema.virtual("currentStage").get(function () {
  if (!this.fulfillmentRequired) return "confirmed";
  if (this.delivered?.done) return "delivered";
  if (this.shipped?.done) return "shipped";
  if (this.packed?.done) return "packed";
  if (this.prepared?.done) return "prepared";
  return "created";
});

orderSchema.virtual("meterColor").get(function () {
  const stage = this.currentStage;
  if (stage === "confirmed" || stage === "shipped" || stage === "delivered") return "green";
  if (stage === "prepared" || stage === "packed") return "yellow";
  return "red";
});

orderSchema.set("toJSON", { virtuals: true });
orderSchema.set("toObject", { virtuals: true });

orderSchema.index({ client: 1, createdAt: -1 });
orderSchema.index(
  { subscription: 1 },
  {
    unique: true,
    partialFilterExpression: { subscription: { $type: "objectId" } },
  }
);
orderSchema.index({ offering: 1, createdAt: -1 });

export default mongoose.model("Order", orderSchema);
