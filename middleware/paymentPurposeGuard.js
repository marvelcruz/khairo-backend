const CLIENT_PURPOSES = new Set(["program", "renewal", "upgrade"]);

export function normalizeClientPaymentPurpose(req, res, next) {
  const requested = String(req.body?.purpose || "renewal")
    .trim()
    .toLowerCase();

  if (!CLIENT_PURPOSES.has(requested)) {
    return res.status(400).json({
      success: false,
      message: "Choose a supported program payment type.",
    });
  }

  const isInitialProgramPayment =
    !req.client?.reconciled || req.client?.accountStage === "preview";

  req.body = {
    ...(req.body || {}),
    purpose: isInitialProgramPayment
      ? "program"
      : requested === "upgrade"
        ? "upgrade"
        : "renewal",
  };

  next();
}
