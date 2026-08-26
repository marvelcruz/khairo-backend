import Order from "../models/Order.js";
import User from "../models/User.js";
import AuditLog from "../models/AuditLog.js";
import CatalogueItem from "../models/CatalogueItem.js";
import { logAudit } from "../utils/auditLogger.js";

export async function createOrderIfNeeded({ client, subscription, staffId }) {
  if (subscription?._id) {
    const existing = await Order.findOne({ subscription: subscription._id });
    if (existing) return existing;
  }

  const offeringId = subscription?.offering || client.programOffering || null;
  const offering = offeringId
    ? await CatalogueItem.findById(offeringId).lean()
    : null;

  const amount = Number(subscription?.amount ?? offering?.price ?? 0);
  const currency = String(offering?.currency || "NGN").toUpperCase();
  const offeringName =
    offering?.name ||
    `${String(client.program || "Khairo Diet Clinic").replaceAll("_", " ")} subscription`;

  let order;

  try {
    order = await Order.create({
      client: client._id,
      subscription: subscription?._id,
      sourceType: subscription?._id ? "subscription" : "manual",
      program: client.program,
      offering: offering?._id || offeringId || undefined,
      lineItems: [
        {
          offering: offering?._id || offeringId || undefined,
          name: offeringName,
          type: offering?.type || "program",
          sku: offering?.sku || undefined,
          quantity: 1,
          unitPrice: amount,
          currency,
          billingType: offering?.billing?.type || "recurring",
          billingInterval: offering?.billing?.interval || undefined,
        },
      ],
      currency,
      totalAmount: amount,
      fulfillmentRequired:
        offering?.fulfillment?.requiresFulfillment !== false,
      createdBy: staffId,
    });
  } catch (error) {
    if (error?.code === 11000 && subscription?._id) {
      return Order.findOne({ subscription: subscription._id });
    }
    throw error;
  }

  // Auto-assign to the least-loaded active order-processing staff member.
  // Keep this best-effort so assignment can never block order creation.
  try {
    const processors = await User.find({
      isActive: true,
      $or: [
        { permissions: "view_orders" },
        { roles: "staff" },
      ],
    }).select("_id name");

    if (processors.length) {
      const loads = [];
      for (const user of processors) {
        const open = await Order.countDocuments({
          assignedStaff: user._id,
          "delivered.done": { $ne: true },
        });
        const total = await Order.countDocuments({ assignedStaff: user._id });
        loads.push({ id: user._id, name: user.name, open, total });
      }
      loads.sort(
        (a, b) =>
          a.open - b.open ||
          a.total - b.total ||
          String(a.name).localeCompare(String(b.name))
      );
      order.assignedStaff = loads[0].id;
      await order.save();
      await AuditLog.create({
        userName: "System",
        action: "Auto-assigned order",
        entityType: "Order",
        entityId: order._id,
        details: `Assigned to ${loads[0].name} (least loaded order-processing staff)`,
      });
    }
  } catch {
    // Never block order creation because of auto-assignment.
  }

  return order;
}

// @route GET /api/orders (staff only) - optional ?stage=..., ?mine=true (assigned to the logged-in staff member)
export const listOrders = async (req, res, next) => {
  try {
    const { stage, mine } = req.query;
    const query = {};
    if (mine === "true") query.assignedStaff = req.user._id;

    let orders = await Order.find(query)
      .populate("client", "fullName email phone program")
      .populate("assignedStaff", "name")
      .populate("offering", "name type sku")
      .sort({ createdAt: -1 });

    if (stage) {
      orders = orders.filter((order) => order.currentStage === stage);
    }

    res.status(200).json({ success: true, orders });
  } catch (err) {
    next(err);
  }
};

// @route GET /api/orders/client/:clientId (staff only)
export const getClientOrder = async (req, res, next) => {
  try {
    const order = await Order.findOne({ client: req.params.clientId })
      .sort({ createdAt: -1 })
      .populate("client", "fullName email phone program")
      .populate("assignedStaff", "name")
      .populate("offering", "name type sku")
      .populate("prepared.by", "name")
      .populate("packed.by", "name")
      .populate("shipped.by", "name")
      .populate("delivered.by", "name");
    if (!order) return res.status(404).json({ success: false, message: "No order found for this client." });

    res.status(200).json({ success: true, order });
  } catch (err) {
    next(err);
  }
};

// @route GET /api/orders/:id (staff only)
export const getOrderById = async (req, res, next) => {
  try {
    const order = await Order.findById(req.params.id)
      .populate("client", "fullName email phone program")
      .populate("assignedStaff", "name")
      .populate("offering", "name type sku")
      .populate("prepared.by", "name")
      .populate("packed.by", "name")
      .populate("shipped.by", "name")
      .populate("delivered.by", "name");
    if (!order) return res.status(404).json({ success: false, message: "Order not found." });

    res.status(200).json({ success: true, order });
  } catch (err) {
    next(err);
  }
};

// @route PATCH /api/orders/:id/stage (staff only)
export const toggleStage = async (req, res, next) => {
  try {
    const { stage, done, courier, trackingNumber } = req.body;
    const validStages = ["prepared", "packed", "shipped", "delivered"];
    if (!validStages.includes(stage)) {
      return res.status(400).json({ success: false, message: "Invalid stage." });
    }

    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ success: false, message: "Order not found." });

    if (!order.fulfillmentRequired) {
      return res.status(409).json({
        success: false,
        message: "This order does not require physical fulfillment.",
      });
    }

    order[stage].done = !!done;
    order[stage].at = done ? new Date() : undefined;
    order[stage].by = done ? req.user._id : undefined;

    if (stage === "shipped") {
      if (courier !== undefined) order.shipped.courier = courier;
      if (trackingNumber !== undefined) order.shipped.trackingNumber = trackingNumber;
    }

    await order.save();

    await logAudit(req, `Marked order stage "${stage}" as ${done ? "done" : "not done"}`, "Order", order._id, "");

    res.status(200).json({ success: true, order });
  } catch (err) {
    next(err);
  }
};

// @route PATCH /api/orders/:id (staff only) - body: { deliveryAddress?, notes?, assignedStaff? }
export const updateOrder = async (req, res, next) => {
  try {
    const { deliveryAddress, notes, assignedStaff } = req.body;
    const order = await Order.findByIdAndUpdate(
      req.params.id,
      {
        ...(deliveryAddress !== undefined && { deliveryAddress }),
        ...(notes !== undefined && { notes }),
        ...(assignedStaff !== undefined && { assignedStaff: assignedStaff || null }),
      },
      { new: true }
    )
      .populate("client", "fullName email phone program")
      .populate("assignedStaff", "name")
      .populate("offering", "name type sku");
    if (!order) return res.status(404).json({ success: false, message: "Order not found." });

    res.status(200).json({ success: true, order });
  } catch (err) {
    next(err);
  }
};
