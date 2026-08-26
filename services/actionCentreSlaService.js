import ActionAlert from "../models/ActionAlert.js";
import { isEmailConfigured, sendEmail } from "../utils/mailer.js";

const MINUTE = 60 * 1000;

const SLA_WINDOWS = {
  urgent: {
    ackMinutes: 60,
    escalateMinutes: 240,
    managerMinutes: 720,
  },
  warning: {
    ackMinutes: 240,
    escalateMinutes: 1440,
    managerMinutes: 2880,
  },
  info: {
    ackMinutes: 480,
    escalateMinutes: 2880,
    managerMinutes: 4320,
  },
};

function windowsForSeverity(severity) {
  return SLA_WINDOWS[severity] || SLA_WINDOWS.warning;
}

function addMinutes(date, minutes) {
  return new Date(date.getTime() + minutes * MINUTE);
}

function backfillDeadlines(alert) {
  const base = alert.firstDetectedAt || alert.lastDetectedAt || new Date();
  const windows = windowsForSeverity(alert.severity);

  let changed = false;

  if (!alert.slaDueAt) {
    alert.slaDueAt = addMinutes(base, windows.ackMinutes);
    changed = true;
  }
  if (!alert.slaEscalationAt) {
    alert.slaEscalationAt = addMinutes(base, windows.escalateMinutes);
    changed = true;
  }
  if (!alert.slaManagerEscalationAt) {
    alert.slaManagerEscalationAt = addMinutes(base, windows.managerMinutes);
    changed = true;
  }

  return changed;
}

async function sendManagerEscalationEmail(alert) {
  const to = process.env.ADMIN_EMAIL || process.env.SEED_ADMIN_EMAIL;
  if (!to || !isEmailConfigured()) return;

  try {
    await sendEmail({
      to,
      subject: `Khairo Diet Clinic SLA manager escalation: ${alert.title}`,
      text: `This action centre alert has exceeded the manager escalation threshold.\n\nAlert: ${alert.title}\nSummary: ${alert.summary}\nRecommended action: ${alert.recommendedAction}\n\nPlease review immediately.`,
      html: `<p>This action centre alert has exceeded the manager escalation threshold.</p><p><strong>${alert.title}</strong></p><p>${alert.summary}</p><p>${alert.recommendedAction}</p>`,
    });
  } catch (error) {
    console.error("SLA manager escalation email failed:", error?.message || error);
  }
}

export async function runActionCentreSla() {
  const now = new Date();
  const alerts = await ActionAlert.find({
    status: "open",
  })
    .limit(500)
    .lean();

  const result = {
    scanned: alerts.length,
    backfilled: 0,
    breached: 0,
    escalated: 0,
    managerEscalated: 0,
    errors: 0,
  };

  for (const alertData of alerts) {
    try {
      const alert = await ActionAlert.findById(alertData._id);
      if (!alert) continue;

      const backfilled = backfillDeadlines(alert);

      let changed = false;

      if (now.getTime() >= new Date(alert.slaManagerEscalationAt).getTime()) {
        if (!alert.managerEscalatedAt) {
          alert.managerEscalatedAt = now;
          alert.slaState = "escalated";
          changed = true;
          result.managerEscalated += 1;
          await sendManagerEscalationEmail(alert);
        } else if (alert.slaState !== "escalated") {
          alert.slaState = "escalated";
          changed = true;
        }
      } else if (
        now.getTime() >= new Date(alert.slaEscalationAt).getTime()
      ) {
        if (alert.slaState !== "escalated") {
          alert.slaState = "escalated";
          changed = true;
          result.escalated += 1;
        }
      } else if (
        now.getTime() >= new Date(alert.slaDueAt).getTime() &&
        !alert.acknowledgedAt
      ) {
        if (alert.slaState !== "breached") {
          alert.slaState = "breached";
          changed = true;
          result.breached += 1;
        }
      }

      if (backfilled || changed) {
        await alert.save({ validateBeforeSave: false });
      }

      if (backfilled) result.backfilled += 1;
    } catch (error) {
      result.errors += 1;
      console.error("Action Centre SLA check failed:", alertData._id, error?.message || error);
    }
  }

  return result;
}
