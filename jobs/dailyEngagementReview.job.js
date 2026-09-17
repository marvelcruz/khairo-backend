import { runDailyEngagementReview } from "../services/clientEngagementService.js";

const dailyEngagementReviewJob = {
  name: "daily-engagement-review",
  schedule: "0 9 * * *",
  options: () => ({
    timezone: process.env.ENGAGEMENT_TIMEZONE || "Africa/Lagos",
    noOverlap: true,
  }),
  run: async () => {
    try {
      const result = await runDailyEngagementReview({
        sendNotifications: true,
      });
      if (result.missed || result.nudgesSent || result.duplicatesSkipped) {
        console.log("Daily engagement review:", result);
      }
    } catch (error) {
      console.error(
        "Daily engagement review failed:",
        error?.message || error
      );
    }
  },
};

export default dailyEngagementReviewJob;
