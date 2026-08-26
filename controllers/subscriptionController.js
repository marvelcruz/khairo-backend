import Subscription from "../models/Subscription.js";

const STATUSES = [
  "pending",
  "active",
  "grace_period",
  "paused",
  "expired",
  "cancelled",
];

export const listSubscriptions = async (req, res, next) => {
  try {
    const status = String(req.query.status || "all");
    const q = String(req.query.q || "").trim().toLowerCase();
    const limit = Math.min(
      200,
      Math.max(1, Number(req.query.limit) || 100)
    );

    if (status !== "all" && !STATUSES.includes(status)) {
      return res.status(400).json({
        success: false,
        message: "Invalid subscription status filter.",
      });
    }

    const query = {};

    if (status !== "all") {
      query.status = status;
    }

    let subscriptions = await Subscription.find(query)
      .populate(
        "client",
        "fullName email phone program status"
      )
      .populate(
        "offering",
        "name slug type price currency billing isActive"
      )
      .sort({
        currentPeriodEnd: 1,
        createdAt: -1,
      })
      .limit(limit);

    if (q) {
      subscriptions = subscriptions.filter((subscription) => {
        const clientName =
          subscription.client?.fullName || "";
        const clientEmail =
          subscription.client?.email || "";
        const offeringName =
          subscription.offering?.name || "";
        const program =
          subscription.program || "";
        const subscriptionStatus =
          subscription.status || "";

        return [
          clientName,
          clientEmail,
          offeringName,
          program,
          subscriptionStatus,
        ]
          .join(" ")
          .toLowerCase()
          .includes(q);
      });
    }

    return res.status(200).json({
      success: true,
      subscriptions,
      statuses: STATUSES,
    });
  } catch (err) {
    next(err);
  }
};
