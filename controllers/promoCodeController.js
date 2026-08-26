import PromoCode from "../models/PromoCode.js";
import { logAudit } from "../utils/auditLogger.js";

function normaliseCode(value) {
  return String(value || "").trim().toUpperCase();
}

function promoDto(promoCode) {
  return promoCode?.toObject ? promoCode.toObject() : promoCode;
}

export const listPromoCodes = async (req, res, next) => {
  try {
    const promoCodes = await PromoCode.find().sort({ createdAt: -1 }).lean();
    res.status(200).json({ success: true, promoCodes });
  } catch (error) {
    next(error);
  }
};

export const createPromoCode = async (req, res, next) => {
  try {
    const code = normaliseCode(req.body?.code);
    const description = String(req.body?.description || "").trim();
    const discountType = String(req.body?.discountType || "percentage").trim();
    const discountValue = Number(req.body?.discountValue);
    const maxUses = Math.max(0, Number(req.body?.maxUses) || 0);
    const active = Boolean(req.body?.active ?? true);
    const expiresAt = req.body?.expiresAt ? new Date(req.body.expiresAt) : undefined;

    if (!code) {
      return res.status(400).json({ success: false, message: "Promo code is required." });
    }
    if (!["percentage", "fixed"].includes(discountType)) {
      return res.status(400).json({ success: false, message: "Choose percentage or fixed discount." });
    }
    if (!Number.isFinite(discountValue) || discountValue < 0) {
      return res.status(400).json({ success: false, message: "Discount value must be zero or greater." });
    }
    if (discountType === "percentage" && discountValue > 100) {
      return res.status(400).json({ success: false, message: "Percentage discount cannot exceed 100." });
    }

    const existing = await PromoCode.findOne({ code });
    if (existing) {
      return res.status(409).json({ success: false, message: "A promo code with this code already exists." });
    }

    const promoCode = await PromoCode.create({
      code,
      description,
      discountType,
      discountValue,
      maxUses,
      active,
      expiresAt,
      createdBy: req.user._id,
      updatedBy: req.user._id,
    });

    await logAudit(req, "Created promo code", "PromoCode", promoCode._id.toString(), code);
    res.status(201).json({ success: true, promoCode });
  } catch (error) {
    next(error);
  }
};

export const updatePromoCode = async (req, res, next) => {
  try {
    const promoCode = await PromoCode.findById(req.params.id);
    if (!promoCode) {
      return res.status(404).json({ success: false, message: "Promo code not found." });
    }

    const description = req.body?.description !== undefined ? String(req.body.description).trim() : promoCode.description;
    const discountType = req.body?.discountType !== undefined ? String(req.body.discountType).trim() : promoCode.discountType;
    const discountValue = req.body?.discountValue !== undefined ? Number(req.body.discountValue) : promoCode.discountValue;
    const maxUses = req.body?.maxUses !== undefined ? Math.max(0, Number(req.body.maxUses) || 0) : promoCode.maxUses;
    const active = req.body?.active !== undefined ? Boolean(req.body.active) : promoCode.active;
    const expiresAt = req.body?.expiresAt !== undefined ? (req.body.expiresAt ? new Date(req.body.expiresAt) : undefined) : promoCode.expiresAt;

    if (!["percentage", "fixed"].includes(discountType)) {
      return res.status(400).json({ success: false, message: "Choose percentage or fixed discount." });
    }
    if (!Number.isFinite(discountValue) || discountValue < 0) {
      return res.status(400).json({ success: false, message: "Discount value must be zero or greater." });
    }
    if (discountType === "percentage" && discountValue > 100) {
      return res.status(400).json({ success: false, message: "Percentage discount cannot exceed 100." });
    }

    promoCode.description = description;
    promoCode.discountType = discountType;
    promoCode.discountValue = discountValue;
    promoCode.maxUses = maxUses;
    promoCode.active = active;
    promoCode.expiresAt = expiresAt;
    promoCode.updatedBy = req.user._id;
    await promoCode.save();

    await logAudit(req, "Updated promo code", "PromoCode", promoCode._id.toString(), promoCode.code);
    res.status(200).json({ success: true, promoCode });
  } catch (error) {
    next(error);
  }
};

export const deletePromoCode = async (req, res, next) => {
  try {
    const promoCode = await PromoCode.findById(req.params.id);
    if (!promoCode) {
      return res.status(404).json({ success: false, message: "Promo code not found." });
    }
    await promoCode.deleteOne();
    await logAudit(req, "Deleted promo code", "PromoCode", promoCode._id.toString(), promoCode.code);
    res.status(200).json({ success: true });
  } catch (error) {
    next(error);
  }
};

export const validatePromoCode = async (req, res, next) => {
  try {
    const code = normaliseCode(req.body?.code || req.params.code);
    if (!code) {
      return res.status(400).json({ success: false, message: "Promo code is required." });
    }

    const promoCode = await PromoCode.findOne({ code, active: true });
    if (!promoCode) {
      return res.status(404).json({ success: false, valid: false, message: "This promo code is not valid." });
    }

    if (promoCode.expiresAt && new Date(promoCode.expiresAt).getTime() < Date.now()) {
      return res.status(400).json({ success: false, valid: false, message: "This promo code has expired." });
    }

    if (promoCode.maxUses > 0 && promoCode.currentUses >= promoCode.maxUses) {
      return res.status(400).json({ success: false, valid: false, message: "This promo code has reached its usage limit." });
    }

    res.status(200).json({
      success: true,
      valid: true,
      promoCode: {
        id: promoCode._id,
        code: promoCode.code,
        discountType: promoCode.discountType,
        discountValue: promoCode.discountValue,
      },
    });
  } catch (error) {
    next(error);
  }
};
