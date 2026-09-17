import actionCentreAlertsJob from "./actionCentreAlerts.job.js";
import consultationRemindersJob from "./consultationReminders.job.js";
import stalePaymentReconciliationJob from "./stalePaymentReconciliation.job.js";
import operationalAutomationsJob from "./operationalAutomations.job.js";
import winBackOffersJob from "./winBackOffers.job.js";
import subscriptionRenewalRemindersJob from "./subscriptionRenewalReminders.job.js";
import subscriptionLifecycleJob from "./subscriptionLifecycle.job.js";
import actionCentreSlaJob from "./actionCentreSla.job.js";
import resumeWaitingWorkflowsJob from "./resumeWaitingWorkflows.job.js";
import week3ReviewTasksJob from "./week3ReviewTasks.job.js";
import clientBehaviorMilestonesJob from "./clientBehaviorMilestones.job.js";
import clientRetentionRiskJob from "./clientRetentionRisk.job.js";
import dailyEngagementReviewJob from "./dailyEngagementReview.job.js";
import thirtyDayPerformanceReviewsJob from "./thirtyDayPerformanceReviews.job.js";

const scheduledJobs = [
  actionCentreAlertsJob,
  consultationRemindersJob,
  stalePaymentReconciliationJob,
  operationalAutomationsJob,
  winBackOffersJob,
  subscriptionRenewalRemindersJob,
  subscriptionLifecycleJob,
  actionCentreSlaJob,
  resumeWaitingWorkflowsJob,
  week3ReviewTasksJob,
  clientBehaviorMilestonesJob,
  clientRetentionRiskJob,
  dailyEngagementReviewJob,
  thirtyDayPerformanceReviewsJob,
];

export default scheduledJobs;
