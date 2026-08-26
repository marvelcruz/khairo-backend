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
            ? "Subscribe to a Khairo Diet Clinic program to unlock this feature."
            : access.stage === "paused"
            ? "Your Khairo Diet Clinic subscription is not currently active."
            : "Your Khairo Diet Clinic program has been completed.",
      });
    }

    req.portalAccess = access;

    next();
  } catch (error) {
    next(error);
  }
};
