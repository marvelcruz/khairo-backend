import ActionAlert from "../models/ActionAlert.js";
import AuditLog from "../models/AuditLog.js";
import ClientExperience from "../models/ClientExperience.js";
import ClientMessage from "../models/ClientMessage.js";
import { isEmailConfigured, sendEmail } from "../utils/mailer.js";
import { recognizeEngagementRecovery } from "./clientRecognitionService.js";

const SIGNAL_LABELS = {
  weekly_checkin_overdue: "weekly check-in",
  progress_photo_overdue: "progress photo",
  portal_inactive_7d: "portal activity",
  daily_tracking_missed: "daily tracking",
};

function firstName(client) {
  return String(client.fullName || "there").trim().split(/\s+/)[0] || "there";
}

function cleanSignals(signals = []) {
  return [...new Set(signals.filter(Boolean))];
}

function signalLabels(signals) {
  return cleanSignals(signals).map((key) => SIGNAL_LABELS[key] || key.replaceAll("_", " "));
}

function listText(items) {
  if (!items.length) return "your Khairo Diet Clinic routine";
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items.at(-1)}`;
}

function clientNudgeText(client, signals) {
  const first = firstName(client);
  const labels = signalLabels(signals);

  if (labels.length === 1) {
    return `Hi ${first}, just checking in. It looks like your ${labels[0]} may be due. Please update it when you can, and message your Khairo Diet Clinic team if you need any help.`;
  }

  return `Hi ${first}, just checking in. A few parts of your Khairo Diet Clinic routine may need attention: ${listText(labels)}. Please log in when you can, and message your Khairo Diet Clinic team if you need any help.`;
}

async function latestEpisodeAudit(clientId) {
  const [nudge, recovery] = await Promise.all([
    AuditLog.findOne({
      entityType: "Client",
      entityId: String(clientId),
      action: "Sent engagement attention nudge",
    })
      .sort({ createdAt: -1 })
      .lean(),
    AuditLog.findOne({
      entityType: "Client",
      entityId: String(clientId),
      action: "Engagement attention recovered",
    })
      .sort({ createdAt: -1 })
      .lean(),
  ]);

  return { nudge, recovery };
}

async function shouldSendEpisodeNudge(clientId) {
  const { nudge, recovery } = await latestEpisodeAudit(clientId);
  if (!nudge) return true;
  if (!recovery) return false;
  return new Date(recovery.createdAt).getTime() > new Date(nudge.createdAt).getTime();
}

async function emailRemindersEnabled(clientId) {
  const record = await ClientExperience.findOne({ client: clientId })
    .select("preferences.emailReminders")
    .lean();

  return record?.preferences?.emailReminders !== false;
}

async function sendClientRetentionNudge(client, signals) {
  const text = clientNudgeText(client, signals);
  const channels = [];

  await ClientMessage.create({
    client: client._id,
    senderType: "staff",
    senderName: "Khairo Diet Clinic Team",
    category: "help",
    body: text.replace(/^Hi [^,]+,\s*/, ""),
    readByClient: false,
    readByStaff: true,
  });
  channels.push("portal");

  if (
    client.email &&
    isEmailConfigured() &&
    (await emailRemindersEnabled(client._id))
  ) {
    const first = firstName(client);
    const html = `<div style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;background:#0a0a0a;padding:32px;color:#f5f5f5;"><div style="max-width:520px;margin:0 auto;background:#171717;border:1px solid #262626;border-radius:8px;padding:32px;"><p style="margin:0 0 16px;">Hi ${first},</p><p style="margin:0;font-size:15px;line-height:1.6;color:#d4d4d4;">${text.replace(`Hi ${first}, `, "")}</p><p style="margin:24px 0 0;font-size:12px;color:#737373;">Khairo Diet Clinic</p></div></div>`;

    await sendEmail({
      to: client.email,
      subject: `Just checking in, ${first}`,
      html,
      text,
    });
    channels.push("email");
  }

  await AuditLog.create({
    user: null,
    userName: "System (retention)",
    action: "Sent engagement attention nudge",
    entityType: "Client",
    entityId: String(client._id),
    details: JSON.stringify({ channels, signals: cleanSignals(signals) }),
  });

  return channels;
}

async function syncHighRiskAlert(client, signals, now) {
  const uniqueSignals = cleanSignals(signals);
  const highRisk = uniqueSignals.length >= 2;
  const dedupeKey = `client_retention_high_risk:${client._id}`;
  const existing = await ActionAlert.findOne({ dedupeKey });

  if (!highRisk) {
    if (existing?.status === "open") {
      existing.status = "resolved";
      existing.resolvedAt = now;
      existing.resolvedBy = null;
      existing.resolutionNote = "Automatically resolved after client engagement recovered below the high-risk threshold.";
      await existing.save();
      return { resolved: true, opened: false };
    }
    return { resolved: false, opened: false };
  }

  const labels = signalLabels(uniqueSignals);
  const severity = uniqueSignals.length >= 3 ? "urgent" : "warning";
  const summary = `${client.fullName} currently has ${uniqueSignals.length} engagement risk signals: ${listText(labels)}.`;
  const recommendedAction = "Review the client record and make a personal check-in if the client needs support returning to their program routine.";

  if (existing) {
    const reopened = existing.status !== "open";
    existing.status = "open";
    existing.severity = severity;
    existing.title = `Engagement risk: ${client.fullName}`;
    existing.summary = summary;
    existing.recommendedAction = recommendedAction;
    existing.subject = {
      name: client.fullName || "",
      email: client.email || "",
      phone: client.phone || "",
      context: `${uniqueSignals.length} active engagement risk signals`,
    };
    existing.audienceRoles = ["admin", "coach", "staff"];
    existing.lastDetectedAt = now;
    existing.ageDays = 0;
    if (reopened) {
      existing.firstDetectedAt = now;
      existing.resolvedAt = null;
      existing.resolvedBy = null;
      existing.resolutionNote = "";
    }
    await existing.save();
    return { resolved: false, opened: reopened };
  }

  await ActionAlert.create({
    dedupeKey,
    ruleKey: "client_engagement_high_risk",
    entityType: "Client",
    entityId: String(client._id),
    status: "open",
    severity,
    title: `Engagement risk: ${client.fullName}`,
    summary,
    recommendedAction,
    href: "/dashboard/action-centre",
    subject: {
      name: client.fullName || "",
      email: client.email || "",
      phone: client.phone || "",
      context: `${uniqueSignals.length} active engagement risk signals`,
    },
    audienceRoles: ["admin", "coach", "staff"],
    ageDays: 0,
    thresholdDays: 0,
    firstDetectedAt: now,
    lastDetectedAt: now,
  });

  return { resolved: false, opened: true };
}

export async function syncClientRetentionResponses({
  client,
  riskSignals = [],
  now = new Date(),
  wasAttentionNeeded = false,
} = {}) {
  if (!client?._id) return null;

  const signals = cleanSignals(riskSignals);
  const attentionNeeded = signals.length > 0;

  let nudgeChannels = [];
  let recovered = false;

  if (attentionNeeded && (await shouldSendEpisodeNudge(client._id))) {
    try {
      nudgeChannels = await sendClientRetentionNudge(client, signals);
    } catch (error) {
      console.error(`Retention nudge failed for ${client._id}:`, error?.message || error);
    }
  }

  if (!attentionNeeded && wasAttentionNeeded) {
    await AuditLog.create({
      user: null,
      userName: "System (retention)",
      action: "Engagement attention recovered",
      entityType: "Client",
      entityId: String(client._id),
      details: "All current engagement attention signals cleared.",
    });

    try {
      await recognizeEngagementRecovery(client);
    } catch (error) {
      console.error(`Engagement recovery recognition failed for ${client._id}:`, error?.message || error);
    }

    recovered = true;
  }

  const alert = await syncHighRiskAlert(client, signals, now);

  return {
    attentionNeeded,
    nudgeChannels,
    recovered,
    highRisk: signals.length >= 2,
    alert,
  };
}
