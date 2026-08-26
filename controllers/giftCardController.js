import GiftCard from "../models/GiftCard.js";
import { logAudit } from "../utils/auditLogger.js";

function normaliseCode(value) {
  return String(value || "").trim().toUpperCase();
}

export const listGiftCards = async (req, res, next) => {
  try {
    const giftCards = await GiftCard.find().sort({ createdAt: -1 }).lean();
    res.status(200).json({ success: true, giftCards });
  } catch (error) {
    next(error);
  }
};

export const createGiftCard = async (req, res, next) => {
  try {
    const code = normaliseCode(req.body?.code);
    const amount = Number(req.body?.amount);
    const expiresAt = req.body?.expiresAt ? new Date(req.body.expiresAt) : undefined;

    if (!code || !Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ success: false, message: "Valid code and amount are required." });
    }

    const existing = await GiftCard.findOne({ code });
    if (existing) {
      return res.status(409).json({ success: false, message: "A gift card with this code already exists." });
    }

    const giftCard = await GiftCard.create({
      code,
      amount,
      balance: amount,
      expiresAt,
      active: Boolean(req.body?.active ?? true),
      createdBy: req.user._id,
      updatedBy: req.user._id,
    });

    await logAudit(req, "Created gift card", "GiftCard", giftCard._id.toString(), code);
    res.status(201).json({ success: true, giftCard });
  } catch (error) {
    next(error);
  }
};

export const updateGiftCard = async (req, res, next) => {
  try {
    const giftCard = await GiftCard.findById(req.params.id);
    if (!giftCard) {
      return res.status(404).json({ success: false, message: "Gift card not found." });
    }

    if (req.body?.active !== undefined) giftCard.active = Boolean(req.body.active);
    if (req.body?.expiresAt !== undefined) giftCard.expiresAt = req.body.expiresAt ? new Date(req.body.expiresAt) : undefined;
    if (req.body?.amount !== undefined) {
      const amount = Number(req.body.amount);
      if (!Number.isFinite(amount) || amount <= 0) {
        return res.status(400).json({ success: false, message: "Invalid amount." });
      }
      giftCard.amount = amount;
      if (giftCard.balance === giftCard.amount) giftCard.balance = amount;
    }

    giftCard.updatedBy = req.user._id;
    await giftCard.save();

    await logAudit(req, "Updated gift card", "GiftCard", giftCard._id.toString(), giftCard.code);
    res.status(200).json({ success: true, giftCard });
  } catch (error) {
    next(error);
  }
};

export const deleteGiftCard = async (req, res, next) => {
  try {
    const giftCard = await GiftCard.findById(req.params.id);
    if (!giftCard) {
      return res.status(404).json({ success: false, message: "Gift card not found." });
    }
    await giftCard.deleteOne();
    await logAudit(req, "Deleted gift card", "GiftCard", giftCard._id.toString(), giftCard.code);
    res.status(200).json({ success: true });
  } catch (error) {
    next(error);
  }
};

export const validateGiftCard = async (req, res, next) => {
  try {
    const code = normaliseCode(req.body?.code);
    if (!code) {
      return res.status(400).json({ success: false, valid: false, message: "Gift card code is required." });
    }

    const giftCard = await GiftCard.findOne({ code, active: true });
    if (!giftCard) {
      return res.status(404).json({ success: false, valid: false, message: "This gift card is not valid." });
    }

    if (giftCard.expiresAt && new Date(giftCard.expiresAt).getTime() < Date.now()) {
      return res.status(400).json({ success: false, valid: false, message: "This gift card has expired." });
    }

    if (giftCard.balance <= 0) {
      return res.status(400).json({ success: false, valid: false, message: "This gift card has no remaining balance." });
    }

    res.status(200).json({
      success: true,
      valid: true,
      giftCard: {
        id: giftCard._id,
        code: giftCard.code,
        balance: giftCard.balance,
      },
    });
  } catch (error) {
    next(error);
  }
};
