import { sendPushToUser, isPushConfigured } from "./pushService.js";
import { PROGRAM_LABELS } from "../utils/programTaxonomy.js";
import { sendEmail, isEmailConfigured } from "../utils/mailer.js";



function escapeHtml(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function medicalReviewUrl(caseId) {
  const clientUrl = String(process.env.CLIENT_URL || "")
    .split(",")[0]
    .trim();
  const base = String(
    process.env.FRONTEND_URL ||
      clientUrl ||
      "https://khairo-frontend-kappa.vercel.app"
  ).replace(/\/$/, "");

  return {
    relative: `/dashboard/crm/medical-review?case=${caseId}`,
    absolute: `${base}/dashboard/crm/medical-review?case=${caseId}`,
  };
}

async function sendDoctorPush(user, payload) {
  if (!isPushConfigured()) {
    return { status: "skipped", reason: "push_not_configured" };
  }

  try {
    const result = await sendPushToUser(user._id, payload);
    return {
      status: result.delivered > 0 ? "delivered" : "not_delivered",
      ...result,
    };
  } catch (error) {
    console.error("Medical review push failed:", error?.message || error);
    return { status: "failed", error: error?.message || String(error) };
  }
}

async function sendMessageEmail({ to, subject, text, html }) {
  if (!to) return { status: "skipped", reason: "recipient_has_no_email" };
  if (!isEmailConfigured()) {
    return { status: "skipped", reason: "email_not_configured" };
  }

  try {
    await sendEmail({ to, subject, text, html });
    return { status: "delivered" };
  } catch (error) {
    console.error("Medical review email failed:", error?.message || error);
    return { status: "failed", error: error?.message || String(error) };
  }
}

export async function notifyMedicalReviewAssignment({
  medicalCase,
  doctor,
  contact,
  opportunity,
}) {
  const url = medicalReviewUrl(medicalCase._id);
  const program =
    PROGRAM_LABELS[opportunity?.programInterest || contact?.programInterest || "not_sure"] ||
    "Not sure yet";
  const healthNotes =
    medicalCase.qualificationSummary?.healthNotes ||
    "No health, medication, or medical-history information was supplied on the qualification form.";
  const goals =
    medicalCase.qualificationSummary?.goals || "No goals were supplied on the qualification form.";
  const firstName = String(doctor.name || "Doctor").trim().split(/\s+/)[0] || "Doctor";

  const push = await sendDoctorPush(doctor, {
    title: "Medical review assigned",
    body: `${contact.fullName} requires medical review. Programme: ${program}.`,
    url: url.relative,
  });

  const email = await sendMessageEmail({
    to: doctor.email,
    subject: `KhairoDietClinic medical review assigned: ${contact.fullName}`,
    text: `Hi ${firstName},\n\nA KhairoDietClinic medical review has been assigned to you.\n\nClient: ${contact.fullName}\nProgramme: ${program}\nEmail: ${contact.email || "Not supplied"}\nPhone: ${contact.phone || "Not supplied"}\nGoals: ${goals}\nHealth / medication information: ${healthNotes}\n\nOpen the secure medical-review record in KhairoDietClinic:\n${url.absolute}\n\nPlease keep medical information within KhairoDietClinic and approved clinical channels.`,
    html: `
      <p>Hi ${escapeHtml(firstName)},</p>
      <p>A KhairoDietClinic medical review has been assigned to you.</p>
      <p>
        <strong>Client:</strong> ${escapeHtml(contact.fullName)}<br>
        <strong>Programme:</strong> ${escapeHtml(program)}<br>
        <strong>Email:</strong> ${escapeHtml(contact.email || "Not supplied")}<br>
        <strong>Phone:</strong> ${escapeHtml(contact.phone || "Not supplied")}
      </p>
      <p><strong>Goals</strong><br>${escapeHtml(goals)}</p>
      <p><strong>Health / medication information</strong><br>${escapeHtml(healthNotes)}</p>
      <p><a href="${escapeHtml(url.absolute)}">Open the secure medical-review record in KhairoDietClinic</a></p>
      <p><small>Please keep medical information within KhairoDietClinic and approved clinical channels.</small></p>
    `,
  });

  return { push, email, url };
}

export async function notifyMedicalReviewScheduled({
  medicalCase,
  doctor,
  contact,
}) {
  const url = medicalReviewUrl(medicalCase._id);
  const when = medicalCase.scheduledAt
    ? new Date(medicalCase.scheduledAt).toLocaleString("en-CA", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "Africa/Lagos",
      })
    : "Scheduled time unavailable";
  const provider = String(medicalCase.meetingProvider || "video").replace("_", " ");
  const meetingUrl = medicalCase.meetingUrl || "Open KhairoDietClinic for meeting details";

  const doctorPush = await sendDoctorPush(doctor, {
    title: "Medical review meeting scheduled",
    body: `${contact.fullName}: ${when}.`,
    url: url.relative,
  });

  const doctorEmail = await sendMessageEmail({
    to: doctor.email,
    subject: `KhairoDietClinic medical review scheduled: ${contact.fullName}`,
    text: `Medical review scheduled for ${contact.fullName}.\n\nWhen: ${when}\nFormat: ${provider}\nMeeting: ${meetingUrl}\n\nSecure KhairoDietClinic record:\n${url.absolute}`,
    html: `
      <p>Medical review scheduled for <strong>${escapeHtml(contact.fullName)}</strong>.</p>
      <p><strong>When:</strong> ${escapeHtml(when)}<br>
      <strong>Format:</strong> ${escapeHtml(provider)}</p>
      <p><a href="${escapeHtml(meetingUrl)}">Join video meeting</a></p>
      <p><a href="${escapeHtml(url.absolute)}">Open secure KhairoDietClinic record</a></p>
    `,
  });

  const clientEmail = await sendMessageEmail({
    to: contact.email,
    subject: "Your KhairoDietClinic medical review meeting",
    text: `Hello ${contact.fullName},\n\nYour KhairoDietClinic medical review meeting has been scheduled.\n\nWhen: ${when}\nFormat: ${provider}\nMeeting: ${meetingUrl}\n\nIf you need to reschedule, please contact the KhairoDietClinic team.`,
    html: `
      <p>Hello ${escapeHtml(contact.fullName)},</p>
      <p>Your KhairoDietClinic medical review meeting has been scheduled.</p>
      <p><strong>When:</strong> ${escapeHtml(when)}<br>
      <strong>Format:</strong> ${escapeHtml(provider)}</p>
      <p><a href="${escapeHtml(meetingUrl)}">Join video meeting</a></p>
      <p>If you need to reschedule, please contact the KhairoDietClinic team.</p>
    `,
  });

  return { doctorPush, doctorEmail, clientEmail, url };
}
