import { backfillClientBehaviorMilestones } from "../services/clientBehaviorMilestoneService.js";

const clientBehaviorMilestonesJob = {
  name: "client-behavior-milestones",
  schedule: "35 * * * *",
  options: { noOverlap: true },
  run: async () => {
    try {
      const result = await backfillClientBehaviorMilestones();
      if (result.tagsAdded) {
        console.log("Client behavior milestone refresh:", result);
      }
    } catch (error) {
      console.error(
        "Client behavior milestone refresh failed:",
        error?.message || error
      );
    }
  },
};

export default clientBehaviorMilestonesJob;
