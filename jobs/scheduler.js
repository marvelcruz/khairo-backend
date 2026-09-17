import cron from "node-cron";
import scheduledJobs from "./registry.js";

const resolveOptions = (job) =>
  typeof job.options === "function" ? job.options() : job.options;

export const registerScheduledJobs = () =>
  scheduledJobs.map((job) => {
    if (!job?.name || !job?.schedule || typeof job.run !== "function") {
      throw new Error("Invalid scheduled job definition.");
    }

    if (!cron.validate(job.schedule)) {
      throw new Error(
        `Invalid cron expression for scheduled job "${job.name}": ${job.schedule}`
      );
    }

    return cron.schedule(job.schedule, job.run, resolveOptions(job));
  });
