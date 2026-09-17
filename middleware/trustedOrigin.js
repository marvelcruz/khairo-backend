const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

const configuredOrigins = () =>
  new Set(
    String(process.env.CLIENT_URL || "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean)
      .map((value) => {
        try {
          return new URL(value).origin;
        } catch {
          return "";
        }
      })
      .filter(Boolean)
  );

export const isTrustedAuthenticatedOrigin = (req) => {
  if (SAFE_METHODS.has(String(req.method || "GET").toUpperCase())) {
    return true;
  }

  if (process.env.NODE_ENV !== "production") {
    return true;
  }

  // CSRF is only relevant here when the browser is authenticating with one of
  // our session cookies. Public/webhook endpoints without a session cookie are
  // governed by their own authentication/signature controls.
  if (!req.cookies?.token && !req.cookies?.clientToken) {
    return true;
  }

  const originHeader = String(req.get("origin") || "").trim();
  if (!originHeader) return false;

  let origin;
  try {
    origin = new URL(originHeader).origin;
  } catch {
    return false;
  }

  return configuredOrigins().has(origin);
};

export const requireTrustedAuthenticatedOrigin = (req, res, next) => {
  if (!isTrustedAuthenticatedOrigin(req)) {
    return res.status(403).json({
      success: false,
      message: "Request origin is not allowed.",
    });
  }

  next();
};
