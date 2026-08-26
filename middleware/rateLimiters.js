import rateLimit from "express-rate-limit";

export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1000,
  message: { success: false, message: "Too many login attempts. Please try again in 15 minutes." },
  standardHeaders: true,
  legacyHeaders: false,
});

export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
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
