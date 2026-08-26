import { sendConnectedGmail } from "../services/gmailConnectionService.js";

const BREVO_API_URL = "https://api.brevo.com/v3/smtp/email";

export const isEmailConfigured = () =>
  Boolean(
    process.env.BREVO_API_KEY ||
      (process.env.GOOGLE_OAUTH_CLIENT_ID && process.env.GOOGLE_OAUTH_CLIENT_SECRET)
  );

async function sendBrevoEmail({ to, subject, html, text }) {
  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) {
    const err = new Error("Connect Gmail in KhairoDietClinic Setup to send email.");
    err.status = 501;
    throw err;
  }

  const res = await fetch(BREVO_API_URL, {
    method: "POST",
    headers: {
      "api-key": apiKey,
      "Content-Type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({
      sender: {
        name: process.env.EMAIL_FROM_NAME || "KhairoDietClinic",
        email: process.env.EMAIL_FROM || "no-reply@khairo.com",
      },
      to: [{ email: to }],
      subject,
      htmlContent: html,
      textContent: text,
    }),
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    const err = new Error(data.message || "Could not send email.");
    err.status = 502;
    throw err;
  }

  return res.json().catch(() => ({}));
}

export const sendEmail = async ({ to, subject, html, text }) => {
  try {
    return await sendConnectedGmail({ to, subject, html, text });
  } catch (gmailError) {
    if (process.env.BREVO_API_KEY) {
      console.warn(
        "Connected Gmail send unavailable; using Brevo fallback:",
        gmailError?.message || gmailError
      );
      return sendBrevoEmail({ to, subject, html, text });
    }

    if (gmailError?.code === "GMAIL_NOT_CONNECTED") {
      const err = new Error("Connect Gmail in KhairoDietClinic Setup to send email.");
      err.status = 501;
      throw err;
    }

    throw gmailError;
  }
};
