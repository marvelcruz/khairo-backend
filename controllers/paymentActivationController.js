import crypto from "crypto";
import Client from "../models/Client.js";
import Payment from "../models/Payment.js";
import PromoCode from "../models/PromoCode.js";
import GiftCard from "../models/GiftCard.js";
import Pricing from "../models/Pricing.js";
import { generatePaymentReference, generateReceiptNumber } from "../utils/generateReference.js";
import { verifyTransaction } from "../utils/paystack.js";
import {
  activateVerifiedSubscription,
  findActivationApplication,
} from "../services/subscriptionActivationService.js";

const SUBSCRIPTION_PURPOSES = new Set([
  "new_subscription",
  "renewal",
  "upgrade",
  "combined",
  "program",
]);

function asDate(value) {
  if (!value) return new Date();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

async function markPaymentSuccessful(payment, data = {}) {
  if (payment.status !== "success") {
    payment.status = "success";
  }

  payment.paidAt = payment.paidAt || asDate(data.paid_at || data.paidAt);
  payment.channel = data.channel || payment.channel;
  payment.authorizationCode =
    data?.authorization?.authorization_code || payment.authorizationCode;
  payment.cardLast4 = data?.authorization?.last4 || payment.cardLast4;
  payment.bank = data?.authorization?.bank || payment.bank;

  if (data && Object.keys(data).length) {
    payment.rawWebhookEvent = data;
  }

  await payment.save();
}

async function updateConsultationPayment(payment, client) {
  if (!["consultation", "combined"].includes(payment.purpose)) return;

  const application = payment.application
    ? await findActivationApplication(client)
    : await findActivationApplication(client);

  if (!application) return;

  application.consultationPaid = true;
  application.timeline = application.timeline || {};
  application.timeline.consultationPaid = {
    at: payment.paidAt || new Date(),
    by: payment.purpose === "combined" ? "Paystack (combined)" : "Paystack",
    amount: payment.amount,
  };
  await application.save();
}

async function applyGiftCardUse(payment) {
  if (payment.giftCardUseCounted || !payment.giftCardCode || !payment.giftCardAmount) return;

  const giftCard = await GiftCard.findOne({
    code: payment.giftCardCode,
    active: true,
  });

  if (giftCard) {
    giftCard.balance = Math.max(0, (giftCard.balance || 0) - payment.giftCardAmount);
    giftCard.redeemedAt = new Date();
    giftCard.redeemedBy = payment.client || giftCard.redeemedBy;
    giftCard.redemptionPayment = payment._id;
    await giftCard.save();

    payment.giftCardUseCounted = true;
    await payment.save();
  }
}

async function applyPromoUse(payment) {
  if (payment.promoUseCounted || !payment.promoCode) return;

  const promo = await PromoCode.findOne({
    code: payment.promoCode,
    active: true,
  });

  if (promo) {
    promo.currentUses = (promo.currentUses || 0) + 1;
    await promo.save();
    payment.promoUseCounted = true;
    await payment.save();
  }
}

export async function processSuccessfulPayment(payment, paystackData = {}) {
  await markPaymentSuccessful(payment, paystackData);
  await applyPromoUse(payment);
  await applyGiftCardUse(payment);

  const client = payment.client
    ? await Client.findById(payment.client)
    : null;

  if (!client) return payment;

  await updateConsultationPayment(payment, client);

  if (
    payment.purpose === "consultation" ||
    !SUBSCRIPTION_PURPOSES.has(payment.purpose)
  ) {
    dispatchWorkflowEvent({
      type: "payment_success",
      eventKey: `payment_success:${payment._id}:${payment.purpose || "payment"}`,
      clientId: client._id,
      applicationId: payment.application,
      actorName: "Paystack Payment",
      data: {
        clientName: client.fullName,
        programInterest: client.program,
        paymentAmount: payment.amount,
        purpose: payment.purpose,
      },
    }).catch((error) =>
      console.error("Payment success workflow trigger failed:", error.message)
    );

    return payment;
  }

  const subscription = await activateVerifiedSubscription({
    payment,
    client,
    paystackData,
    userName: "Paystack Payment",
  });

  dispatchWorkflowEvent({
    type: "payment_success",
    eventKey: `payment_success:${payment._id}:${payment.purpose || "payment"}`,
    clientId: client._id,
    applicationId: payment.application,
    actorName: "Paystack Payment",
    data: {
      clientName: client.fullName,
      programInterest: client.program,
      paymentAmount: payment.amount,
      purpose: payment.purpose,
    },
  }).catch((error) =>
    console.error("Payment success workflow trigger failed:", error.message)
  );

  return payment;
}

export async function persistVerifiedPaymentStatus(payment, paystackData = {}) {
  const status = String(paystackData?.status || "").trim().toLowerCase();

  if (status === "success") {
    await processSuccessfulPayment(payment, paystackData);
    return "success";
  }

  if (["failed", "abandoned"].includes(status)) {
    payment.status = status;
    payment.rawWebhookEvent = paystackData;
    payment.channel = paystackData.channel || payment.channel;
    await payment.save();
    return status;
  }

  return payment.status === "success" ? "success" : "pending";
}

export const handlePaystackWebhook = async (req, res) => {
  try {
    const signature = req.headers["x-paystack-signature"];
    const secret = process.env.PAYSTACK_SECRET_KEY;

    if (!secret || !req.rawBody) {
      return res.status(503).json({
        success: false,
        message: "Paystack webhook verification is not configured.",
      });
    }

    const hash = crypto
      .createHmac("sha512", secret)
      .update(req.rawBody)
      .digest("hex");

    if (hash !== signature) {
      return res.status(401).json({
        success: false,
        message: "Invalid signature",
      });
    }

    const event = req.body;

    if (event?.event === "charge.success") {
      const payment = await Payment.findOne({
        reference: event?.data?.reference,
      });

      if (payment) {
        await processSuccessfulPayment(payment, event.data || {});
      }
    }

    return res.sendStatus(200);
  } catch (error) {
    console.error("Paystack webhook activation error:", error);
    // A non-2xx response allows Paystack to retry a valid event if our
    // downstream activation work temporarily fails.
    return res.sendStatus(500);
  }
};

export const verifyPayment = async (req, res, next) => {
  try {
    const payment = await Payment.findOne({
      reference: req.params.reference,
    });

    if (!payment) {
      return res.status(404).json({
        success: false,
        message: "Payment not found",
      });
    }

    if (
      payment.client &&
      String(payment.client) !== String(req.client?._id)
    ) {
      return res.status(404).json({
        success: false,
        message: "Payment not found",
      });
    }

    if (payment.status === "success") {
      await processSuccessfulPayment(
        payment,
        payment.rawWebhookEvent || {}
      );

      return res.status(200).json({
        success: true,
        status: "success",
        payment,
      });
    }

    const paystackRes = await verifyTransaction(payment.reference);
    const verifiedStatus = await persistVerifiedPaymentStatus(
      payment,
      paystackRes.data || {}
    );

    return res.status(200).json({
      success: true,
      status: verifiedStatus,
      ...(verifiedStatus !== "pending" ? { payment } : {}),
    });
  } catch (error) {
    next(error);
  }
};

export const manualActivateClient = async (req, res, next) => {
  try {
    const { method = "cash", note = "" } = req.body || {};
    const allowedMethods = new Set(["cash", "bank_transfer", "other"]);

    if (!allowedMethods.has(method)) {
      return res.status(400).json({
        success: false,
        message: "Choose cash, bank transfer, or other as the payment method.",
      });
    }

    const client = await Client.findById(req.params.id);

    if (!client) {
      return res.status(404).json({
        success: false,
        message: "Client not found",
      });
    }

    const pricing = await Pricing.findOne();
    const amount =
      pricing?.programs?.find((item) => item.key === client.program)?.price ||
      pricing?.[client.program] ||
      null;

    if (!amount || Number(amount) <= 0) {
      return res.status(400).json({
        success: false,
        message: `No price configured for program "${client.program}"`,
      });
    }

    const application = await findActivationApplication(client);
    const reference = `MANUAL-${generatePaymentReference()}`;

    const payment = await Payment.create({
      receiptNumber: await generateReceiptNumber(Payment),
      client: client._id,
      application: application?._id || undefined,
      purpose:
        client.accountStage === "preview" || !client.reconciled
          ? "program"
          : "renewal",
      amount: Number(amount),
      reference,
      status: "success",
      channel: `manual_${method}`,
      paidAt: new Date(),
      rawWebhookEvent: {
        manualActivation: true,
        method,
        note: String(note || "").trim(),
        staffId: req.user._id.toString(),
      },
    });

    const subscription = await activateVerifiedSubscription({
      payment,
      client,
      staffId: req.user._id,
      userName: req.user.name,
      manualMethod: method,
    });

    return res.status(200).json({
      success: true,
      client,
      payment,
      subscription,
    });
  } catch (error) {
    next(error);
  }
};
