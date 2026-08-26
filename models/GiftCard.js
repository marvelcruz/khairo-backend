import mongoose from "mongoose";

const giftCardSchema = new mongoose.Schema(
  {
    code: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
      trim: true,
    },
    amount: {
      type: Number,
      required: true,
      min: 0,
    },
    balance: {
      type: Number,
      min: 0,
      default: function () {
        return this.amount;
      },
    },
    expiresAt: { type: Date },
    active: { type: Boolean, default: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    redeemedAt: { type: Date },
    redeemedBy: { type: mongoose.Schema.Types.ObjectId, ref: "Client" },
    redemptionPayment: { type: mongoose.Schema.Types.ObjectId, ref: "Payment" },
  },
  { timestamps: true }
);

export default mongoose.model("GiftCard", giftCardSchema);
