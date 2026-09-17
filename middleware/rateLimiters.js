import crypto from "node:crypto";
import rateLimit from "express-rate-limit";
import mongoSanitize from "express-mongo-sanitize";
import LoginAttempt from "../models/LoginAttempt.js";

const FIFTEEN_MINUTES_MS = 15 * 60 * 1000;
const LOGIN_PAIR_LIMIT = 8;
const LOGIN_IP_LIMIT = 50;
const LOGIN_LOCKOUT_MS = FIFTEEN_MINUTES_MS;
const LOGIN_RECORD_TTL_MS = 60 * 60 * 1000;

const normalizeEmail = (value) =>
  typeof value === "string" ? value.trim().toLowerCase() : "";

const requestIp = (req) =>
  req.ip || req.socket?.remoteAddress || "unknown";

const hashLoginKey = (scope, identity) =>
  crypto
    .createHash("sha256")
    .update(`${scope}\u0000${identity}`)
    .digest("hex");

const lockoutResponse = (res, lockedUntil) => {
  const retryAfterSeconds = Math.max(
    1,
    Math.ceil((lockedUntil.getTime() - Date.now()) / 1000)
  );

  res.set("Retry-After", String(retryAfterSeconds));

  return res.status(429).json({
    success: false,
    message: "Too many failed login attempts. Please try again later.",
  });
};

const consumeLoginBucket = async ({ key, limit }) => {
  const now = new Date();
  const staleBefore = new Date(now.getTime() - FIFTEEN_MINUTES_MS);

  const existing = await LoginAttempt.findById(key)
    .select("windowStartedAt lockedUntil")
    .lean();

  if (existing?.lockedUntil && new Date(existing.lockedUntil) > now) {
    return {
      blocked: true,
      lockedUntil: new Date(existing.lockedUntil),
      key,
    };
  }

  await LoginAttempt.deleteOne({
    _id: key,
    windowStartedAt: { $lte: staleBefore },
    $or: [
      { lockedUntil: null },
      { lockedUntil: { $lte: now } },
    ],
  });

  const attempt = await LoginAttempt.findOneAndUpdate(
    { _id: key },
    {
      $inc: { attempts: 1 },
      $setOnInsert: { windowStartedAt: now },
      $set: {
        expiresAt: new Date(now.getTime() + LOGIN_RECORD_TTL_MS),
      },
    },
    {
      upsert: true,
      new: true,
      setDefaultsOnInsert: true,
    }
  );

  const attempts = Number(attempt?.attempts || 0);

  if (attempts > limit) {
    const lockedUntil = new Date(now.getTime() + LOGIN_LOCKOUT_MS);

    await LoginAttempt.updateOne(
      { _id: key },
      {
        $set: {
          lockedUntil,
          expiresAt: new Date(
            lockedUntil.getTime() + FIFTEEN_MINUTES_MS
          ),
        },
      }
    );

    return {
      blocked: true,
      lockedUntil,
      key,
      attempts,
    };
  }

  return {
    blocked: false,
    key,
    attempts,
    limit,
  };
};

// Route-level auth sanitation runs after Express has parsed req.body.
export const sanitizeAuthInput = mongoSanitize();

// Persistent brute-force protection. Request-shape validation is intentionally
// handled by the centralized Zod validation layer before this limiter runs.
export const loginLimiter = async (req, res, next) => {
  try {
    const ip = requestIp(req);
    const email = normalizeEmail(req.body?.email) || "<missing-email>";
    const scope = req.baseUrl || "auth";

    const ipKey = hashLoginKey(`${scope}:ip`, ip);
    const pairKey = hashLoginKey(`${scope}:pair`, `${ip}\u0000${email}`);

    const ipBucket = await consumeLoginBucket({
      key: ipKey,
      limit: LOGIN_IP_LIMIT,
    });

    if (ipBucket.blocked) {
      return lockoutResponse(res, ipBucket.lockedUntil);
    }

    const pairBucket = await consumeLoginBucket({
      key: pairKey,
      limit: LOGIN_PAIR_LIMIT,
    });

    if (pairBucket.blocked) {
      return lockoutResponse(res, pairBucket.lockedUntil);
    }

    res.set("RateLimit-Limit", String(LOGIN_PAIR_LIMIT));
    res.set(
      "RateLimit-Remaining",
      String(Math.max(0, LOGIN_PAIR_LIMIT - pairBucket.attempts))
    );

    res.once("finish", () => {
      if (res.statusCode >= 200 && res.statusCode < 400) {
        Promise.all([
          LoginAttempt.deleteOne({ _id: pairKey }),
          LoginAttempt.updateOne(
            { _id: ipKey, attempts: { $gt: 0 } },
            { $inc: { attempts: -1 } }
          ),
        ]).catch((error) => {
          console.error(
            "Failed to clear successful login rate-limit state:",
            error?.message || error
          );
        });
      }
    });

    next();
  } catch (error) {
    next(error);
  }
};

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
