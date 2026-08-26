import { syncClientPortalAccess } from "../utils/clientPortalAccess.js";

export const requireActiveProgram = async (
  req,
  res,
  next
) => {
  try {
    const access =
      await syncClientPortalAccess(
        req.client
      );

    if (access.stage !== "active") {
      return res.status(403).json({
        success: false,
        code: "PROGRAM_NOT_ACTIVE",
        message:
          access.stage === "preview"
            ? "Subscribe to a KhairoDietClinic program to unlock this feature."
            : access.stage === "paused"
            ? "Your KhairoDietClinic subscription is not currently active."
            : "Your KhairoDietClinic program has been completed.",
      });
    }

    req.portalAccess = access;

    next();
  } catch (error) {
    next(error);
  }
};
