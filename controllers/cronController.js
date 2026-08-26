import Client from "../models/Client.js";
import AuditLog from "../models/AuditLog.js";
import { sendEmail } from "../utils/mailer.js";

// GET /api/cron/renewals?secret=XXX - cron-callable, no user auth required
export const cronRenewals = async (req, res, next) => {
  try {
    const secret = req.query.secret;
    if (!secret || secret !== process.env.CRON_SECRET) {
      return res.status(401).json({ success: false, message: "Invalid cron secret" });
    }

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
    let skipped = 0;
    for (const c of clients) {
      if (!c.email) continue;
      const recentReminder = await AuditLog.findOne({
        action: "Sent renewal reminder",
        entityId: c._id.toString(),
        createdAt: { $gte: new Date(Date.now() - 3 * 86400000) },
      });
      if (recentReminder) { skipped++; continue; }
      try {
        const dateStr = new Date(c.currentPeriodEnd).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
        const first = c.fullName.split(" ")[0];
        const html = `<div style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;background:#0a0a0a;padding:32px;color:#f5f5f5;"><div style="max-width:520px;margin:0 auto;background:#171717;border:1px solid #262626;border-radius:8px;padding:32px;"><div style="display:flex;align-items:center;gap:10px;margin-bottom:24px;"><div style="width:36px;height:36px;background:#0d9488;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:700;color:white;">F</div><span style="font-weight:600;">KHAIRO</span></div><p style="margin:0 0 16px;">Hi ${first},</p><p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#d4d4d4;">Your ${c.program} subscription renews on <strong style="color:white;">${dateStr}</strong>.</p><p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#d4d4d4;">We'll automatically process your renewal. If anything's changed — your goals, your schedule, your program — just reply and we'll adjust.</p><p style="margin:0;font-size:12px;color:#737373;">Thanks for being part of KhairoDietClinic.</p></div></div>`;
        await sendEmail({ to: c.email, subject: `Your KhairoDietClinic renewal is coming up, ${first}`, html, text: `Hi ${first},\n\nYour ${c.program} subscription renews on ${dateStr}. We'll automatically process your renewal.\n\n- KhairoDietClinic` });
        await AuditLog.create({ user: null, userName: "System (cron)", action: "Sent renewal reminder", entityType: "Client", entityId: c._id.toString(), details: c.fullName });
        sent++;
      } catch (e) { console.error("renewal email failed for", c.email, e); }
    }
    res.json({ success: true, sent, skipped, total: clients.length, ranAt: new Date().toISOString() });
  } catch (err) { next(err); }
};
