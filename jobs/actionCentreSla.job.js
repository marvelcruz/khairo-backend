import { runActionCentreSla } from "../services/actionCentreSlaService.js";

const actionCentreSlaJob = {
  name: "action-centre-sla",
  schedule: "*/15 * * * *",
  options: { noOverlap: true },
  run: async () => {
    try {
      const result = await runActionCentreSla();
      if (
        result.breached ||
        result.escalated ||
        result.managerEscalated ||
        result.errors
      ) {
        console.log("Action Centre SLA scan:", result);
      }
    } catch (error) {
      console.error("Action Centre SLA scan failed:", error?.message || error);
    }
  },
};

export default actionCentreSlaJob;
