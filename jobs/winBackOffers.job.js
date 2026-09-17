import { runWinBackOffers } from "../services/winBackService.js";

const winBackOffersJob = {
  name: "win-back-offers",
  schedule: "30 8 * * *",
  options: { noOverlap: true },
  run: async () => {
    try {
      const result = await runWinBackOffers();
      if (result.sent || result.failed) {
        console.log("Win-back offer scan:", result);
      }
    } catch (error) {
      console.error("Win-back offer scan failed:", error?.message || error);
    }
  },
};

export default winBackOffersJob;
