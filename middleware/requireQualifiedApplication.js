import Application from "../models/Application.js";

export async function requireQualifiedApplication(req, res, next) {
  try {
    const application = await Application.findById(req.params.id)
      .select("qualification fullName")
      .lean();

    if (!application) {
      return res.status(404).json({
        success: false,
        message: "Application not found.",
      });
    }

    if (application.qualification?.result !== "qualified") {
      return res.status(409).json({
        success: false,
        code: "qualification_required",
        message: "Record a Qualified decision before approving this application or creating a client record.",
        qualificationResult: application.qualification?.result || "pending",
      });
    }

    next();
  } catch (error) {
    next(error);
  }
}
