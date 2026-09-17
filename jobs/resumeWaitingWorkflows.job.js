import { resumeWaitingWorkflowRuns } from "../services/workflowService.js";

const resumeWaitingWorkflowsJob = {
  name: "resume-waiting-workflows",
  schedule: "* * * * *",
  options: { noOverlap: true },
  run: async () => {
    try {
      const result = await resumeWaitingWorkflowRuns();
      if (result.resumed || result.failed) {
        console.log("Resumed waiting workflow runs:", result);
      }
    } catch (error) {
      console.error(
        "Resume waiting workflow runs scan failed:",
        error?.message || error
      );
    }
  },
};

export default resumeWaitingWorkflowsJob;
