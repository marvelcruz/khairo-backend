import Application from "../models/Application.js";
import ActionAlert from "../models/ActionAlert.js";
import User from "../models/User.js";
import { sendEmail } from "../utils/mailer.js";

const DAY = 24 * 60 * 60 * 1000;

const WARNING_DAYS = 10;
const URGENT_DAYS = 14;

const EMAIL_ALERTS_ENABLED =
  String(
    process.env.ACTION_CENTRE_EMAILS_ENABLED || ""
  ).toLowerCase() === "true";

let scanInFlight = null;

function ageInDays(date, now = new Date()) {
  const started = new Date(date).getTime();

  if (!Number.isFinite(started)) {
    return 0;
  }

  return Math.max(
    0,
    Math.floor(
      (now.getTime() - started) / DAY
    )
  );
}

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function adminRecipients() {
  const users = await User.find({
    $or: [
      { role: "admin" },
      { roles: "admin" },
    ],
  })
    .select("email")
    .lean();

  return [
    ...new Set(
      users
        .map((user) =>
          String(user.email || "")
            .trim()
            .toLowerCase()
        )
        .filter(
          (email) =>
            email &&
            email.includes("@") &&
            !email.endsWith(".local")
        )
    ),
  ];
}

function alertEmailHtml(alert, urgent = false) {
  const subject = alert.subject || {};

  const statusColor =
    urgent ? "#ef4444" : "#f59e0b";

  const label =
    urgent
      ? "URGENT ACTION REQUIRED"
      : "ACTION REQUIRED";

  return `
  <div style="
    margin:0;
    padding:32px 16px;
    background:#09090b;
    font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;
    color:#f5f5f5;
  ">
    <div style="
      max-width:620px;
      margin:0 auto;
      overflow:hidden;
      border-radius:22px;
      background:#18181b;
      border:1px solid #27272a;
      box-shadow:0 18px 50px rgba(0,0,0,.35);
    ">
      <div style="
        height:8px;
        background:#0d9488;
        border-radius:22px 22px 0 0;
      "></div>

      <div style="padding:30px;">
        <div style="
          display:inline-block;
          margin-bottom:18px;
          padding:6px 10px;
          border-radius:999px;
          background:${statusColor}18;
          color:${statusColor};
          font-size:11px;
          font-weight:700;
          letter-spacing:.08em;
        ">
          ${label}
        </div>

        <div style="
          font-size:20px;
          font-weight:700;
          margin-bottom:8px;
        ">
          KHAIRO
        </div>

        <p style="
          margin:0 0 18px;
          color:#d4d4d8;
          line-height:1.65;
          font-size:15px;
        ">
          This alert is to inform you that
          <strong style="color:#ffffff;">
            ${escapeHtml(subject.name)}
          </strong>
          has had an incomplete application pending for
          <strong style="color:#ffffff;">
            ${Number(alert.ageDays || 0)} days
          </strong>.
        </p>

        <p style="
          margin:0 0 24px;
          color:#d4d4d8;
          line-height:1.65;
          font-size:15px;
        ">
          Please review the application and take the appropriate
          next action in KhairoDietClinic.
        </p>

        <div style="
          margin:0 0 24px;
          padding:20px;
          border-radius:14px;
          background:#101012;
          border:1px solid #27272a;
        ">
          <div style="
            margin-bottom:14px;
            font-size:12px;
            font-weight:700;
            color:#0d9488;
            text-transform:uppercase;
            letter-spacing:.08em;
          ">
            Applicant Information
          </div>

          <div style="
            font-size:17px;
            font-weight:700;
            color:#ffffff;
          ">
            ${escapeHtml(subject.name)}
          </div>

          <div style="
            margin-top:8px;
            color:#a1a1aa;
            font-size:14px;
            line-height:1.7;
          ">
            ${escapeHtml(subject.email)}<br/>
            ${escapeHtml(subject.phone)}<br/>
            ${escapeHtml(subject.context)}
          </div>
        </div>

        <div style="
          padding:16px;
          border-radius:12px;
          background:#0d948812;
          border:1px solid #0d948830;
        ">
          <div style="
            font-size:11px;
            text-transform:uppercase;
            letter-spacing:.08em;
            color:#ff70c5;
            font-weight:700;
          ">
            Recommended action
          </div>

          <div style="
            margin-top:6px;
            color:#f4f4f5;
            line-height:1.55;
            font-size:14px;
          ">
            ${escapeHtml(
              alert.recommendedAction
            )}
          </div>
        </div>

        <p style="
          margin:28px 0 0;
          color:#71717a;
          font-size:12px;
        ">
          KhairoDietClinic Action Centre
        </p>
      </div>
    </div>
  </div>
  `;
}

async function sendAlertEmail(
  alert,
  urgent = false
) {
  const recipients =
    await adminRecipients();

  let sent = 0;

  for (const to of recipients) {
    try {
      await sendEmail({
        to,
        subject: urgent
          ? `URGENT: ${alert.subject?.name || "Applicant"} application pending ${alert.ageDays} days`
          : `Action required: ${alert.subject?.name || "Applicant"} application pending ${alert.ageDays} days`,
        html: alertEmailHtml(
          alert,
          urgent
        ),
        text:
          `${urgent ? "URGENT: " : ""}` +
          `${alert.subject?.name || "Applicant"} has had an incomplete application pending for ${alert.ageDays} days.\n\n` +
          `${alert.recommendedAction}\n\n` +
          `Applicant: ${alert.subject?.name || ""}\n` +
          `Email: ${alert.subject?.email || ""}\n` +
          `Phone: ${alert.subject?.phone || ""}\n\n` +
          `KhairoDietClinic Action Centre`,
      });

      sent += 1;
    } catch (error) {
      console.error(
        "Action Centre email failed:",
        to,
        error?.message || error
      );
    }
  }

  return sent;
}

async function performApplicationScan({
  sendNotifications = false,
} = {}) {
  const now = new Date();

  const thresholdDate =
    new Date(
      now.getTime() -
        WARNING_DAYS * DAY
    );

  const applications =
    await Application.find({
      status: "pending",
      createdAt: {
        $lte: thresholdDate,
      },
    })
      .select(
        "_id fullName email phone programInterest createdAt status"
      )
      .lean();

  const activeKeys = [];

  let created = 0;
  let updated = 0;
  let emailsSent = 0;
  let escalationsSent = 0;

  for (const application of applications) {
    const ageDays = ageInDays(
      application.createdAt,
      now
    );

    const severity =
      ageDays >= URGENT_DAYS
        ? "urgent"
        : "warning";

    const dedupeKey =
      `application_pending_too_long:${application._id}`;

    activeKeys.push(dedupeKey);

    const existing =
      await ActionAlert.findOne({
        dedupeKey,
      });

    const subject = {
      name:
        application.fullName || "",
      email:
        application.email || "",
      phone:
        application.phone || "",
      context:
        application.programInterest
          ? `Programme: ${application.programInterest}`
          : "KhairoDietClinic application",
    };

    const payload = {
      ruleKey:
        "application_pending_too_long",

      entityType: "Application",
      entityId:
        application._id.toString(),

      severity,

      title:
        ageDays >= URGENT_DAYS
          ? `Urgent: ${application.fullName} application pending ${ageDays} days`
          : `${application.fullName} application pending ${ageDays} days`,

      summary:
        `${application.fullName} has had an incomplete application pending for ${ageDays} days.`,

      recommendedAction:
        "Review the application today. Contact the applicant if follow-up is still appropriate; otherwise close or decline the request so it does not remain in the pending queue.",

      href: "/dashboard/requests",

      subject,

      audienceRoles: [
        "admin",
        "sales",
      ],

      ageDays,

      thresholdDays:
        severity === "urgent"
          ? URGENT_DAYS
          : WARNING_DAYS,

      lastDetectedAt: now,
    };

    let alert;

    if (!existing) {
      alert =
        await ActionAlert.create({
          dedupeKey,
          ...payload,
          status: "open",
          firstDetectedAt: now,
        });

      created += 1;
    } else {
      Object.assign(
        existing,
        payload
      );

      await existing.save();

      alert = existing;
      updated += 1;
    }

    if (
      !sendNotifications ||
      !EMAIL_ALERTS_ENABLED ||
      alert.status !== "open"
    ) {
      continue;
    }

    if (ageDays >= URGENT_DAYS) {
      if (
        !alert.escalatedEmailSentAt
      ) {
        const count =
          await sendAlertEmail(
            alert,
            true
          );

        if (count > 0) {
          alert.escalatedEmailSentAt =
            new Date();
          await alert.save();
          escalationsSent += count;
        }
      }
    } else if (
      !alert.emailSentAt
    ) {
      const count =
        await sendAlertEmail(
          alert,
          false
        );

      if (count > 0) {
        alert.emailSentAt =
          new Date();
        await alert.save();
        emailsSent += count;
      }
    }
  }

  const staleOpenAlerts =
    await ActionAlert.find({
      ruleKey:
        "application_pending_too_long",
      status: "open",
      dedupeKey: {
        $nin: activeKeys,
      },
    });

  let autoResolved = 0;

  for (const alert of staleOpenAlerts) {
    const application =
      await Application.findById(
        alert.entityId
      )
        .select("status")
        .lean();

    if (
      !application ||
      application.status !== "pending"
    ) {
      alert.status = "resolved";
      alert.resolvedAt = now;
      alert.resolutionNote =
        "Automatically resolved because the application is no longer pending.";

      await alert.save();

      autoResolved += 1;
    }
  }

  return {
    scanned:
      applications.length,
    created,
    updated,
    autoResolved,
    emailsSent,
    escalationsSent,
  };
}

export async function scanApplicationAlerts(
  options = {}
) {
  if (scanInFlight) {
    return scanInFlight;
  }

  scanInFlight =
    performApplicationScan(
      options
    ).finally(() => {
      scanInFlight = null;
    });

  return scanInFlight;
}
