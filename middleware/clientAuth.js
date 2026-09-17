import jwt from "jsonwebtoken";
import Client from "../models/Client.js";
import { isTrustedAuthenticatedOrigin } from "./trustedOrigin.js";

export const protectClient = async (req, res, next) => {
  try {
    const token = req.cookies?.clientToken;

    if (!token) {
      return res.status(401).json({
        success: false,
        message: "Not authenticated. Please log in.",
      });
    }

    if (!isTrustedAuthenticatedOrigin(req)) {
      return res.status(403).json({
        success: false,
        message: "Request origin is not allowed.",
      });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (decoded.type !== "client") {
      return res.status(401).json({ success: false, message: "Invalid session." });
    }

    const client = await Client.findById(decoded.id);
    if (!client || !client.portalActive) {
      return res.status(401).json({
        success: false,
        message: "Account not found or portal access is inactive.",
      });
    }

    req.client = client;
    next();
  } catch (err) {
    return res.status(401).json({
      success: false,
      message: "Invalid or expired session. Please log in again.",
    });
  }
};
