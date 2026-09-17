import jwt from "jsonwebtoken";

export const generateToken = (userId) => {
  return jwt.sign({ id: userId }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || "8h",
  });
};

export const sessionSameSite = () => {
  const configured = String(process.env.COOKIE_SAME_SITE || "")
    .trim()
    .toLowerCase();

  if (["strict", "lax", "none"].includes(configured)) {
    return configured;
  }

  // Current production is cross-site (Vercel -> Render), so keep the safe
  // compatibility default until app.khairodiet.com + api.khairodiet.com are live.
  return process.env.NODE_ENV === "production" ? "none" : "lax";
};

export const sendTokenCookie = (res, token, cookieName = "token") => {
  const expiresDays = Number(process.env.COOKIE_EXPIRES_DAYS) || 1;
  res.cookie(cookieName, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: sessionSameSite(),
    path: "/",
    maxAge: expiresDays * 24 * 60 * 60 * 1000,
  });
};

export const clearTokenCookie = (res, cookieName = "token") => {
  res.clearCookie(cookieName, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: sessionSameSite(),
    path: "/",
  });
};
