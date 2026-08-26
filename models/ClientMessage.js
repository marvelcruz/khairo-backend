import mongoose from "mongoose";

const clientMessageSchema =
  new mongoose.Schema(
    {
      client: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Client",
        required: true,
        index: true,
      },

      senderType: {
        type: String,
        enum: ["client", "staff"],
        required: true,
      },

      senderName: {
        type: String,
        trim: true,
      },

      category: {
        type: String,
        enum: [
          "general",
          "plan",
          "appointment",
          "billing",
          "technical",
          "help",
        ],
        default: "general",
      },

      body: {
        type: String,
        required: true,
        trim: true,
        maxlength: 3000,
      },

      readByClient: {
        type: Boolean,
        default: false,
      },

      readByStaff: {
        type: Boolean,
        default: false,
      },
    },
    { timestamps: true }
  );

clientMessageSchema.index({
  client: 1,
  createdAt: 1,
});

export default mongoose.model(
  "ClientMessage",
  clientMessageSchema
);
