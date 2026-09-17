import { runConsultationReminderScan } from "../services/consultationReminderService.js";

const consultationRemindersJob = {
  name: "consultation-reminders",
  schedule: "*/30 * * * *",
  options: { noOverlap: true },
  run: async () => {
    try {
      const result = await runConsultationReminderScan();
      if (result.delivered || result.failed || result.skipped) {
        console.log("Consultation reminder scan:", result);
      }
    } catch (error) {
      console.error(
        "Consultation reminder scan failed:",
        error?.message || error
      );
    }
  },
};

export default consultationRemindersJob;
