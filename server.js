import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import cookieParser from "cookie-parser";
import mongoSanitize from "express-mongo-sanitize";
import mongoose from "mongoose";

import { connectDB } from "./config/db.js";
import { notFound, errorHandler } from "./middleware/errorHandler.js";
import { apiLimiter } from "./middleware/rateLimiters.js";

import authRoutes from "./routes/authRoutes.js";
import settingsRoutes from "./routes/settingsRoutes.js";
import websiteContentRoutes from "./routes/websiteContentRoutes.js";
import websitePublicRoutes from "./routes/websitePublicRoutes.js";
import publicRoutes from "./routes/publicRoutes.js";
import applicationRoutes from "./routes/applicationRoutes.js";
import clientRoutes from "./routes/clientRoutes.js";
import auditRoutes from "./routes/auditRoutes.js";
import reviewRoutes from "./routes/reviewRoutes.js";
import pricingRoutes from "./routes/pricingRoutes.js";
import followUpRoutes from "./routes/followUpRoutes.js";
import templateRoutes from "./routes/templateRoutes.js";
import onboardingRoutes from "./routes/onboardingRoutes.js";
import broadcastRoutes from "./routes/broadcastRoutes.js";
import trialRoutes from "./routes/trialRoutes.js";
import buddyRoutes from "./routes/buddyRoutes.js";
import cron from "node-cron";
import { scanApplicationAlerts } from "./services/actionCentreService.js";
import { scanOperationalAlerts } from "./services/actionCentreOperationalService.js";
import { backfillQualifiedLeadMilestones } from "./services/crmMilestoneBackfillService.js";
import { pauseLegacyMedicalReviewTaskWorkflow } from "./services/medicalReviewService.js";
import { runDailyEngagementReview } from "./services/clientEngagementService.js";
import { backfillClientBehaviorMilestones } from "./services/clientBehaviorMilestoneService.js";
import { refreshClientRetentionRiskTags } from "./services/clientRetentionRiskService.js";
import { runConsultationReminderScan } from "./services/consultationReminderService.js";
import { reconcileStalePayments } from "./services/paymentReconciliationService.js";
import { ensureWeek3ReviewTasks } from "./services/week3ReviewService.js";
import { resumeWaitingWorkflowRuns } from "./services/workflowService.js";
import { runSubscriptionRenewalReminders } from "./services/subscriptionRenewalService.js";
import { runSubscriptionLifecycle } from "./services/subscriptionLifecycleService.js";
import { ensureLegacyCataloguePrograms } from "./services/cataloguePricingService.js";
import { runWinBackOffers } from "./services/winBackService.js";
import { runOperationalAutomations } from "./services/operationalAutomationService.js";
import { runActionCentreSla } from "./services/actionCentreSlaService.js";
import Client from "./models/Client.js";
import { generateClientReview } from "./controllers/reviewController.js";
import { globalAuditTracker } from "./middleware/auditMiddleware.js";
import clientAuthRoutes from "./routes/clientAuthRoutes.js";
import clientPortalRoutes from "./routes/clientPortalRoutes.js";
import paymentRoutes from "./routes/paymentRoutes.js";
import webhookRoutes from "./routes/webhookRoutes.js";
import reportRoutes from "./routes/reportRoutes.js";
import orderRoutes from "./routes/orderRoutes.js";
import sessionRoutes from "./routes/sessionRoutes.js";
import transcriptRoutes from "./routes/transcriptRoutes.js";
import cronRoutes from "./routes/cronRoutes.js";
import changeDraftRoutes from "./routes/changeDraftRoutes.js";
import crmRoutes from "./routes/crmRoutes.js";
import medicalReviewRoutes from "./routes/medicalReviewRoutes.js";
import customFieldRoutes from "./routes/customFieldRoutes.js";
import formRoutes from "./routes/formRoutes.js";
import workflowRoutes from "./routes/workflowRoutes.js";
import projectTaskRoutes from "./routes/projectTaskRoutes.js";
import supplementRoutes from "./routes/supplementRoutes.js";
import clientSupplementRoutes from "./routes/clientSupplementRoutes.js";
import catalogueRoutes from "./routes/catalogueRoutes.js";
import subscriptionRoutes from "./routes/subscriptionRoutes.js";
import progressPhotoRoutes from "./routes/progressPhotoRoutes.js";
import clientExperienceRoutes from "./routes/clientExperienceRoutes.js";
import clientExperienceAdminRoutes from "./routes/clientExperienceAdminRoutes.js";
import careTeamRoutes from "./routes/careTeamRoutes.js";
import socialRoutes from "./routes/socialRoutes.js";
import actionCentreRoutes from "./routes/actionCentreRoutes.js";
import aiRoutes from "./routes/aiRoutes.js";
import newsletterRoutes from "./routes/newsletterRoutes.js";
import promoCodeRoutes from "./routes/promoCodeRoutes.js";
import giftCardRoutes from "./routes/giftCardRoutes.js";

dotenv.config();

const healthStatus = () => {
  const dbStates = ["disconnected", "connected", "connecting", "disconnecting"];
  const dbState = Number(mongoose.connection?.readyState || 0);
  return {
    uptimeSeconds: Math.floor(process.uptime()),
    time: new Date().toISOString(),
    database: dbStates[dbState] || "unknown",
    environment: process.env.NODE_ENV || "development",
    releaseSha,
  };
};

await connectDB();

const runStartupMaintenance = async () => {
  try {
    const catalogueSeed = await ensureLegacyCataloguePrograms();
    if (catalogueSeed.created) {
      console.log("Seeded catalogue programs from legacy pricing:", catalogueSeed);
    }
  } catch (error) {
    console.error("Catalogue program seeding failed:", error?.message || error);
  }


  try {
    const qualifiedMilestoneBackfill = await backfillQualifiedLeadMilestones();
    if (qualifiedMilestoneBackfill.changed) {
      console.log("Qualified Lead milestone backfill:", qualifiedMilestoneBackfill);
    }
  } catch (error) {
    console.error(
      "Qualified Lead milestone backfill failed:",
      error?.message || error
    );
  }

  try {
    const behaviorMilestoneBackfill = await backfillClientBehaviorMilestones();
    if (behaviorMilestoneBackfill.tagsAdded) {
      console.log("Client behavior milestone backfill:", behaviorMilestoneBackfill);
    }
  } catch (error) {
    console.error(
      "Client behavior milestone backfill failed:",
      error?.message || error
    );
  }

  try {
    const retentionRiskRefresh = await refreshClientRetentionRiskTags();
    if (
      retentionRiskRefresh.tagsAdded ||
      retentionRiskRefresh.tagsRemoved ||
      retentionRiskRefresh.attentionNeeded ||
      retentionRiskRefresh.highRisk
    ) {
      console.log("Client retention risk refresh:", retentionRiskRefresh);
    }
  } catch (error) {
    console.error(
      "Client retention risk refresh failed:",
      error?.message || error
    );
  }

  try {
    const legacyMedicalWorkflow = await pauseLegacyMedicalReviewTaskWorkflow();
    if (legacyMedicalWorkflow.changed) {
      console.log(
        "Medical Review Task workflow paused because the native medical-review module now owns doctor assignment and task creation."
      );
    }
  } catch (error) {
    console.error(
      "Medical Review workflow migration failed:",
      error?.message || error
    );
  }
};

const app = express();
const processStartedAt = new Date();
const releaseSha = String(
  process.env.RENDER_GIT_COMMIT ||
    process.env.GIT_COMMIT ||
    ""
).trim().slice(0, 7) || "unknown";

app.set("trust proxy", 1);
app.use(helmet());
app.use(mongoSanitize());

const allowedOrigins = (process.env.CLIENT_URL || "").split(",").map((o) => o.trim());
app.use(
  cors({
    origin: allowedOrigins,
    credentials: true,
  })
);

app.use(express.json({ limit: "1mb", verify: (req, res, buf) => { req.rawBody = buf; } }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

if (process.env.NODE_ENV !== "production") {
  app.use(morgan("dev"));
}

app.use("/api", apiLimiter);

app.get("/api/health", (req, res) => {
  res.status(200).json({
    success: true,
    message: "Khairo Diet Clinic API is running.",
    release: releaseSha,
    uptimeSeconds: Math.max(0, Math.floor((Date.now() - processStartedAt.getTime()) / 1000)),
  });
});

app.get("/api/ready", (req, res) => {
  const databaseReady = mongoose.connection.readyState === 1;
  res.status(databaseReady ? 200 : 503).json({
    success: databaseReady,
    ready: databaseReady,
    databaseReady,
    release: releaseSha,
  });
});

// Cron endpoints (no auth, no audit tracking)
app.use("/api/cron", cronRoutes);
app.use("/api/supplements", supplementRoutes);
app.use("/api/client-supplements", clientSupplementRoutes);
app.use("/api/catalogue", catalogueRoutes);
app.use("/api/subscriptions", subscriptionRoutes);

app.use("/api/auth", authRoutes);
app.use("/api/settings", settingsRoutes);
app.use("/api/website-content", websiteContentRoutes);
app.use("/api/public", publicRoutes);
app.use("/api/public/website", websitePublicRoutes);
app.use("/api/forms", formRoutes);
app.use("/api/workflows", workflowRoutes);
app.use("/api/projects-tasks", projectTaskRoutes);
app.use("/api/applications", applicationRoutes);
app.use(globalAuditTracker);
app.use("/api/crm", crmRoutes);
app.use("/api/medical-reviews", medicalReviewRoutes);
app.use("/api/custom-fields", customFieldRoutes);
app.use("/api/clients", clientRoutes);
app.use("/api/audit", auditRoutes);
app.use("/api/reviews", reviewRoutes);
app.use("/api", pricingRoutes);
app.use("/api", followUpRoutes);
app.use("/api", templateRoutes);
app.use("/api", onboardingRoutes);
app.use("/api", broadcastRoutes);
app.use("/api/social", socialRoutes);
app.use("/api/action-centre", actionCentreRoutes);
app.use("/api/ai", aiRoutes);
app.use("/api/newsletters", newsletterRoutes);
app.use("/api/promo-codes", promoCodeRoutes);
app.use("/api/gift-cards", giftCardRoutes);
app.use("/api", trialRoutes);
app.use("/api", buddyRoutes);
app.use("/api/client-auth", clientAuthRoutes);
app.use("/api/client-portal", clientPortalRoutes);
app.use("/api/client-experience-admin", clientExperienceAdminRoutes);
app.use("/api/care-team", careTeamRoutes);
app.use("/api/client-experience", clientExperienceRoutes);
app.use("/api/client-portal/progress-photos", progressPhotoRoutes);
app.use("/api/payments", paymentRoutes);
app.use("/api/webhooks", webhookRoutes);
app.use("/api/reports", reportRoutes);
app.use("/api/orders", orderRoutes);
app.use("/api/sessions", sessionRoutes);
app.use("/api/transcripts", transcriptRoutes);
app.use("/api/drafts", changeDraftRoutes);

app.use(notFound);
app.use(errorHandler);

const PORT = process.env.PORT || 5000;

// Keep both application and operational Action Centre alerts current without
// requiring a staff member to open the Action Centre page.
cron.schedule(
  "15 * * * *",
  async () => {
    try {
      const result = await scanApplicationAlerts({
        sendNotifications: true,
      });

      if (
        result.created ||
        result.autoResolved ||
        result.emailsSent ||
        result.escalationsSent
      ) {
        console.log("Application Action Centre scan:", result);
      }
    } catch (error) {
      console.error(
        "Application Action Centre scan failed:",
        error?.message || error
      );
    }

    try {
      const result = await scanOperationalAlerts();
      if (result.created || result.updated || result.autoResolved) {
        console.log("Operational Action Centre scan:", result);
      }
    } catch (error) {
      console.error(
        "Operational Action Centre scan failed:",
        error?.message || error
      );
    }
  },
  { noOverlap: true }
);

// Send consultation reminders around 24 hours and 2 hours before the booking.
cron.schedule(
  "*/30 * * * *",
  async () => {
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
  { noOverlap: true }
);

// Paystack does not send failure/abandon webhooks for normal card attempts,
// so verify stale pending transactions and persist any terminal status.
cron.schedule(
  "*/15 * * * *",
  async () => {
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
  { noOverlap: true }
);

// Run configurable operational automations.
cron.schedule(
  "45 * * * *",
  async () => {
    try {
      const result = await runOperationalAutomations();
      if (
        result.newSignup?.acted ||
        result.qualification?.acted ||
        result.monthlyReviews?.acted ||
        result.activation?.acted
      ) {
        console.log("Operational automations ran:", result);
      }
    } catch (error) {
      console.error("Operational automations failed:", error?.message || error);
    }
  },
  { noOverlap: true }
);

// Send win-back offers to inactive/expired clients.
cron.schedule(
  "30 8 * * *",
  async () => {
    try {
      const result = await runWinBackOffers();
      if (result.sent || result.failed) {
        console.log("Win-back offer scan:", result);
      }
    } catch (error) {
      console.error("Win-back offer scan failed:", error?.message || error);
    }
  },
  { noOverlap: true }
);

// Send renewal reminders for active subscriptions approaching their period end.
cron.schedule(
  "0 8 * * *",
  async () => {
    try {
      const result = await runSubscriptionRenewalReminders();
      if (result.sent || result.failed) {
        console.log("Subscription renewal reminders:", result);
      }
    } catch (error) {
      console.error(
        "Subscription renewal reminder scan failed:",
        error?.message || error
      );
    }
  },
  {
    timezone: process.env.ENGAGEMENT_TIMEZONE || "Africa/Lagos",
    noOverlap: true,
  }
);

// Run subscription lifecycle: active -> grace -> expired, and pause clients.
cron.schedule(
  "15 1 * * *",
  async () => {
    try {
      const result = await runSubscriptionLifecycle();
      if (result.activeToGrace || result.graceToExpired || result.errors) {
        console.log("Subscription lifecycle scan:", result);
      }
    } catch (error) {
      console.error("Subscription lifecycle scan failed:", error?.message || error);
    }
  },
  { noOverlap: true }
);

// Run operational SLA transition checks for open Action Centre alerts.
cron.schedule(
  "*/15 * * * *",
  async () => {
    try {
      const result = await runActionCentreSla();
      if (result.breached || result.escalated || result.managerEscalated || result.errors) {
        console.log("Action Centre SLA scan:", result);
      }
    } catch (error) {
      console.error("Action Centre SLA scan failed:", error?.message || error);
    }
  },
  { noOverlap: true }
);

// Resume workflow runs whose wait/delay period has finished.
cron.schedule(
  "* * * * *",
  async () => {
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
  { noOverlap: true }
);

// Create one staff task when an active client reaches day 21.
cron.schedule(
  "10 8 * * *",
  async () => {
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
  {
    timezone: process.env.ENGAGEMENT_TIMEZONE || "Africa/Lagos",
    noOverlap: true,
  }
);

// Refresh reusable client behavior milestones every hour.
cron.schedule(
  "35 * * * *",
  async () => {
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
  { noOverlap: true }
);

// Refresh reversible client retention-risk state every hour.
cron.schedule(
  "45 * * * *",
  async () => {
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
  { noOverlap: true }
);

// Runs each morning after the previous tracking day has fully closed.
cron.schedule(
  "0 9 * * *",
  async () => {
    try {
      const result = await runDailyEngagementReview({ sendNotifications: true });
      if (result.missed || result.nudgesSent || result.duplicatesSkipped) {
        console.log("Daily engagement review:", result);
      }
    } catch (error) {
      console.error(
        "Daily engagement review failed:",
        error?.message || error
      );
    }
  },
  {
    timezone: process.env.ENGAGEMENT_TIMEZONE || "Africa/Lagos",
    noOverlap: true,
  }
);

// Runs every day at midnight. Checks if any active client has been around for 30+ days.
cron.schedule("0 0 * * *", async () => {
  console.log(" Running automated 30-day performance reviews...");
  try {
    const activeClients = await Client.find({
      status: "active",
      reconciled: true,
    });
    for (const client of activeClients) {
      const daysActive = (new Date() - new Date(client.startDate)) / (1000 * 60 * 60 * 24);
      if (daysActive >= 30) {
        await generateClientReview(client._id);
      }
    }
    console.log(" Automated reviews generated.");
  } catch (err) {
    console.error("Cron job error:", err);
  }
});

const server = app.listen(PORT, () => {
  console.log(`Server running in ${process.env.NODE_ENV || "development"} mode on port ${PORT}`);
  setImmediate(() => {
    runStartupMaintenance().catch((error) => {
      console.error("Startup maintenance failed:", error?.message || error);
    });
  });
});

let shuttingDown = false;

async function shutdown(signal, exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`${signal} received. Closing Khairo Diet Clinic API gracefully.`);

  const forceExit = setTimeout(() => {
    console.error("Graceful shutdown timed out; forcing process exit.");
    process.exit(1);
  }, 10000);
  forceExit.unref();

  server.close(async () => {
    try {
      await mongoose.disconnect();
    } catch (error) {
      console.error("Mongo disconnect during shutdown failed:", error?.message || error);
      exitCode = 1;
    } finally {
      clearTimeout(forceExit);
      process.exit(exitCode);
    }
  });
}

process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});

process.on("SIGINT", () => {
  void shutdown("SIGINT");
});

process.on("unhandledRejection", (error) => {
  console.error("Unhandled promise rejection:", error);
  void shutdown("unhandledRejection", 1);
});

process.on("uncaughtException", (error) => {
  console.error("Uncaught exception:", error);
  void shutdown("uncaughtException", 1);
});