import ExcelJS from "exceljs";
import AuditLog from "../models/AuditLog.js";
import Application from "../models/Application.js";
import { sendEmail } from "../utils/mailer.js";
import Client from "../models/Client.js";
import Payment from "../models/Payment.js";
import Subscription from "../models/Subscription.js";
import CrmContact from "../models/CrmContact.js";
import CrmOpportunity from "../models/CrmOpportunity.js";

// @route GET /api/reports/revenue (staff only)
// Monthly revenue for the last 6 months, current-month total, active
// subscription count, and subscriptions expiring within the next 7 days.
export const getRevenueSummary = async (req, res, next) => {
  try {
    const now = new Date();

    // Last 6 calendar months, oldest first.
    const months = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push({ year: d.getFullYear(), month: d.getMonth(), label: d.toLocaleDateString(undefined, { month: "short", year: "2-digit" }) });
    }

    const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1);

    const successfulPayments = await Payment.find({
      status: "success",
      paidAt: { $gte: sixMonthsAgo },
    }).select("amount paidAt");

    const monthlyRevenue = months.map(({ year, month, label }) => {
      const total = successfulPayments
        .filter((p) => {
          const d = new Date(p.paidAt);
          return d.getFullYear() === year && d.getMonth() === month;
        })
        .reduce((sum, p) => sum + p.amount, 0);
      return { label, total };
    });

    const currentMonthRevenue = monthlyRevenue[monthlyRevenue.length - 1]?.total || 0;

    const activeSubscriptions = await Subscription.countDocuments({
      status: { $in: ["active", "grace_period"] },
    });

    const sevenDaysFromNow = new Date(now);
    sevenDaysFromNow.setDate(sevenDaysFromNow.getDate() + 7);

    const expiringThisWeek = await Subscription.find({
      status: { $in: ["active", "grace_period"] },
      currentPeriodEnd: { $gte: now, $lte: sevenDaysFromNow },
    })
      .populate("client", "fullName email phone")
      .sort({ currentPeriodEnd: 1 });

    // Payment counts by status, all time - shows the full attempted-payment
    // picture, not just what actually collected.
    const paymentStatusCounts = {};
    const allStatusResults = await Payment.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]);
    for (const row of allStatusResults) {
      paymentStatusCounts[row._id] = row.count;
    }

    // Client counts by status - includes paused/cancelled/completed, not
    // just active, so nothing is hidden from the report.
    const clientStatusCounts = {};
    const clientStatusResults = await Client.aggregate([
      { $match: { isArchived: false } },
      { $group: { _id: "$status", count: { $sum: 1 } } },
    ]);
    for (const row of clientStatusResults) {
      clientStatusCounts[row._id] = row.count;
    }

    res.status(200).json({
      success: true,
      currentMonthRevenue,
      monthlyRevenue,
      activeSubscriptions,
      expiringThisWeek,
      paymentStatusCounts,
      clientStatusCounts,
    });
  } catch (err) {
    next(err);
  }
};

// @route GET /api/reports/revenue/export (staff only) - CSV of all successful payments
export const exportRevenueCsv = async (req, res, next) => {
  try {
    const payments = await Payment.find({ status: "success" })
      .populate("client", "fullName email")
      .sort({ paidAt: -1 });

    const rows = [["Date", "Client", "Email", "Purpose", "Amount (NGN)", "Receipt Number", "Reference"]];
    for (const p of payments) {
      rows.push([
        p.paidAt ? new Date(p.paidAt).toISOString().slice(0, 10) : "",
        p.client?.fullName || "",
        p.client?.email || "",
        p.purpose,
        p.amount,
        p.receiptNumber,
        p.reference,
      ]);
    }

    const csv = rows
      .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
      .join("\n");

    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="khairo-revenue-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.status(200).send(csv);
  } catch (err) {
    next(err);
  }
};


// ---- Monthly revenue goal ----
import MonthlyGoal from "../models/MonthlyGoal.js";

const goalMonthKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

// @route GET /api/reports/goal
export const getMonthlyGoal = async (req, res, next) => {
  try {
    const month = req.query.month || goalMonthKey(new Date());
    const goal = await MonthlyGoal.findOne({ month });
    res.status(200).json({ success: true, month, target: goal?.target || 0 });
  } catch (err) {
    next(err);
  }
};

// @route PATCH /api/reports/goal (admin only)
export const setMonthlyGoal = async (req, res, next) => {
  try {
    const month = req.body.month || goalMonthKey(new Date());
    const target = Number(req.body.target);
    if (!target || target <= 0) {
      return res.status(400).json({ success: false, message: "Enter a valid goal amount." });
    }
    const goal = await MonthlyGoal.findOneAndUpdate(
      { month },
      { month, target, updatedAt: new Date() },
      { upsert: true, new: true }
    );
    res.status(200).json({ success: true, goal });
  } catch (err) {
    next(err);
  }
};


// GET /api/reports/staff-performance - aggregates audit log actions per staff
export const getStaffPerformance = async (req, res, next) => {
  try {
    const days = Number(req.query.days) || 7;
    const since = new Date(Date.now() - days * 86400000);
    const logs = await AuditLog.find({ createdAt: { $gte: since } })
      .populate("user", "name roles")
      .sort({ createdAt: -1 });

    const buckets = { sales: ["Contacted application", "Approved application", "Nudged stuck lead"], sessions: ["Booked session", "Confirmed session", "Completed session", "Assigned professional to session"], money: ["Generated payment link", "Emailed payment link", "Reconciled payment", "Manually activated subscription", "Subscription activated via payment"] };
    const byUser = {};
    for (const log of logs) {
      if (!log.user) continue;
      const id = String(log.user._id || log.user);
      if (!byUser[id]) byUser[id] = { id, name: log.user.name || log.userName || "Unknown", sales: 0, sessions: 0, money: 0, total: 0 };
      byUser[id].total++;
      if (buckets.sales.includes(log.action)) byUser[id].sales++;
      else if (buckets.sessions.includes(log.action)) byUser[id].sessions++;
      else if (buckets.money.includes(log.action)) byUser[id].money++;
    }
    const list = Object.values(byUser).sort((a, b) => b.total - a.total);
    res.status(200).json({ success: true, days, staff: list });
  } catch (err) {
    next(err);
  }
};


// POST /api/reports/send-renewal-reminders - cron endpoint: email clients expiring in 7 days
export const sendRenewalReminders = async (req, res, next) => {
  try {
    const target = new Date(Date.now() + 7 * 86400000);
    const start = new Date(target.getTime() - 12 * 3600000);
    const end = new Date(target.getTime() + 12 * 3600000);
    const clients = await Client.find({
      isArchived: { $ne: true },
      status: "active",
      reconciled: true,
      currentPeriodEnd: { $gte: start, $lte: end },
    });
    let sent = 0;
    for (const c of clients) {
      if (!c.email) continue;
      try {
        const dateStr = new Date(c.currentPeriodEnd).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
        const first = c.fullName.split(" ")[0];
        const html = `<div style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;background:#0a0a0a;padding:32px;color:#f5f5f5;"><div style="max-width:520px;margin:0 auto;background:#171717;border:1px solid #262626;border-radius:8px;padding:32px;"><div style="display:flex;align-items:center;gap:10px;margin-bottom:24px;"><div style="width:36px;height:36px;background:#0d9488;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:700;color:white;">F</div><span style="font-weight:600;">FITLUNGE</span></div><p style="margin:0 0 16px;">Hi ${first},</p><p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#d4d4d4;">Your ${c.program} subscription renews on <strong style="color:white;">${dateStr}</strong>.</p><p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#d4d4d4;">We'll automatically process your renewal. If anything's changed — your goals, your schedule, your program — just reply and we'll adjust.</p><p style="margin:0;font-size:12px;color:#737373;">Thanks for being part of KhairoDietClinic.</p></div></div>`;
        await sendEmail({ to: c.email, subject: `Your KhairoDietClinic renewal is coming up, ${first}`, html, text: `Hi ${first},\n\nYour ${c.program} subscription renews on ${dateStr}. We'll automatically process your renewal.\n\n- KhairoDietClinic` });
        await AuditLog.create({ user: req.user ? req.user._id : null, userName: "System", action: "Sent renewal reminder", entityType: "Client", entityId: c._id.toString(), details: c.fullName });
        sent++;
      } catch (e) { console.error("renewal email failed for", c.email, e); }
    }
    res.json({ success: true, sent, total: clients.length });
  } catch (err) { next(err); }
};


// GET /api/reports/kpis - conversion, retention, LTV
export const getKPIs = async (req, res, next) => {
  try {
    const Application =
      (await import("../models/Application.js")).default;

    const Payment =
      (await import("../models/Payment.js")).default;

    const [apps, payments, reconciledClients] =
      await Promise.all([
        Application.find()
          .select("_id status"),

        Payment.find({
          status: "success",
        }).select(
          "amount client purpose paidAt"
        ),

        Client.find({
          isArchived: { $ne: true },
          reconciled: true,
        }).select(
          "_id startDate status fromApplication"
        ),
      ]);

    const applicationIds =
      new Set(
        apps.map(
          (application) =>
            String(application._id)
        )
      );

    const programPurposes =
      new Set([
        "new_subscription",
        "renewal",
        "upgrade",
        "combined",
        "program",
      ]);

    const paidClientIds =
      [
        ...new Set(
          payments
            .filter(
              (payment) =>
                payment.client &&
                programPurposes.has(
                  payment.purpose
                )
            )
            .map(
              (payment) =>
                String(payment.client)
            )
        ),
      ];

    const paidClients =
      paidClientIds.length
        ? await Client.find({
            _id: {
              $in: paidClientIds,
            },
            fromApplication: {
              $ne: null,
            },
          }).select(
            "_id fromApplication"
          )
        : [];

    const paidApplicationIds =
      new Set(
        paidClients
          .map(
            (client) =>
              client.fromApplication
                ? String(
                    client.fromApplication
                  )
                : null
          )
          .filter(
            (id) =>
              id &&
              applicationIds.has(id)
          )
      );

    const enrolledApplicationIds =
      new Set(
        reconciledClients
          .map(
            (client) =>
              client.fromApplication
                ? String(
                    client.fromApplication
                  )
                : null
          )
          .filter(
            (id) =>
              id &&
              applicationIds.has(id)
          )
      );

    const applied =
      apps.length;

    const contacted =
      apps.filter(
        (application) =>
          application.status !==
          "pending"
      ).length;

    const approved =
      apps.filter(
        (application) =>
          application.status ===
          "approved"
      ).length;

    const paid =
      paidApplicationIds.size;

    const enrolled =
      enrolledApplicationIds.size;

    const now =
      Date.now();

    const day30 =
      new Date(
        now -
        30 * 86400000
      );

    const day60 =
      new Date(
        now -
        60 * 86400000
      );

    const day90 =
      new Date(
        now -
        90 * 86400000
      );

    const retentionAt =
      (cutoff) => {
        const started =
          reconciledClients.filter(
            (client) =>
              client.startDate &&
              new Date(
                client.startDate
              ) < cutoff
          );

        const active =
          started.filter(
            (client) =>
              client.status ===
              "active"
          ).length;

        return {
          started:
            started.length,

          active,

          pct:
            started.length
              ? Math.round(
                  (
                    active /
                    started.length
                  ) * 100
                )
              : 0,
        };
      };

    const reconciledClientIds =
      new Set(
        reconciledClients.map(
          (client) =>
            String(client._id)
        )
      );

    const enrolledRevenue =
      payments
        .filter(
          (payment) =>
            payment.client &&
            reconciledClientIds.has(
              String(
                payment.client
              )
            )
        )
        .reduce(
          (sum, payment) =>
            sum +
            Number(
              payment.amount || 0
            ),
          0
        );

    const ltv =
      reconciledClients.length
        ? Math.round(
            enrolledRevenue /
            reconciledClients.length
          )
        : 0;

    res.json({
      success: true,

      conversion: {
        applied,
        contacted,
        approved,
        paid,
        enrolled,
      },

      retention: {
        day30:
          retentionAt(day30),

        day60:
          retentionAt(day60),

        day90:
          retentionAt(day90),
      },

      ltv,
    });
  } catch (err) {
    next(err);
  }
};


// GET /api/reports/pipeline - pipeline conversion, time-in-stage, source counts
export const getPipelineReport = async (req, res, next) => {
  try {
    const stages = [
      "new",
      "qualification",
      "qualified",
      "consultation_booked",
      "consultation_completed",
      "medical_review",
      "payment_pending",
      "nurture",
      "lost",
    ];

    const totalOpportunities = await CrmOpportunity.countDocuments({});

    const currentCountRows = await CrmOpportunity.aggregate([
      { $match: { status: "open" } },
      { $group: { _id: "$stage", count: { $sum: 1 } } },
    ]);

    const currentCounts = {};
    for (const stage of stages) currentCounts[stage] = 0;
    for (const row of currentCountRows) {
      if (stages.includes(row._id)) currentCounts[row._id] = row.count || 0;
    }

    const reachedRows = await CrmOpportunity.aggregate([
      { $group: { _id: "$stage", count: { $sum: 1 } } },
    ]);

    const reached = {};
    for (const stage of stages) reached[stage] = 0;
    for (const row of reachedRows) {
      if (stages.includes(row._id)) reached[row._id] = row.count || 0;
    }

    const conversion = {};
    for (const stage of stages) {
      conversion[stage] = totalOpportunities
        ? Math.round((reached[stage] / totalOpportunities) * 100)
        : 0;
    }

    const now = Date.now();
    const timeRows = await CrmOpportunity.aggregate([
      {
        $match: {
          status: "open",
          stageEnteredAt: { $exists: true },
        },
      },
      {
        $group: {
          _id: "$stage",
          count: { $sum: 1 },
          avgDays: {
            $avg: {
              $divide: [
                { $subtract: [now, "$stageEnteredAt"] },
                86400000,
              ],
            },
          },
        },
      },
    ]);

    const timeInStageDays = {};
    for (const stage of stages) timeInStageDays[stage] = 0;
    for (const row of timeRows) {
      if (stages.includes(row._id)) {
        timeInStageDays[row._id] = Number((row.avgDays || 0).toFixed(1));
      }
    }

    const sourceRows = await CrmContact.aggregate([
      { $match: { isArchived: false } },
      { $group: { _id: "$source", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]);

    res.status(200).json({
      success: true,
      stages,
      totalOpportunities,
      currentCounts,
      conversion,
      timeInStageDays,
      sources: sourceRows,
    });
  } catch (error) {
    next(error);
  }
};


// GET /api/reports/lead-sources
export const getLeadSourceReport = async (req, res, next) => {
  try {
    const sources = await CrmContact.aggregate([
      { $match: { isArchived: false } },
      {
        $group: {
          _id: "$source",
          totalContacts: { $sum: 1 },
          clientContacts: { $sum: { $cond: [{ $eq: ["$lifecycleStage", "client"] }, 1, 0] } },
          applicantContacts: { $sum: { $cond: [{ $eq: ["$lifecycleStage", "applicant"] }, 1, 0] } },
        },
      },
      { $sort: { totalContacts: -1 } },
    ]);

    const opportunities = await CrmOpportunity.aggregate([
      { $match: { status: "open" } },
      {
        $lookup: {
          from: "crmcontacts",
          localField: "contact",
          foreignField: "_id",
          as: "contact",
        },
      },
      { $unwind: "$contact" },
      {
        $group: {
          _id: "$contact.source",
          openOpportunities: { $sum: 1 },
          qualifiedPlus: {
            $sum: {
              $cond: [
                {
                  $in: [
                    "$stage",
                    ["qualified", "consultation_booked", "consultation_completed", "medical_review", "payment_pending"],
                  ],
                },
                1,
                0,
              ],
            },
          },
        },
      },
    ]);

    const oppMap = new Map();
    for (const item of opportunities) {
      oppMap.set(item._id || "unknown", item);
    }

    const result = sources.map((source) => ({
      source: source._id || "unknown",
      totalContacts: source.totalContacts,
      clientContacts: source.clientContacts,
      applicantContacts: source.applicantContacts,
      openOpportunities: oppMap.get(source._id)?.openOpportunities || 0,
      qualifiedPlus: oppMap.get(source._id)?.qualifiedPlus || 0,
      conversionRate:
        source.totalContacts > 0
          ? Math.round((source.clientContacts / source.totalContacts) * 100)
          : 0,
    }));

    res.status(200).json({ success: true, sources: result });
  } catch (error) {
    next(error);
  }
};



function resolveReportDateRange(range, fromQuery, toQuery) {
  const now = new Date();
  let from = new Date(now);
  let to = new Date(now);
  from.setHours(0, 0, 0, 0);
  to.setHours(23, 59, 59, 999);

  if (range === "today") {
    from = new Date(now); from.setHours(0, 0, 0, 0);
    to = new Date(now); to.setHours(23, 59, 59, 999);
  } else if (range === "this_week") {
    const day = now.getDay();
    const diff = day === 0 ? 6 : day - 1;
    from = new Date(now);
    from.setDate(now.getDate() - diff);
    from.setHours(0, 0, 0, 0);
    to = new Date(now);
    to.setHours(23, 59, 59, 999);
  } else if (range === "this_month") {
    from = new Date(now.getFullYear(), now.getMonth(), 1);
    to = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
  } else if (range === "last_month") {
    from = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    to = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
  } else if (range === "quarter") {
    const quarter = Math.floor(now.getMonth() / 3);
    from = new Date(now.getFullYear(), quarter * 3, 1);
    to = new Date(now.getFullYear(), quarter * 3 + 3, 0, 23, 59, 59, 999);
  } else if (range === "year") {
    from = new Date(now.getFullYear(), 0, 1);
    to = new Date(now.getFullYear(), 11, 31, 23, 59, 59, 999);
  } else if (range === "custom") {
    if (fromQuery) from = new Date(fromQuery);
    if (toQuery) to = new Date(toQuery);
  }

  return { from, to };
}

function csvEscape(value) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

function sendReportCsv(res, rows, filename) {
  const csv = rows
    .map((row) => row.map(csvEscape).join(","))
    .join("\n");

  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.status(200).send(csv);
}

async function sendReportXlsx(res, rows, filename) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Report");

  rows.forEach((row) => sheet.addRow(row));

  sheet.getRow(1).font = { bold: true };

  sheet.columns.forEach((column) => {
    let width = 12;
    column.eachCell?.({ includeEmpty: true }, (cell) => {
      width = Math.min(40, Math.max(width, String(cell.value || "").length + 2));
    });
    column.width = width;
  });

  res.setHeader(
    "Content-Type",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  );
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);

  const buffer = await workbook.xlsx.writeBuffer();
  res.status(200).send(Buffer.from(buffer));
}

export const exportReport = async (req, res, next) => {
  try {
    const type = String(req.query.type || "financial").trim().toLowerCase();
    const format = String(req.query.format || "csv").trim().toLowerCase();
    const range = String(req.query.range || "this_month").trim().toLowerCase();
    const { from, to } = resolveReportDateRange(range, req.query.from, req.query.to);

    const reportTypes = new Set([
      "financial",
      "clients",
      "sales",
      "retention",
      "program_performance",
      "staff_performance",
      "marketing_attribution",
    ]);

    if (!reportTypes.has(type)) {
      return res.status(400).json({ success: false, message: "Invalid report type." });
    }
    if (!["csv", "xlsx"].includes(format)) {
      return res.status(400).json({ success: false, message: "Format must be csv or xlsx." });
    }

    const fileDate = new Date().toISOString().slice(0, 10);
    let rows = [];
    let filename = `khairo-${type}-${fileDate}.${format}`;

    if (type === "financial") {
      const payments = await Payment.find({
        status: "success",
        paidAt: { $gte: from, $lte: to },
      })
        .populate("client", "fullName email")
        .sort({ paidAt: -1 })
        .lean();

      rows = [
        ["Date", "Client", "Email", "Purpose", "Amount", "Receipt", "Reference"],
        ...payments.map((p) => [
          p.paidAt ? new Date(p.paidAt).toISOString().slice(0, 10) : "",
          p.client?.fullName || "",
          p.client?.email || "",
          p.purpose || "",
          p.amount || 0,
          p.receiptNumber || "",
          p.reference || "",
        ]),
      ];
    } else if (type === "clients") {
      const clients = await Client.find({
        isArchived: false,
        createdAt: { $gte: from, $lte: to },
      })
        .select("fullName email phone program status startDate programEndsAt createdAt")
        .sort({ createdAt: -1 })
        .lean();

      rows = [
        ["Name", "Email", "Phone", "Program", "Status", "Start", "End", "Created"],
        ...clients.map((c) => [
          c.fullName,
          c.email,
          c.phone,
          c.program,
          c.status,
          c.startDate ? new Date(c.startDate).toISOString().slice(0, 10) : "",
          c.programEndsAt ? new Date(c.programEndsAt).toISOString().slice(0, 10) : "",
          c.createdAt ? new Date(c.createdAt).toISOString().slice(0, 10) : "",
        ]),
      ];
    } else if (type === "sales") {
      const opportunities = await CrmOpportunity.find({
        createdAt: { $gte: from, $lte: to },
      })
        .populate("contact", "fullName email phone source")
        .sort({ createdAt: -1 })
        .lean();

      rows = [
        ["Lead", "Email", "Phone", "Source", "Stage", "Status", "Estimated Value", "Created"],
        ...opportunities.map((o) => [
          o.contact?.fullName || "",
          o.contact?.email || "",
          o.contact?.phone || "",
          o.contact?.source || "",
          o.stage || "",
          o.status || "",
          o.estimatedValue || 0,
          o.createdAt ? new Date(o.createdAt).toISOString().slice(0, 10) : "",
        ]),
      ];
    } else if (type === "retention") {
      const clients = await Client.find({
        isArchived: false,
        startDate: { $gte: from, $lte: to },
      })
        .select("fullName email program startDate status programEndsAt")
        .sort({ startDate: -1 })
        .lean();

      rows = [
        ["Client", "Email", "Program", "Start", "End", "Current Status"],
        ...clients.map((c) => [
          c.fullName,
          c.email,
          c.program,
          c.startDate ? new Date(c.startDate).toISOString().slice(0, 10) : "",
          c.programEndsAt ? new Date(c.programEndsAt).toISOString().slice(0, 10) : "",
          c.status,
        ]),
      ];
    } else if (type === "program_performance") {
      const grouped = await Client.aggregate([
        { $match: { isArchived: false } },
        {
          $group: {
            _id: "$program",
            active: { $sum: { $cond: [{ $eq: ["$status", "active"] }, 1, 0] } },
            paused: { $sum: { $cond: [{ $eq: ["$status", "paused"] }, 1, 0] } },
            completed: { $sum: { $cond: [{ $eq: ["$status", "completed"] }, 1, 0] } },
            cancelled: { $sum: { $cond: [{ $eq: ["$status", "cancelled"] }, 1, 0] } },
            total: { $sum: 1 },
          },
        },
        { $sort: { _id: 1 } },
      ]);

      rows = [
        ["Program", "Active", "Paused", "Completed", "Cancelled", "Total"],
        ...grouped.map((g) => [
          g._id || "unknown",
          g.active,
          g.paused,
          g.completed,
          g.cancelled,
          g.total,
        ]),
      ];
    } else if (type === "staff_performance") {
      const logs = await AuditLog.find({ createdAt: { $gte: from, $lte: to } })
        .populate("user", "name roles")
        .sort({ createdAt: -1 })
        .lean();

      const buckets = {
        sales: ["Contacted application", "Approved application", "Nudged stuck lead"],
        sessions: ["Booked session", "Confirmed session", "Completed session"],
        money: ["Generated payment link", "Emailed payment link", "Reconciled payment"],
      };

      const byUser = {};
      for (const log of logs) {
        if (!log.user) continue;
        const id = String(log.user._id || log.user);
        if (!byUser[id]) {
          byUser[id] = {
            name: log.user.name || log.userName || "Unknown",
            sales: 0,
            sessions: 0,
            money: 0,
            total: 0,
          };
        }
        byUser[id].total += 1;
        if (buckets.sales.includes(log.action)) byUser[id].sales += 1;
        else if (buckets.sessions.includes(log.action)) byUser[id].sessions += 1;
        else if (buckets.money.includes(log.action)) byUser[id].money += 1;
      }

      rows = [
        ["Staff", "Sales", "Sessions", "Money", "Total Actions"],
        ...Object.values(byUser).map((u) => [
          u.name,
          u.sales,
          u.sessions,
          u.money,
          u.total,
        ]),
      ];
    } else if (type === "marketing_attribution") {
      const leadSources = await getLeadSourceReport(req, res, next);
      if (leadSources) {
        // getLeadSourceReport sends response, so this branch won't continue.
        return;
      }
    }

    if (!rows.length) {
      return res.status(404).json({ success: false, message: "No data for this report." });
    }

    if (format === "xlsx") {
      await sendReportXlsx(res, rows, filename);
    } else {
      sendReportCsv(res, rows, filename);
    }
  } catch (error) {
    next(error);
  }
};
