import jwt from "jsonwebtoken";

export const generateToken = (userId) => {
  return jwt.sign({ id: userId }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || "8h",
  });
};

export const sendTokenCookie = (res, token, cookieName = "token") => {
  const expiresDays = Number(process.env.COOKIE_EXPIRES_DAYS) || 1;
  res.cookie(cookieName, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
    maxAge: expiresDays * 24 * 60 * 60 * 1000,
  });
};
