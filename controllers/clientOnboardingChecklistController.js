import Client from "../models/Client.js";
import { buildClientOnboardingChecklist } from "../services/clientOnboardingChecklistService.js";

export const getClientOnboardingChecklist = async (req, res, next) => {
  try {
    const steps = await buildClientOnboardingChecklist(req.client);
    const completed = steps.filter((step) => step.complete).length;

    res.status(200).json({
      success: true,
      steps,
      completed,
      total: steps.length,
      percentComplete: steps.length
        ? Math.round((completed / steps.length) * 100)
        : 0,
    });
  } catch (error) {
    next(error);
  }
};

export const getStaffClientOnboardingChecklist = async (req, res, next) => {
  try {
    const client = await Client.findById(req.params.id);
    if (!client) {
      return res.status(404).json({ success: false, message: "Client not found." });
    }

    const steps = await buildClientOnboardingChecklist(client);
    const completed = steps.filter((step) => step.complete).length;

    res.status(200).json({
      success: true,
      steps,
      completed,
      total: steps.length,
      percentComplete: steps.length
        ? Math.round((completed / steps.length) * 100)
        : 0,
    });
  } catch (error) {
    next(error);
  }
};
