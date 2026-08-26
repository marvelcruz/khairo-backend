import { isEmailConfigured, sendEmail } from "../utils/mailer.js";

export const notFound = (req, res, next) => {
  res.status(404).json({ success: false, message: `Route not found: ${req.originalUrl}` });
};

async function notifyAdminOnServerError(err, req) {
  const to = process.env.ADMIN_EMAIL || process.env.SEED_ADMIN_EMAIL;
  if (!to || !isEmailConfigured()) return;

  try {
    await sendEmail({
      to,
      subject: `Khairo Diet Clinic server error: ${String(err.message || "Unknown error").slice(0, 120)}`,
      text: `A production server error occurred.\n\nRoute: ${req.method} ${req.originalUrl}\nTime: ${new Date().toISOString()}\nMessage: ${err.message || String(err)}\n\n${err.stack || ""}`.slice(0, 5000),
      html: `<div style="font-family:sans-serif;background:#0a0a0a;padding:24px;color:#f5f5f5;"><div style="max-width:640px;margin:0 auto;background:#171717;border:1px solid #7f1d1d;border-radius:10px;padding:24px;"><h2 style="margin:0 0 10px;color:#fca5a5;">Khairo Diet Clinic server error</h2><p style="margin:0 0 6px;"><strong>Route:</strong> ${req.method} ${req.originalUrl}</p><p style="margin:0 0 6px;"><strong>Time:</strong> ${new Date().toISOString()}</p><p style="margin:0 0 12px;"><strong>Message:</strong> ${err.message || String(err)}</p><pre style="white-space:pre-wrap;background:#111;padding:12px;border-radius:8px;color:#fca5a5;font-size:12px;">${err.stack || ""}</pre></div></div>`,
    });
  } catch (emailError) {
    console.error("Failed to send server error alert:", emailError?.message || emailError);
  }
}

// eslint-disable-next-line no-unused-vars
export const errorHandler = (err, req, res, next) => {
  console.error(err.stack);

  let statusCode = err.statusCode || 500;
  let message = err.message || "Server error";

  if (err.name === "CastError") {
    statusCode = 400;
    message = `Invalid ${err.path}: ${err.value}`;
  }
  if (err.name === "ValidationError") {
    statusCode = 400;
    message = Object.values(err.errors).map((val) => val.message).join(", ");
  }
  if (err.code === 11000) {
    statusCode = 409;
    const field = Object.keys(err.keyValue)[0];
    message = `${field} already exists`;
  }

  if (statusCode >= 500) {
    notifyAdminOnServerError(err, req);
  }

  res.status(statusCode).json({
    success: false,
    message,
    ...(process.env.NODE_ENV !== "production" && { stack: err.stack }),
  });
};
