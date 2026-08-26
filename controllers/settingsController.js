import Pricing from "../models/Pricing.js";
import BusinessSettings from "../models/BusinessSettings.js";
import { logAudit } from "../utils/auditLogger.js";

const BUSINESS_KEY = "business";

const DEFAULT_BUSINESS_SETTINGS = {
  key: BUSINESS_KEY,
  profile: {
    displayName: "KhairoDietClinic",
    legalName: "",
    email: "",
    phone: "",
    website: "https://khairo.com",
    address: "",
  },
  regional: {
    country: "NG",
    timeZone: "Africa/Lagos",
    currency: "NGN",
    dateFormat: "DD/MM/YYYY",
    taxLabel: "",
    defaultTaxRate: 0,
  },
  branding: {
    primaryColor: "#EC008C",
    publicName: "KhairoDietClinic",
  },
  communication: {
    senderName: "KhairoDietClinic",
    replyToEmail: "",
    whatsappNumber: "",
    supportPhone: "",
    emailNotifications: true,
    administrativeAlerts: true,
    clientCommunicationReminders: true,
  },
  growth: {
    promoCodesEnabled: false,
    promoDefaultDiscountType: "percentage",
    promoDefaultDiscountValue: 10,
    promoDefaultExpiryDays: 30,
    promoDefaultMaxUses: 0,
    abandonedPaymentRecoveryEnabled: false,
    abandonedRecoveryDelayHours: 24,
    abandonedRecoveryEmailEnabled: true,
    referralProgramEnabled: false,
    referralRewardType: "percentage",
    referralRewardValue: 10,
    winBackEnabled: false,
    winBackThresholdDays: 30,
    winBackOfferType: "percentage",
    winBackOfferValue: 15,
    oneClickRenewalEnabled: false,
    giftCardsEnabled: false,
    upsellsEnabled: false,
    winBackMessage: "We miss you! Here is a special offer to rejoin KhairoDietClinic.",
  },

  operations: {
    defaultAppointmentDuration: 60,
    defaultClientStatus: "active",
    allowStaffNotifications: true,
    showClientContactByDefault: true,
  },
  automations: {
    newSignupAdminNotification: {
      enabled: false,
      email: true,
      createTask: true,
    },
    qualificationFollowUp: {
      enabled: false,
      delayDays: 2,
    },
    monthlyReviews: {
      enabled: false,
      month3: true,
      month6: true,
      month9: true,
      reviewDueDays: 0,
    },
    clientActivationNotification: {
      enabled: false,
      email: true,
      createTask: true,
    },
  },
};

function businessPayload(settings) {
  const value = settings
    ? settings.toObject()
    : DEFAULT_BUSINESS_SETTINGS;

  return {
    ...DEFAULT_BUSINESS_SETTINGS,
    ...value,
    profile: {
      ...DEFAULT_BUSINESS_SETTINGS.profile,
      ...(value.profile || {}),
    },
    regional: {
      ...DEFAULT_BUSINESS_SETTINGS.regional,
      ...(value.regional || {}),
    },
    branding: {
      ...DEFAULT_BUSINESS_SETTINGS.branding,
      ...(value.branding || {}),
    },
    communication: {
      ...DEFAULT_BUSINESS_SETTINGS.communication,
      ...(value.communication || {}),
    },
    operations: {
      ...DEFAULT_BUSINESS_SETTINGS.operations,
      ...(value.operations || {}),
    },
    growth: {
      ...DEFAULT_BUSINESS_SETTINGS.growth,
      ...(value.growth || {}),
    },
    automations: {
      ...DEFAULT_BUSINESS_SETTINGS.automations,
      ...(value.automations || {}),
    },
  };
}

export const getConsultationFee = async (req, res, next) => {
  try {
    let pricing = await Pricing.findOne();
    if (!pricing) pricing = await Pricing.create({});

    res.status(200).json({
      success: true,
      fee: pricing.consultationFee || 15000,
    });
  } catch (err) {
    next(err);
  }
};

export const updateConsultationFee = async (req, res, next) => {
  try {
    const { fee } = req.body;

    let pricing = await Pricing.findOne();
    if (!pricing) pricing = await Pricing.create({});

    pricing.consultationFee = fee;
    await pricing.save();

    res.status(200).json({
      success: true,
      fee: pricing.consultationFee,
    });
  } catch (err) {
    next(err);
  }
};

export const getBusinessSettings = async (req, res, next) => {
  try {
    const settings = await BusinessSettings.findOne({
      key: BUSINESS_KEY,
    });

    res.status(200).json({
      success: true,
      settings: businessPayload(settings),
      persisted: Boolean(settings),
    });
  } catch (err) {
    next(err);
  }
};

export const updateBusinessSettings = async (
  req,
  res,
  next
) => {
  try {
    const allowedSections = [
      "profile",
      "regional",
      "branding",
      "communication",
      "operations",
      "growth",
      "automations",
    ];

    const update = {};

    for (const section of allowedSections) {
      if (
        req.body[section] &&
        typeof req.body[section] === "object" &&
        !Array.isArray(req.body[section])
      ) {
        for (const [field, value] of Object.entries(
          req.body[section]
        )) {
          update[`${section}.${field}`] = value;
        }
      }
    }

    update.updatedBy = req.user._id;

    const settings = await BusinessSettings.findOneAndUpdate(
      { key: BUSINESS_KEY },
      {
        $set: update,
        $setOnInsert: { key: BUSINESS_KEY },
      },
      {
        new: true,
        upsert: true,
        runValidators: true,
        setDefaultsOnInsert: true,
      }
    );

    await logAudit(
      req,
      "Updated business configuration",
      "BusinessSettings",
      settings._id.toString(),
      "Business-wide configuration"
    );

    res.status(200).json({
      success: true,
      settings: businessPayload(settings),
    });
  } catch (err) {
    if (err?.name === "ValidationError") {
      return res.status(400).json({
        success: false,
        message:
          Object.values(err.errors)
            .map((item) => item.message)
            .join(" ") ||
          "Invalid business configuration.",
      });
    }

    next(err);
  }
};
