import { ensureWeek3ReviewTasks } from "../services/week3ReviewService.js";

const week3ReviewTasksJob = {
  name: "week-3-review-tasks",
  schedule: "10 8 * * *",
  options: () => ({
    timezone: process.env.ENGAGEMENT_TIMEZONE || "Africa/Lagos",
    noOverlap: true,
  }),
  run: async () => {
    try {
      const result = await ensureWeek3ReviewTasks();
      if (result.created || result.missingCrm) {
        console.log("Week 3 review task scan:", result);
      }
    } catch (error) {
      console.error(
        "Week 3 review task scan failed:",
        error?.message || error
      );
    }
  },
};

export default week3ReviewTasksJob;
