import mongoose from "mongoose";
import bcrypt from "bcryptjs";

const checkInSchema = new mongoose.Schema(
  {
    date: { type: Date, default: Date.now },
    weightKg: { type: Number },
    notes: { type: String, trim: true },
    recordedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { _id: true }
);

const mealChecklistItemSchema = new mongoose.Schema(
  {
    text: { type: String, required: true, trim: true },
    // Only meaningful for timetable items; flat checklist items leave this
    // at the default and the frontend ignores it there.
    period: { type: String, enum: ["morning", "afternoon", "evening"], default: "morning" },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: true }
);

// One entry per program day. In "weekly" mode dayNumber is 1-7 and repeats
// every 7 days from the client's startDate. In "full_cycle" mode dayNumber
// runs 1..(cycleWeeks*7) with no repeats across the whole program.
const exerciseSchema = new mongoose.Schema(
  {
    text: { type: String, required: true, trim: true },
    reps: { type: String, trim: true },
    duration: { type: String, trim: true },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: true }
);

const timetableDaySchema = new mongoose.Schema(
  {
    dayNumber: { type: Number, required: true, min: 1 },
    items: [mealChecklistItemSchema],
    exercises: [exerciseSchema],
  },
  { _id: true }
);

const week3ReviewSchema = new mongoose.Schema(
  {
    completed: { type: Boolean, default: false },
    outcome: {
      type: String,
      enum: ["not_set", "on_track", "needs_support", "escalate"],
      default: "not_set",
    },
    notes: { type: String, trim: true, maxlength: 3000 },
    completedAt: { type: Date },
    completedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    taskCreatedAt: { type: Date },
  },
  { _id: false }
);

const clientSchema = new mongoose.Schema({
  reconciled: { type: Boolean, default: false },

  programReconciliation: {
    status: {
      type: String,
      enum: ["pending", "matched", "mismatch"],
      default: "pending",
    },
    amountReceived: Number,
    expected: Number,
    paymentId: { type: mongoose.Schema.Types.ObjectId, ref: "Payment" },
    paymentAmount: { type: Number },
    ledgerMismatch: { type: Boolean, default: false },
    method: String,
    note: String,
    at: Date,
    by: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    byName: String,
  },

  adminReconciliationReview: {
    completed: { type: Boolean, default: false },
    note: String,
    at: Date,
    by: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    byName: String,
  },

  finalReconciliation: {
    completed: { type: Boolean, default: false },
    note: String,
    at: Date,
    by: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    byName: String,
  },
    fullName: { type: String, required: [true, "Full name is required"], trim: true },
    email: { type: String, required: [true, "Email is required"], trim: true, lowercase: true, unique: true },
    phone: { type: String, required: [true, "Phone is required"], trim: true },

    program: { type: String, enum: ["core", "plus", "vip", "not_sure"], required: true },
    // Transitional stable reference to the catalogue offering. The legacy
    // program string stays in place until every consumer has migrated.
    programOffering: { type: mongoose.Schema.Types.ObjectId, ref: "CatalogueItem" },
    startDate: { type: Date, default: Date.now },
    cycleWeeks: { type: Number, default: 8 },

    startingWeightKg: { type: Number },
    goalWeightKg: { type: Number },
    checkIns: [checkInSchema],

    mealPlanNotes: { type: String, trim: true },

    // Flat checklist (legacy/simple mode) - still supported.
    mealChecklist: [mealChecklistItemSchema],

    // Day-by-day meal timetable, starting the moment the subscription starts.
    mealTimetableMode: { type: String, enum: ["weekly", "full_cycle"], default: "weekly" },
    mealTimetable: [timetableDaySchema],

    privateNotes: { type: String, trim: true },

    lastReviewedAt: { type: Date },
    lastReviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },

    assignedCoach: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    assignedDoctor: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  dismissedFlags: [{ type: String, dismissedAt: Date, by: mongoose.Schema.Types.ObjectId, ref: "User" }],

    referredBy: { type: String, trim: true },
    referralCode: { type: String, trim: true, uppercase: true, maxlength: 24, sparse: true },

    status: {
      type: String,
      enum: ["active", "paused", "completed", "cancelled"],
      default: "active",
    },

    fromApplication: { type: mongoose.Schema.Types.ObjectId, ref: "Application" },
    addedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },

    password: { type: String, minlength: 8, select: false },
    googleId: { type: String, select: false, default: "" },
    appleId: { type: String, select: false, default: "" },
    portalActive: { type: Boolean, default: false },

    accountStage: {
      type: String,
      enum: ["preview", "active", "paused", "completed"],
      default: "active",
      index: true,
    },

    registeredFromPortal: {
      type: Boolean,
      default: false,
    },

    programStartedAt: {
      type: Date,
    },

    programEndsAt: {
      type: Date,
    },
  week3Review: {
    type: week3ReviewSchema,
    default: () => ({}),
  },
  onboarding: {
    loggedWeight: { type: Boolean, default: false },
    tickedMeal: { type: Boolean, default: false },
    bookedCall: { type: Boolean, default: false },
    joinedGroup: { type: Boolean, default: false }
  },
  calorieCalculation: {
    gender: { type: String, enum: ["male", "female"] },
    age: Number,
    heightCm: Number,
    weightKg: Number,
    activityLevel: String,
    tdeeKcal: Number,
    updatedAt: Date,
  },
    portalLastLogin: { type: Date },

    isArchived: { type: Boolean, default: false },
  followUpDay1Sent: { type: Boolean, default: false },
  followUpDay3Sent: { type: Boolean, default: false },
  followUpDay7Sent: { type: Boolean, default: false },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

clientSchema.virtual("currentWeightKg").get(function () {
  if (!this.checkIns || this.checkIns.length === 0) return this.startingWeightKg;
  const sorted = [...this.checkIns].sort((a, b) => new Date(b.date) - new Date(a.date));
  return sorted[0].weightKg ?? this.startingWeightKg;
});

clientSchema.pre("save", async function (next) {
  if (!this.isModified("password") || !this.password) return next();
  const salt = await bcrypt.genSalt(12);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

clientSchema.methods.comparePassword = async function (candidatePassword) {
  if (!this.password) return false;
  return bcrypt.compare(candidatePassword, this.password);
};

clientSchema.index({ fullName: "text", email: "text", phone: "text" });
clientSchema.index({ assignedCoach: 1, status: 1, isArchived: 1 });
clientSchema.index({ assignedDoctor: 1, status: 1, isArchived: 1 });

export default mongoose.model("Client", clientSchema);
