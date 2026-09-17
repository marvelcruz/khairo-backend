import { reconcileStalePayments } from "../services/paymentReconciliationService.js";

const stalePaymentReconciliationJob = {
  name: "stale-payment-reconciliation",
  schedule: "*/15 * * * *",
  options: { noOverlap: true },
  run: async () => {
    try {
      const result = await reconcileStalePayments();
      if (
        !result.skipped &&
        (result.success || result.failed || result.abandoned || result.errors)
      ) {
        console.log("Stale payment reconciliation:", result);
      }
    } catch (error) {
      console.error(
        "Stale payment reconciliation failed:",
        error?.message || error
      );
    }
  },
};

export default stalePaymentReconciliationJob;
