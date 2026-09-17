import { runOperationalAutomations } from "../services/operationalAutomationService.js";

const operationalAutomationsJob = {
  name: "operational-automations",
  schedule: "45 * * * *",
  options: { noOverlap: true },
  run: async () => {
    try {
      const result = await runOperationalAutomations();
      if (
        result.newSignup?.acted ||
        result.qualification?.acted ||
        result.monthlyReviews?.acted ||
        result.activation?.acted
      ) {
        console.log("Operational automations ran:", result);
      }
    } catch (error) {
      console.error("Operational automations failed:", error?.message || error);
    }
  },
};

export default operationalAutomationsJob;
