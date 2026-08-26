import mongoose from "mongoose";

const registrationSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true },
  phone: { type: String, required: true },
  application: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Application",
    default: null
  },
  attended: { type: Boolean, default: false },
  converted: { type: Boolean, default: false },
  registeredAt: { type: Date, default: Date.now }
}, { _id: true });

const trialEventSchema = new mongoose.Schema({
  title: { type: String, required: true, default: "Free Trial Day" },
  date: { type: Date, required: true },
  capacity: { type: Number, default: 20 },
  zoomLink: { type: String, default: "" },
  location: { type: String, default: "" },
  registrations: [registrationSchema],
  isActive: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now }
});

export default mongoose.model("TrialEvent", trialEventSchema);
