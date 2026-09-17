import { refreshClientRetentionRiskTags } from "../services/clientRetentionRiskService.js";

const clientRetentionRiskJob = {
  name: "client-retention-risk",
  schedule: "45 * * * *",
  options: { noOverlap: true },
  run: async () => {
    try {
      const result = await refreshClientRetentionRiskTags();
      if (
        result.tagsAdded ||
        result.tagsRemoved ||
        result.attentionNeeded ||
        result.highRisk
      ) {
        console.log("Client retention risk refresh:", result);
      }
    } catch (error) {
      console.error(
        "Client retention risk refresh failed:",
        error?.message || error
      );
    }
  },
};

export default clientRetentionRiskJob;
