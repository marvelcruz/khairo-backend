import Client from "../models/Client.js";
import Payment from "../models/Payment.js";
import MessageTemplate from "../models/MessageTemplate.js";

export const runFollowUp = async (req, res, next) => {
  try {
    const { secret } = req.query;
    if (!process.env.FOLLOW_UP_SECRET || secret !== process.env.FOLLOW_UP_SECRET) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const now = new Date();
    const due = [];

    const paidProgramClientIds =
      await Payment.distinct("client", {
        status: "success",
        purpose: "program",
      });

    const unpaidClients = await Client.find({
      isArchived: false,
      reconciled: false,
      _id: { $nin: paidProgramClientIds },
    });

    for (const client of unpaidClients) {
      const days = Math.floor((now - new Date(client.createdAt)) / 86400000);
      const phone = (client.phone || "").replace(/\D/g, "");
      const payLink = (process.env.FRONTEND_URL || "https://khairo-frontend-kappa.vercel.app") + "/portal/login";
      const first = (client.fullName || "").split(" ")[0];

      let day = null;
      let text = "";

      let templateKey = null;
      if (days >= 1 && !client.followUpDay1Sent) {
        day = 1;
        templateKey = client.portalActive ? "day1_activated" : "day1_not_activated";
        client.followUpDay1Sent = true;
      } else if (days >= 3 && !client.followUpDay3Sent) {
        day = 3;
        templateKey = "day3";
        client.followUpDay3Sent = true;
      } else if (days >= 7 && !client.followUpDay7Sent) {
        day = 7;
        templateKey = "day7";
        client.followUpDay7Sent = true;
      }

      if (templateKey) {
        const tpl = await MessageTemplate.findOne({ key: templateKey, active: true });
        if (tpl) {
          text = tpl.body.replace(/\{first\}/g, first).replace(/\{payLink\}/g, payLink);
        }
      }

      if (day) {
        await client.save();
        due.push({ name: client.fullName, day, waLink: `https://wa.me/${phone}?text=${encodeURIComponent(text)}` });
      }
    }

    // AUTO-ONBOARDING: newly active clients with no session get an onboarding consultation
    const Session = (await import("../models/Session.js")).default;
    const User = (await import("../models/User.js")).default;
    const activeClients = await Client.find({ isArchived: false, status: "active", reconciled: true }).limit(200);
    const onboarded = [];
    for (const client of activeClients) {
      const activated = client.startDate || client.createdAt;
      const days = (now - new Date(activated)) / 86400000;
      if (days > 30) continue;
      const existing = await Session.findOne({ client: client._id });
      if (existing) continue;
      const staff = await User.find({ roles: { $in: ["coach", "doctor"] }, isActive: true }).select("_id");
      let assigned = null;
      if (staff.length) {
        let bestCount = Infinity;
        for (const s of staff) {
          const count = await Session.countDocuments({ staff: s._id, status: { $in: ["pending", "confirmed"] } });
          if (count < bestCount) { bestCount = count; assigned = s._id; }
        }
      }
      const starts = new Date(Date.now() + 24 * 3600 * 1000);
      starts.setHours(10, 0, 0, 0);
      await Session.create({ client: client._id, staff: assigned, requestedBy: "staff", sessionType: "consultation", startsAt: starts, note: "Auto-booked onboarding consultation", status: "pending" });
      onboarded.push(client.fullName);
    }

    // AUTO-ARCHIVE: completed sessions older than 7 days file themselves away
    const SessMod = (await import("../models/Session.js")).default;
    const cutoff = new Date(now - 7 * 86400000);
    await SessMod.updateMany({ status: "completed", decidedAt: { $lte: cutoff }, archived: { $ne: true } }, { $set: { archived: true } });

    res.status(200).json({ success: true, checked: unpaidClients.length, due, onboarded });
  } catch (err) {
    next(err);
  }
};

// @route GET /api/follow-up/debug (temporary debug endpoint)
export const debugClients = async (req, res, next) => {
  try {
    const all = await Client.find({}).select("fullName status isArchived portalActive createdAt").limit(100);
    res.json({ total: all.length, clients: all });
  } catch (err) { next(err); }
};

// @route GET /api/follow-up/queue (staff) — unpaid clients, oldest first
export const getQueue = async (req, res, next) => {
  try {
    const paidProgramClientIds =
      await Payment.distinct("client", {
        status: "success",
        purpose: "program",
      });

    const unpaid = await Client.find({
      isArchived: false,
      reconciled: false,
      _id: { $nin: paidProgramClientIds },
    }).sort({ createdAt: 1 });
    const now = new Date();
    const payLink = (process.env.FRONTEND_URL || "https://khairo-frontend-kappa.vercel.app") + "/portal/login";
    const queue = unpaid.map((c) => {
      const days = Math.floor((now - new Date(c.createdAt)) / 86400000);
      const phone = (c.phone || "").replace(/\D/g, "");
      const first = (c.fullName || "").split(" ")[0];
      const text = encodeURIComponent(`Hi ${first}!  Your Khairo Diet Clinic spot is waiting. Complete payment to unlock your portal: ${payLink}`);
      return {
        id: c._id, name: c.fullName, phone: c.phone, days,
        activated: !!c.portalActive, status: c.status || "pending",
        waLink: `https://wa.me/${phone}?text=${text}`,
      };
    });
    res.json({ success: true, queue });
  } catch (err) { next(err); }
};

// @route POST /api/follow-up/void/:id (admin) — archive without deleting
export const voidClient = async (req, res, next) => {
  try {
    const c = await Client.findById(req.params.id);
    if (!c) return res.status(404).json({ success: false, message: "Client not found" });
    c.isArchived = true;
    await c.save();
    res.json({ success: true });
  } catch (err) { next(err); }
};

// @route GET /api/follow-up/hygiene (staff) — data health problems
export const hygiene = async (req, res, next) => {
  try {
    const clients = await Client.find({}).select("fullName email phone portalActive status");
    const emailCount = {};
    clients.forEach((c) => { const e = (c.email || "").toLowerCase(); emailCount[e] = (emailCount[e] || 0) + 1; });
    const issues = [];
    clients.forEach((c) => {
      const email = (c.email || "").toLowerCase();
      const digits = (c.phone || "").replace(/\D/g, "");
      if (email && emailCount[email] > 1) issues.push({ name: c.fullName, email, problem: "duplicate email" });
      if (!c.portalActive) issues.push({ name: c.fullName, email, problem: "never activated portal" });
      if (digits && ![11, 13].includes(digits.length)) issues.push({ name: c.fullName, phone: c.phone, problem: "suspect phone format" });
    });
    res.json({ success: true, issues });
  } catch (err) { next(err); }
};
