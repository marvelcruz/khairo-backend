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
import { globalAuditTracker } from "./middleware/auditMiddleware.js";
import { registerScheduledJobs } from "./jobs/scheduler.js";

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

import { backfillQualifiedLeadMilestones } from "./services/crmMilestoneBackfillService.js";
import { pauseLegacyMedicalReviewTaskWorkflow } from "./services/medicalReviewService.js";
import { backfillClientBehaviorMilestones } from "./services/clientBehaviorMilestoneService.js";
import { refreshClientRetentionRiskTags } from "./services/clientRetentionRiskService.js";
import { ensureLegacyCataloguePrograms } from "./services/cataloguePricingService.js";

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
      "Client behavior milestone refresh failed:",
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
const releaseSha =
  String(
    process.env.RENDER_GIT_COMMIT ||
      process.env.GIT_COMMIT ||
      ""
  )
    .trim()
    .slice(0, 7) || "unknown";

app.set("trust proxy", 1);
app.use(helmet());
app.use(mongoSanitize());

const allowedOrigins = (process.env.CLIENT_URL || "")
  .split(",")
  .map((o) => o.trim());

app.use(
  cors({
    origin: allowedOrigins,
    credentials: true,
  })
);

app.use(
  express.json({
    limit: "1mb",
    verify: (req, res, buf) => {
      req.rawBody = buf;
    },
  })
);
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

if (process.env.NODE_ENV !== "production") {
  app.use(morgan("dev"));
}

app.use("/api", apiLimiter);

app.get("/api/health", (req, res) => {
  res.status(200).json({
    success: true,
    message: "KhairoDietClinic API is running.",
    release: releaseSha,
    uptimeSeconds: Math.max(
      0,
      Math.floor((Date.now() - processStartedAt.getTime()) / 1000)
    ),
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

registerScheduledJobs();

const server = app.listen(PORT, () => {
  console.log(
    `Server running in ${process.env.NODE_ENV || "development"} mode on port ${PORT}`
  );
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
  console.log(`${signal} received. Closing KhairoDietClinic API gracefully.`);

  const forceExit = setTimeout(() => {
    console.error("Graceful shutdown timed out; forcing process exit.");
    process.exit(1);
  }, 10000);
  forceExit.unref();

  server.close(async () => {
    try {
      await mongoose.disconnect();
    } catch (error) {
      console.error(
        "Mongo disconnect during shutdown failed:",
        error?.message || error
      );
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
