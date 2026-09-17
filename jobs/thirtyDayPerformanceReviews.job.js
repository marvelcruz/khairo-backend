import Client from "../models/Client.js";
import { generateClientReview } from "../controllers/reviewController.js";

const thirtyDayPerformanceReviewsJob = {
  name: "thirty-day-performance-reviews",
  schedule: "0 0 * * *",
  run: async () => {
    console.log(" Running automated 30-day performance reviews...");
    try {
      const activeClients = await Client.find({
        status: "active",
        reconciled: true,
      });

      for (const client of activeClients) {
        const daysActive =
          (new Date() - new Date(client.startDate)) / (1000 * 60 * 60 * 24);

        if (daysActive >= 30) {
          await generateClientReview(client._id);
        }
      }

      console.log(" Automated reviews generated.");
    } catch (err) {
      console.error("Cron job error:", err);
    }
  },
};

export default thirtyDayPerformanceReviewsJob;
