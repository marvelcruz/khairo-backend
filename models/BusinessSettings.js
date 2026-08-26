import mongoose from "mongoose";

const businessSettingsSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      default: "business",
      unique: true,
      immutable: true,
    },

    profile: {
      displayName: {
        type: String,
        trim: true,
        default: "KhairoDietClinic",
        maxlength: 120,
      },
      legalName: {
        type: String,
        trim: true,
        default: "",
        maxlength: 180,
      },
      email: {
        type: String,
        trim: true,
        lowercase: true,
        default: "",
        maxlength: 180,
      },
      phone: {
        type: String,
        trim: true,
        default: "",
        maxlength: 80,
      },
      website: {
        type: String,
        trim: true,
        default: "https://khairo.com",
        maxlength: 300,
      },
      address: {
        type: String,
        trim: true,
        default: "",
        maxlength: 500,
      },
    },

    regional: {
      country: {
        type: String,
        enum: ["NG", "CA", "US", "GB"],
        default: "NG",
      },
      timeZone: {
        type: String,
        enum: [
          "Africa/Lagos",
          "America/Edmonton",
          "America/Toronto",
          "Europe/London",
        ],
        default: "Africa/Lagos",
      },
      currency: {
        type: String,
        enum: ["NGN", "CAD", "USD", "GBP"],
        default: "NGN",
      },
      dateFormat: {
        type: String,
        enum: ["DD/MM/YYYY", "MM/DD/YYYY", "YYYY-MM-DD"],
        default: "DD/MM/YYYY",
      },
      taxLabel: {
        type: String,
        trim: true,
        default: "",
        maxlength: 40,
      },
      defaultTaxRate: {
        type: Number,
        min: 0,
        max: 100,
        default: 0,
      },
    },

    branding: {
      primaryColor: {
        type: String,
        default: "#EC008C",
        match: /^#[0-9A-Fa-f]{6}$/,
      },
      publicName: {
        type: String,
        trim: true,
        default: "KhairoDietClinic",
        maxlength: 120,
      },
    },

    communication: {
      senderName: {
        type: String,
        trim: true,
        default: "KhairoDietClinic",
        maxlength: 120,
      },
      replyToEmail: {
        type: String,
        trim: true,
        lowercase: true,
        default: "",
        maxlength: 180,
      },
      whatsappNumber: {
        type: String,
        trim: true,
        default: "",
        maxlength: 80,
      },
      supportPhone: {
        type: String,
        trim: true,
        default: "",
        maxlength: 80,
      },
      emailNotifications: {
        type: Boolean,
        default: true,
      },
      administrativeAlerts: {
        type: Boolean,
        default: true,
      },
      clientCommunicationReminders: {
        type: Boolean,
        default: true,
      },
    },

    growth: {
      promoCodesEnabled: {
        type: Boolean,
        default: false,
      },
      promoDefaultDiscountType: {
        type: String,
        enum: ["percentage", "fixed"],
        default: "percentage",
      },
      promoDefaultDiscountValue: {
        type: Number,
        default: 10,
      },
      promoDefaultExpiryDays: {
        type: Number,
        default: 30,
      },
      promoDefaultMaxUses: {
        type: Number,
        default: 0,
      },
      abandonedPaymentRecoveryEnabled: {
        type: Boolean,
        default: false,
      },
      abandonedRecoveryDelayHours: {
        type: Number,
        min: 1,
        max: 168,
        default: 24,
      },
      abandonedRecoveryEmailEnabled: {
        type: Boolean,
        default: true,
      },
      referralProgramEnabled: {
        type: Boolean,
        default: false,
      },
      referralRewardType: {
        type: String,
        enum: ["percentage", "fixed"],
        default: "percentage",
      },
      referralRewardValue: {
        type: Number,
        min: 0,
        default: 10,
      },
      winBackEnabled: {
        type: Boolean,
        default: false,
      },
      winBackThresholdDays: {
        type: Number,
        min: 1,
        max: 365,
        default: 30,
      },
      winBackOfferType: {
        type: String,
        enum: ["percentage", "fixed"],
        default: "percentage",
      },
      winBackOfferValue: {
        type: Number,
        min: 0,
        default: 15,
      },
      oneClickRenewalEnabled: {
        type: Boolean,
        default: false,
      },
      giftCardsEnabled: {
        type: Boolean,
        default: false,
      },
      upsellsEnabled: {
        type: Boolean,
        default: false,
      },
      winBackMessage: {
        type: String,
        trim: true,
        maxlength: 1000,
        default: "We miss you! Here is a special offer to rejoin KhairoDietClinic.",
      },
    },

    automations: {
      newSignupAdminNotification: {
        enabled: { type: Boolean, default: false },
        email: { type: Boolean, default: true },
        createTask: { type: Boolean, default: true },
      },
      qualificationFollowUp: {
        enabled: { type: Boolean, default: false },
        delayDays: { type: Number, min: 1, max: 30, default: 2 },
      },
      monthlyReviews: {
        enabled: { type: Boolean, default: false },
        month3: { type: Boolean, default: true },
        month6: { type: Boolean, default: true },
        month9: { type: Boolean, default: true },
        reviewDueDays: { type: Number, min: 0, max: 30, default: 0 },
      },
      clientActivationNotification: {
        enabled: { type: Boolean, default: false },
        email: { type: Boolean, default: true },
        createTask: { type: Boolean, default: true },
      },
    },

    operations: {
      defaultAppointmentDuration: {
        type: Number,
        enum: [30, 45, 60, 90],
        default: 60,
      },
      defaultClientStatus: {
        type: String,
        enum: ["active", "paused", "completed", "cancelled"],
        default: "active",
      },
      allowStaffNotifications: {
        type: Boolean,
        default: true,
      },
      showClientContactByDefault: {
        type: Boolean,
        default: true,
      },
    },

    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  {
    timestamps: true,
    strict: true,
  }
);

export default mongoose.model(
  "BusinessSettings",
  businessSettingsSchema
);
