import rateLimit from "express-rate-limit";
import mongoSanitize from "express-mongo-sanitize";

const FIFTEEN_MINUTES_MS = 15 * 60 * 1000;

const normalizeEmail = (value) =>
  typeof value === "string" ? value.trim().toLowerCase() : "";

const requestIp = (req) =>
  req.ip || req.socket?.remoteAddress || "unknown";

// This route-level sanitizer runs after Express has parsed req.body. The app's
// global sanitizer is registered before express.json(), so auth routes should
// not rely on that ordering for credential payloads.
export const sanitizeAuthInput = mongoSanitize();

export const validateLoginRequest = (req, res, next) => {
  const email = normalizeEmail(req.body?.email);
  const password = req.body?.password;

  if (!email || typeof password !== "string" || !password) {
    return res.status(400).json({
      success: false,
      message: "Email and password are required.",
    });
  }

  if (
    email.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  ) {
    return res.status(400).json({
      success: false,
      message: "Enter a valid email address.",
    });
  }

  // Do not trim or otherwise transform passwords. Only bound their size so an
  // unauthenticated request cannot force excessive hashing work or memory use.
  if (password.length > 256) {
    return res.status(400).json({
      success: false,
      message: "Invalid login credentials.",
    });
  }

  req.body.email = email;
  next();
};

// Login attempts are keyed by both the trusted client IP and normalized email.
// Successful logins are removed from the count, so the quota represents failed
// authentication attempts. Hitting the limit temporarily locks that IP+email
// pair for the remainder of the 15-minute window without blocking unrelated
// users on the same network.
export const loginLimiter = rateLimit({
  windowMs: FIFTEEN_MINUTES_MS,
  max: 8,
  keyGenerator: (req) =>
    `${requestIp(req)}:${normalizeEmail(req.body?.email) || "<missing-email>"}`,
  skipSuccessfulRequests: true,
  message: {
    success: false,
    message: "Too many failed login attempts. Please try again later.",
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Registration, activation and password recovery are deliberately isolated
// from the login bucket so those actions cannot lock a user out of sign-in.
export const authFlowLimiter = rateLimit({
  windowMs: FIFTEEN_MINUTES_MS,
  max: 20,
  keyGenerator: requestIp,
  message: {
    success: false,
    message: "Too many account requests. Please try again later.",
  },
  standardHeaders: true,
  legacyHeaders: false,
});

export const apiLimiter = rateLimit({
  windowMs: FIFTEEN_MINUTES_MS,
  max: 1000,
  message: { success: false, message: "Too many requests. Please slow down." },
  standardHeaders: true,
  legacyHeaders: false,
});

// Public application form - no login wall, so it needs its own strict limit to prevent spam.
export const applicationLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 1000,
  message: { success: false, message: "Too many applications submitted. Please contact us directly, or try again later." },
  standardHeaders: true,
  legacyHeaders: false,
});

export const formSubmissionLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 120,
  message: { success: false, message: "Too many form submissions. Please try again later." },
  standardHeaders: true,
  legacyHeaders: false,
});
