import { runSubscriptionRenewalReminders } from "../services/subscriptionRenewalService.js";

const subscriptionRenewalRemindersJob = {
  name: "subscription-renewal-reminders",
  schedule: "0 8 * * *",
  options: () => ({
    timezone: process.env.ENGAGEMENT_TIMEZONE || "Africa/Lagos",
    noOverlap: true,
  }),
  run: async () => {
    try {
      const result = await runSubscriptionRenewalReminders();
      if (result.sent || result.failed) {
        console.log("Subscription renewal reminders:", result);
      }
    } catch (error) {
      console.error(
        "Subscription renewal reminder scan failed:",
        error?.message || error
      );
    }
  },
};

export default subscriptionRenewalRemindersJob;
