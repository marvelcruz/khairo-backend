import { runSubscriptionLifecycle } from "../services/subscriptionLifecycleService.js";

const subscriptionLifecycleJob = {
  name: "subscription-lifecycle",
  schedule: "15 1 * * *",
  options: { noOverlap: true },
  run: async () => {
    try {
      const result = await runSubscriptionLifecycle();
      if (result.activeToGrace || result.graceToExpired || result.errors) {
        console.log("Subscription lifecycle scan:", result);
      }
    } catch (error) {
      console.error("Subscription lifecycle scan failed:", error?.message || error);
    }
  },
};

export default subscriptionLifecycleJob;
