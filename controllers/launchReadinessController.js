import mongoose from "mongoose";
import ActionAlert from "../models/ActionAlert.js";
import Application from "../models/Application.js";
import Client from "../models/Client.js";
import CrmContact from "../models/CrmContact.js";
import InboundMessageReceipt from "../models/InboundMessageReceipt.js";
import MedicalReviewCase from "../models/MedicalReviewCase.js";
import Payment from "../models/Payment.js";
import Subscription from "../models/Subscription.js";
import WorkflowRun from "../models/WorkflowRun.js";
import { isEmailConfigured } from "../utils/mailer.js";

const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;
const ONBOARDING_KEYS = ["loggedWeight", "tickedMeal", "bookedCall", "joinedGroup"];

function check({ key, label, count, severity, href, description }) {
  return {
    key,
    label,
    count: Number(count || 0),
    severity,
    href,
    description,
    clear: Number(count || 0) === 0,
  };
}

function configured(value) {
  return Boolean(String(value || "").trim());
}

function configurationStatus() {
  return [
    {
      key: "authentication",
      label: "Authentication signing key",
      configured: configured(process.env.JWT_SECRET),
      critical: true,
    },
    {
      key: "client_origin",
      label: "Frontend origin / CORS",
      configured: configured(process.env.CLIENT_URL),
      critical: true,
    },
    {
      key: "payments",
      label: "Paystack payments",
      configured: configured(process.env.PAYSTACK_SECRET_KEY),
      critical: true,
    },
    {
      key: "email",
      label: "Brevo email delivery",
      configured: isEmailConfigured(),
      critical: true,
    },
    {
      key: "meta_webhooks",
      label: "Meta inbound webhooks",
      configured:
        configured(process.env.META_WEBHOOK_VERIFY_TOKEN) &&
        configured(process.env.META_APP_SECRET),
      critical: false,
    },
  ];
}

function daysSince(value, now) {
  const time = value ? new Date(value).getTime() : NaN;
  if (!Number.isFinite(time)) return 0;
  return Math.max(0, Math.floor((now.getTime() - time) / DAY));
}

function activationIsConsistent(client) {
  return (
    client.accountStage === "active" &&
    client.reconciled === true &&
    client.portalActive === true &&
    Boolean(client.programStartedAt)
  );
}

function onboardingCompleted(client) {
  return ONBOARDING_KEYS.filter((key) => client.onboarding?.[key] === true).length;
}

async function smokeProbe(key, label, task) {
  const startedAt = Date.now();
  try {
    await task();
    return {
      key,
      label,
      passed: true,
      durationMs: Date.now() - startedAt,
    };
  } catch (error) {
    console.error(`Launch smoke probe failed (${key}):`, error?.message || error);
    return {
      key,
      label,
      passed: false,
      durationMs: Date.now() - startedAt,
    };
  }
}

export const getLaunchSmoke = async (req, res, next) => {
  try {
    const startedAt = Date.now();
    const configuration = configurationStatus();
    const criticalConfigurationMissing = configuration.filter(
      (item) => item.critical && !item.configured
    );

    const probes = await Promise.all([
      smokeProbe("database_ping", "Database ping", async () => {
        if (mongoose.connection.readyState !== 1 || !mongoose.connection.db) {
          throw new Error("Database connection is not ready.");
        }
        await mongoose.connection.db.admin().ping();
      }),
      smokeProbe("applications", "Applications collection", async () => {
        await Application.findOne({}).select("_id").lean();
      }),
      smokeProbe("clients", "Clients collection", async () => {
        await Client.findOne({}).select("_id").lean();
      }),
      smokeProbe("crm", "CRM contacts collection", async () => {
        await CrmContact.findOne({}).select("_id").lean();
      }),
      smokeProbe("payments", "Payments collection", async () => {
        await Payment.findOne({}).select("_id").lean();
      }),
      smokeProbe("subscriptions", "Subscriptions collection", async () => {
        await Subscription.findOne({}).select("_id").lean();
      }),
      smokeProbe("workflows", "Workflow runs collection", async () => {
        await WorkflowRun.findOne({}).select("_id").lean();
      }),
    ]);

    const failedProbes = probes.filter((probe) => !probe.passed);
    const passed = failedProbes.length === 0 && criticalConfigurationMissing.length === 0;

    return res.status(200).json({
      success: true,
      readOnly: true,
      passed,
      generatedAt: new Date(),
      durationMs: Date.now() - startedAt,
      deployedCommit: String(
        process.env.RENDER_GIT_COMMIT || process.env.GIT_COMMIT || "unknown"
      ).slice(0, 7),
      summary: {
        probesPassed: probes.length - failedProbes.length,
        probesTotal: probes.length,
        failedProbes: failedProbes.length,
        criticalConfigurationMissing: criticalConfigurationMissing.length,
      },
      probes,
      configuration,
    });
  } catch (error) {
    next(error);
  }
};

export const getLaunchReadiness = async (req, res, next) => {
  try {
    const now = new Date();
    const week3Cutoff = new Date(now.getTime() - 21 * DAY);
    const stalePaymentCutoff = new Date(now.getTime() - 30 * MINUTE);
    const recentPaymentCutoff = new Date(now.getTime() - 7 * DAY);
    const workflowWindow = new Date(now.getTime() - DAY);
    const stuckInboundCutoff = new Date(now.getTime() - 10 * MINUTE);

    const [
      activeClients,
      activeClientRecords,
      qualificationQueue,
      week3Due,
      medicalPending,
      urgentAlerts,
      warningAlerts,
      stalePendingPayments,
      recentPaymentProblems,
      workflowFailures24h,
      inboundFailures24h,
      inboundStuck24h,
    ] = await Promise.all([
      Client.countDocuments({
        isArchived: false,
        status: "active",
        accountStage: "active",
      }),
      Client.find({
        isArchived: { $ne: true },
        status: "active",
      })
        .select("accountStage reconciled portalActive programStartedAt onboarding")
        .limit(1000)
        .lean(),
      Application.countDocuments({
        status: { $in: ["pending", "contacted"] },
        "qualification.result": { $in: ["unreviewed", "needs_review"] },
      }),
      Client.countDocuments({
        isArchived: false,
        status: "active",
        accountStage: "active",
        "week3Review.completed": { $ne: true },
        $or: [
          { programStartedAt: { $lte: week3Cutoff } },
          { programStartedAt: { $exists: false }, startDate: { $lte: week3Cutoff } },
          { programStartedAt: null, startDate: { $lte: week3Cutoff } },
        ],
      }),
      MedicalReviewCase.countDocuments({
        status: { $nin: ["completed", "cancelled"] },
      }),
      ActionAlert.countDocuments({ status: "open", severity: "urgent" }),
      ActionAlert.countDocuments({ status: "open", severity: "warning" }),
      Payment.countDocuments({
        status: "pending",
        createdAt: { $lte: stalePaymentCutoff },
      }),
      Payment.countDocuments({
        status: { $in: ["failed", "abandoned"] },
        updatedAt: { $gte: recentPaymentCutoff },
      }),
      WorkflowRun.countDocuments({
        status: { $in: ["failed", "partial"] },
        createdAt: { $gte: workflowWindow },
      }),
      InboundMessageReceipt.countDocuments({
        status: "failed",
        updatedAt: { $gte: workflowWindow },
      }),
      InboundMessageReceipt.countDocuments({
        status: "processing",
        createdAt: { $gte: workflowWindow, $lte: stuckInboundCutoff },
      }),
    ]);

    const activationInconsistent = activeClientRecords.filter(
      (client) => !activationIsConsistent(client)
    ).length;

    const onboardingStalled = activeClientRecords.filter((client) => {
      if (!activationIsConsistent(client)) return false;
      const completed = onboardingCompleted(client);
      if (completed >= ONBOARDING_KEYS.length) return false;
      const ageDays = daysSince(client.programStartedAt, now);
      return (completed === 0 && ageDays >= 1) || (completed > 0 && ageDays >= 3);
    }).length;

    const inboundProcessingProblems = inboundFailures24h + inboundStuck24h;

    const checks = [
      check({
        key: "urgent_action_alerts",
        label: "Urgent Action Centre alerts",
        count: urgentAlerts,
        severity: "urgent",
        href: "/dashboard/action-centre",
        description: "Urgent operational follow-up that is still unresolved.",
      }),
      check({
        key: "activation_inconsistent",
        label: "Active-client activation inconsistencies",
        count: activationInconsistent,
        severity: "urgent",
        href: "/dashboard/clients/lifecycle",
        description: "Clients marked active while portal, reconciliation, account stage, or program-start state is out of sync.",
      }),
      check({
        key: "social_inbound_processing",
        label: "Social inbound processing problems (24 hours)",
        count: inboundProcessingProblems,
        severity: "urgent",
        href: "/dashboard/action-centre",
        description: "Instagram or WhatsApp messages that failed processing or remained stuck for more than 10 minutes.",
      }),
      check({
        key: "qualification_queue",
        label: "Qualification decisions outstanding",
        count: qualificationQueue,
        severity: "warning",
        href: "/dashboard/applications",
        description: "Applications still waiting for a final qualification decision.",
      }),
      check({
        key: "medical_review_pending",
        label: "Medical reviews in progress",
        count: medicalPending,
        severity: "info",
        href: "/dashboard/crm/medical-review",
        description: "Cases still moving through medical review; no clinical details are exposed here.",
      }),
      check({
        key: "onboarding_stalled",
        label: "Client onboarding stalled",
        count: onboardingStalled,
        severity: "warning",
        href: "/dashboard/coaching?tab=onboarding",
        description: "Activated clients who have not started onboarding after Day 1 or remain incomplete after Day 3.",
      }),
      check({
        key: "week3_due",
        label: "Week 3 reviews due",
        count: week3Due,
        severity: "warning",
        href: "/dashboard/week-3-review",
        description: "Active clients at or beyond Day 21 without a completed Week 3 review.",
      }),
      check({
        key: "stale_pending_payments",
        label: "Stale pending payments",
        count: stalePendingPayments,
        severity: "urgent",
        href: "/dashboard/crm/payment-pending",
        description: "Payment attempts still pending after 30 minutes and needing reconciliation.",
      }),
      check({
        key: "recent_payment_problems",
        label: "Failed or abandoned payments (7 days)",
        count: recentPaymentProblems,
        severity: "warning",
        href: "/dashboard/crm/payment-pending",
        description: "Recent failed or abandoned payment attempts that may require follow-up.",
      }),
      check({
        key: "workflow_failures",
        label: "Workflow failures (24 hours)",
        count: workflowFailures24h,
        severity: "urgent",
        href: "/dashboard/workflows",
        description: "Automation runs that failed or only partially completed in the last 24 hours.",
      }),
      check({
        key: "warning_action_alerts",
        label: "Warning Action Centre alerts",
        count: warningAlerts,
        severity: "warning",
        href: "/dashboard/action-centre",
        description: "Open operational alerts that should be cleared before they become urgent.",
      }),
    ];

    const blockingCount = checks
      .filter((item) => item.severity === "urgent")
      .reduce((sum, item) => sum + item.count, 0);

    const warningCount = checks
      .filter((item) => item.severity === "warning")
      .reduce((sum, item) => sum + item.count, 0);

    const databaseReady = mongoose.connection.readyState === 1;
    const configuration = configurationStatus();
    const criticalConfigurationMissing = configuration.filter(
      (item) => item.critical && !item.configured
    ).length;

    res.status(200).json({
      success: true,
      generatedAt: now,
      status:
        !databaseReady || criticalConfigurationMissing > 0 || blockingCount > 0
          ? "attention"
          : warningCount > 0
            ? "watch"
            : "ready",
      summary: {
        activeClients,
        blockingCount,
        warningCount,
      },
      system: {
        databaseReady,
        emailConfigured: isEmailConfigured(),
        uptimeSeconds: Math.floor(process.uptime()),
        criticalConfigurationMissing,
        configuration,
      },
      checks,
    });
  } catch (error) {
    next(error);
  }
};
