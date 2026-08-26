import CrmOpportunity from "../models/CrmOpportunity.js";
import Payment from "../models/Payment.js";
import { ensurePaymentPendingClientForOpportunity } from "../services/paymentPendingService.js";

export const getPaymentPendingQueue = async (req, res, next) => {
  try {
    const opportunities = await CrmOpportunity.find({
      stage: "payment_pending",
      status: "open",
    })
      .sort({ stageEnteredAt: 1, createdAt: 1 })
      .populate("contact", "fullName email phone programInterest preferredContactMethod lifecycleStage client")
      .populate("assignedTo", "name roles")
      .limit(200);

    for (const opportunity of opportunities) {
      if (!opportunity.client) {
        try {
          await ensurePaymentPendingClientForOpportunity(opportunity);
        } catch (error) {
          console.error(
            "Payment Pending client preparation failed:",
            opportunity._id,
            error?.message || error
          );
        }
      }
    }

    const refreshed = await CrmOpportunity.find({
      _id: { $in: opportunities.map((item) => item._id) },
    })
      .sort({ stageEnteredAt: 1, createdAt: 1 })
      .populate("contact", "fullName email phone programInterest preferredContactMethod lifecycleStage client")
      .populate("assignedTo", "name roles")
      .lean();

    const clientIds = refreshed
      .map((item) => item.client)
      .filter(Boolean);

    const payments = clientIds.length
      ? await Payment.find({ client: { $in: clientIds } })
          .select("client receiptNumber amount currency purpose status paidAt createdAt")
          .sort({ createdAt: -1 })
          .lean()
      : [];

    const latestPaymentByClient = new Map();
    for (const payment of payments) {
      const key = String(payment.client);
      if (!latestPaymentByClient.has(key)) {
        latestPaymentByClient.set(key, payment);
      }
    }

    const items = refreshed.map((opportunity) => {
      const contact = opportunity.contact || {};
      const clientId = opportunity.client ? String(opportunity.client) : "";
      const latestPayment = clientId
        ? latestPaymentByClient.get(clientId) || null
        : null;

      return {
        opportunityId: String(opportunity._id),
        contactId: contact?._id ? String(contact._id) : "",
        clientId,
        fullName: contact.fullName || "Unknown client",
        email: contact.email || "",
        phone: contact.phone || "",
        preferredContactMethod: contact.preferredContactMethod || "no_preference",
        program:
          opportunity.programInterest ||
          contact.programInterest ||
          "not_sure",
        assignedTo: opportunity.assignedTo || null,
        stageEnteredAt: opportunity.stageEnteredAt,
        payment: latestPayment,
        readyForPayment: Boolean(clientId && contact.email),
      };
    });

    res.status(200).json({
      success: true,
      count: items.length,
      items,
    });
  } catch (error) {
    next(error);
  }
};
