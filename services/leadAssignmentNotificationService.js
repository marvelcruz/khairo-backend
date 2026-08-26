import User from "../models/User.js";
import { PROGRAM_LABELS } from "../utils/programTaxonomy.js";
import { sendPushToUser, isPushConfigured } from "./pushService.js";
import { sendEmail, isEmailConfigured } from "../utils/mailer.js";



function escapeHtml(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function crmUrl(contactId) {
  const clientUrl = String(process.env.CLIENT_URL || "")
    .split(",")[0]
    .trim();

  const base = String(
    process.env.FRONTEND_URL ||
      clientUrl ||
      "https://khairo-frontend-kappa.vercel.app"
  ).replace(/\/$/, "");

  return {
    relative: `/dashboard/crm?contact=${contactId}`,
    absolute: `${base}/dashboard/crm?contact=${contactId}`,
  };
}

async function notifyUser({
  user,
  leadName,
  program,
  url,
  assignedRepName,
  adminCopy = false,
}) {
  const firstName =
    String(user.name || "Team member").trim().split(/\s+/)[0] ||
    "Team member";

  const pushBody = adminCopy
    ? `${leadName} has been assigned to ${assignedRepName}. Programme: ${program}.`
    : `${firstName}, ${leadName} has been assigned to you. Programme: ${program}.`;

  const pushPromise = isPushConfigured()
    ? sendPushToUser(user._id, {
        title: "New Khairo Diet Clinic lead assigned",
        body: pushBody,
        url: url.relative,
      })
        .then((result) => ({
          status: result.delivered > 0 ? "delivered" : "not_delivered",
          ...result,
        }))
        .catch((error) => {
          console.error(
            "Lead assignment push failed:",
            error?.statusCode || "",
            error?.message || String(error)
          );

          return {
            status: "failed",
            error: error?.message || String(error),
          };
        })
    : Promise.resolve({
        status: "skipped",
        reason: "push_not_configured",
      });

  const emailSubject = adminCopy
    ? `New Khairo Diet Clinic lead assigned to ${assignedRepName}`
    : "New Khairo Diet Clinic lead assigned to you";

  const emailIntro = adminCopy
    ? `A new Khairo Diet Clinic lead has been assigned to ${assignedRepName}.`
    : "A new Khairo Diet Clinic lead has been assigned to you.";

  const emailPromise =
    isEmailConfigured() && user.email
      ? sendEmail({
          to: user.email,
          subject: emailSubject,
          text: `Hi ${firstName},

${emailIntro}

Lead: ${leadName}
Programme: ${program}

Please review in Khairo Diet Clinic:
${url.absolute}`,
          html: `
            <p>Hi ${escapeHtml(firstName)},</p>
            <p>${escapeHtml(emailIntro)}</p>
            <p>
              <strong>Lead:</strong> ${escapeHtml(leadName)}<br>
              <strong>Programme:</strong> ${escapeHtml(program)}
            </p>
            <p>
              <a href="${escapeHtml(url.absolute)}">Open this lead in Khairo Diet Clinic</a>
            </p>
          `,
        })
          .then(() => ({ status: "delivered" }))
          .catch((error) => {
            console.error(
              "Lead assignment email failed:",
              error?.status || "",
              error?.message || String(error)
            );

            return {
              status: "failed",
              error: error?.message || String(error),
            };
          })
      : Promise.resolve({
          status: "skipped",
          reason: user.email
            ? "email_not_configured"
            : "user_has_no_email",
        });

  const [push, email] = await Promise.all([
    pushPromise,
    emailPromise,
  ]);

  return {
    user: {
      id: String(user._id),
      name: user.name,
      email: user.email,
    },
    push,
    email,
  };
}

export async function notifyLeadAssignment({
  assignedTo,
  contact,
  opportunity,
}) {
  const rep = await User.findById(assignedTo)
    .select("_id name email isActive")
    .lean();

  if (!rep || !rep.isActive) {
    return {
      push: { status: "skipped", reason: "sales_rep_unavailable" },
      email: { status: "skipped", reason: "sales_rep_unavailable" },
      adminCopy: {
        push: { status: "skipped", reason: "sales_rep_unavailable" },
        email: { status: "skipped", reason: "sales_rep_unavailable" },
      },
    };
  }

  const leadName = String(contact.fullName || "New lead").trim();

  const program =
    PROGRAM_LABELS[
      opportunity?.programInterest ||
        contact.programInterest ||
        "not_sure"
    ] || "Not sure yet";

  const url = crmUrl(contact._id);

  const repResult = await notifyUser({
    user: rep,
    leadName,
    program,
    url,
    assignedRepName: rep.name,
  });

  const admin = await User.findOne({
    name: /^Admin$/i,
    isActive: true,
    roles: "admin",
  })
    .select("_id name email isActive")
    .lean();

  let adminCopy;

  if (!admin) {
    adminCopy = {
      push: { status: "skipped", reason: "admin_account_not_found" },
      email: { status: "skipped", reason: "admin_account_not_found" },
    };
  } else if (String(admin._id) === String(rep._id)) {
    adminCopy = {
      push: { status: "skipped", reason: "same_as_assigned_rep" },
      email: { status: "skipped", reason: "same_as_assigned_rep" },
    };
  } else {
    adminCopy = await notifyUser({
      user: admin,
      leadName,
      program,
      url,
      assignedRepName: rep.name,
      adminCopy: true,
    });
  }

  return {
    rep: repResult.user,
    push: repResult.push,
    email: repResult.email,
    adminCopy,
  };
}
