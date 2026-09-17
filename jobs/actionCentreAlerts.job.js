import { scanApplicationAlerts } from "../services/actionCentreService.js";
import { scanOperationalAlerts } from "../services/actionCentreOperationalService.js";

const actionCentreAlertsJob = {
  name: "action-centre-alerts",
  schedule: "15 * * * *",
  options: { noOverlap: true },
  run: async () => {
    try {
      const result = await scanApplicationAlerts({
        sendNotifications: true,
      });

      if (
        result.created ||
        result.autoResolved ||
        result.emailsSent ||
        result.escalationsSent
      ) {
        console.log("Application Action Centre scan:", result);
      }
    } catch (error) {
      console.error(
        "Application Action Centre scan failed:",
        error?.message || error
      );
    }

    try {
      const result = await scanOperationalAlerts();
      if (result.created || result.updated || result.autoResolved) {
        console.log("Operational Action Centre scan:", result);
      }
    } catch (error) {
      console.error(
        "Operational Action Centre scan failed:",
        error?.message || error
      );
    }
  },
};

export default actionCentreAlertsJob;
