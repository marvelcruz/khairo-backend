import Application from "../models/Application.js";
import AuditLog from "../models/AuditLog.js";
import Client from "../models/Client.js";
import ClientProgramCycle from "../models/ClientProgramCycle.js";
import Subscription from "../models/Subscription.js";
import User from "../models/User.js";
import Pricing from "../models/Pricing.js";
import { CYCLE_DAYS } from "../config/plans.js";
import { createOrderIfNeeded } from "../controllers/orderController.js";
import { syncClientToCrm } from "./crmService.js";
import { syncClientLifecycleTags } from "./clientLifecycleTagService.js";
import { dispatchWorkflowEvent } from "./workflowService.js";
import {
  getLegacyCycleWeeks,
  resolveLegacyProgramOffering,
} from "../utils/programOfferingResolver.js";

const DAY = 24 * 60 * 60 * 1000;
const TERMINAL_CLIENT_STATUSES = new Set(["completed", "cancelled"]);

async function findEnrollmentApplicationForClient(client) {
  if (!client) return null;

  const criteria = [{ clientId: client._id }];

  if (client.fromApplication) {
    criteria.push({ _id: client.fromApplication });
  }

  if (client.email) {
    criteria.push({ email: client.email });
  }

  return Application.findOne({ $or: criteria }).sort({ createdAt: -1 });
}

async function ensureInitialCoach(client) {
  if (client.assignedCoach) return null;

  const coaches = await User.find({
    isActive: true,
    roles: "coach",
  })
    .select("_id name")
    .sort({ name: 1 })
    .lean();

  if (!coaches.length) return null;

  const coachIds = coaches.map((coach) => coach._id);
  const rows = await Client.aggregate([
    {
      $match: {
        assignedCoach: { $in: coachIds },
        status: "active",
        isArchived: { $ne: true },
      },
    },
    {
      $group: {
        _id: "$assignedCoach",
        count: { $sum: 1 },
      },
    },
  ]);

  const counts = new Map(
    rows.map((row) => [String(row._id), Number(row.count || 0)])
  );

  const selected = [...coaches].sort(
    (a, b) =>
      (counts.get(String(a._id)) || 0) -
        (counts.get(String(b._id)) || 0) ||
      String(a.name || "").localeCompare(String(b.name || ""))
  )[0];

  if (!selected) return null;

  client.assignedCoach = selected._id;
  await client.save();

  await AuditLog.create({
    userName: "System",
    action: "Auto-assigned client coach",
    entityType: "Client",
    entityId: client._id.toString(),
    details: `Assigned ${selected.name} as the initial coach using least-loaded assignment.`,
  });

  return selected;
}

async function programAmountFromPayment(payment, application) {
  const gross = Number(payment.amount || 0);
  if (payment.purpose !== "combined" || !application) return gross;

  const pricing = await Pricing.findOne().lean();
  const consultationFee = Number(pricing?.consultationFee || 15000);
  return Math.max(0, gross - consultationFee);
}

function matchedReconciliation({ payment, amount, method, byName }) {
  return {
    status: "matched",
    amountReceived: amount,
    expected: amount,
    paymentId: payment._id,
    paymentAmount: amount,
    ledgerMismatch: false,
    method,
    note:
      method === "paystack_verified"
        ? "Automatically reconciled from the verified Paystack transaction."
        : "Recorded as a trusted manual payment by an administrator.",
    at: payment.paidAt || new Date(),
    byName,
  };
}

function plainWeek3Review(client) {
  if (!client?.week3Review) return {};
  return typeof client.week3Review.toObject === "function"
    ? client.week3Review.toObject()
    : { ...client.week3Review };
}

async function preservePriorJourney({ client, payment, previousStatus }) {
  if (!client.programStartedAt && !client.programEndsAt) return null;

  return ClientProgramCycle.findOneAndUpdate(
    { triggerPayment: payment._id },
    {
      $setOnInsert: {
        client: client._id,
        triggerPayment: payment._id,
        program: client.program,
        offering: client.programOffering || undefined,
        startedAt: client.programStartedAt || client.startDate || undefined,
        endedAt: client.programEndsAt || undefined,
        statusAtClose: previousStatus,
        onboarding: {
          loggedWeight: client.onboarding?.loggedWeight === true,
          tickedMeal: client.onboarding?.tickedMeal === true,
          bookedCall: client.onboarding?.bookedCall === true,
          joinedGroup: client.onboarding?.joinedGroup === true,
        },
        week3Review: plainWeek3Review(client),
        lastReviewedAt: client.lastReviewedAt || undefined,
        archivedAt: new Date(),
      },
    },
    {
      upsert: true,
      new: true,
      setDefaultsOnInsert: true,
    }
  );
}

function resetJourneyOperationalState(client) {
  client.onboarding = {
    loggedWeight: false,
    tickedMeal: false,
    bookedCall: false,
    joinedGroup: false,
  };
  client.week3Review = {
    completed: false,
    outcome: "not_set",
    notes: "",
  };
  client.dismissedFlags = [];
  client.lastReviewedAt = undefined;
  client.lastReviewedBy = undefined;
  client.followUpDay1Sent = false;
  client.followUpDay3Sent = false;
  client.followUpDay7Sent = false;
}

export async function activateVerifiedSubscription({
  payment,
  client,
  paystackData = {},
  staffId = null,
  userName = "System",
  manualMethod = null,
}) {
  if (!payment || !client) {
    throw new Error("Payment and client are required for subscription activation.");
  }

  const previousStatus = client.status;
  const previousStage = client.accountStage;
  const terminalAtPaymentStart = TERMINAL_CLIENT_STATUSES.has(previousStatus);
  const now = payment.paidAt ? new Date(payment.paidAt) : new Date();
  const previousProgramEnd = client.programEndsAt
    ? new Date(client.programEndsAt)
    : null;
  const journeyEndedBeforePayment =
    terminalAtPaymentStart ||
    previousStage === "completed" ||
    Boolean(
      previousProgramEnd && previousProgramEnd.getTime() <= now.getTime()
    );

  // If an earlier attempt already archived the prior journey, retain that
  // semantic state even if the client record was changed before a later step
  // failed and Paystack retries the same successful payment.
  let cycleArchive = await ClientProgramCycle.findOne({
    triggerPayment: payment._id,
  });

  // A repeated Paystack charge.success must be able to finish any downstream
  // work that failed after the subscription was first saved. Reuse the linked
  // subscription instead of returning early; the remaining steps are designed
  // to be idempotent.
  let subscription = null;
  let paymentAlreadyLinked = false;

  if (payment.subscription) {
    const existing = await Subscription.findById(payment.subscription);
    if (existing) {
      subscription = existing;
      paymentAlreadyLinked = true;
    }
  }

  const offering = await resolveLegacyProgramOffering(client.program);
  if (!offering) {
    throw new Error(
      `No active catalogue offering is linked to program "${client.program}".`
    );
  }

  if (
    !client.programOffering ||
    String(client.programOffering) !== String(offering._id)
  ) {
    client.programOffering = offering._id;
    client.cycleWeeks = getLegacyCycleWeeks(offering, client.program);
  }

  const enrollmentApplication = await findEnrollmentApplicationForClient(client);
  const programAmount = await programAmountFromPayment(
    payment,
    enrollmentApplication
  );

  if (!Number.isFinite(programAmount) || programAmount <= 0) {
    throw new Error("The successful payment does not contain a valid subscription amount.");
  }

  // A genuinely ended journey gets a new subscription record. Close any stale
  // current subscription instead of overwriting its history.
  if (!subscription && journeyEndedBeforePayment) {
    const priorSubscription = await Subscription.findOne({
      client: client._id,
      status: { $in: ["pending", "active", "grace_period", "paused"] },
    }).sort({ updatedAt: -1 });

    if (priorSubscription) {
      priorSubscription.status =
        previousStatus === "cancelled" ? "cancelled" : "expired";
      await priorSubscription.save();
    }
  }

  if (!subscription && !journeyEndedBeforePayment) {
    subscription = await Subscription.findOne({
      client: client._id,
      status: { $in: ["pending", "active", "grace_period", "paused"] },
    }).sort({ updatedAt: -1 });
  }

  if (!subscription) {
    subscription = new Subscription({
      client: client._id,
      program: client.program,
      offering: offering._id,
      amount: programAmount,
    });
  }

  // Only a new payment-to-subscription link changes the paid entitlement.
  // Same-payment webhook retries preserve the period already written.
  if (!paymentAlreadyLinked) {
    const existingEnd = subscription.currentPeriodEnd
      ? new Date(subscription.currentPeriodEnd)
      : null;
    const extendCurrentPaidTime =
      payment.purpose === "renewal" &&
      !journeyEndedBeforePayment &&
      ["active", "grace_period"].includes(subscription.status) &&
      existingEnd &&
      existingEnd.getTime() > now.getTime();

    subscription.program = client.program;
    subscription.offering = offering._id;
    subscription.amount = programAmount;

    if (extendCurrentPaidTime) {
      subscription.currentPeriodStart = subscription.currentPeriodStart || now;
      subscription.currentPeriodEnd = new Date(
        existingEnd.getTime() + CYCLE_DAYS * DAY
      );
    } else {
      subscription.currentPeriodStart = now;
      subscription.currentPeriodEnd = new Date(
        now.getTime() + CYCLE_DAYS * DAY
      );
    }

    subscription.status = "active";
    subscription.lastPaymentAt = now;
    subscription.renewalRemindersSent = {
      day27: false,
      day29: false,
    };

    if (staffId && !subscription.createdBy) {
      subscription.createdBy = staffId;
    }

    if (paystackData?.customer?.customer_code) {
      subscription.paystackCustomerCode = paystackData.customer.customer_code;
    }

    if (paystackData?.authorization?.authorization_code) {
      subscription.paystackAuthorizationCode =
        paystackData.authorization.authorization_code;
    }

    await subscription.save();

    payment.subscription = subscription._id;
    await payment.save();
  }

  const startNewJourney =
    journeyEndedBeforePayment ||
    !client.programStartedAt ||
    !previousProgramEnd ||
    previousStage === "preview";

  const hadPriorJourney = Boolean(
    (client.programStartedAt || client.programEndsAt) && previousStage !== "preview"
  );

  if (startNewJourney && hadPriorJourney && !cycleArchive) {
    cycleArchive = await preservePriorJourney({
      client,
      payment,
      previousStatus,
    });
  }

  const reactivationJourney =
    terminalAtPaymentStart || Boolean(cycleArchive);
  const reactivationFromStatus =
    cycleArchive?.statusAtClose || previousStatus;

  client.status = "active";
  client.reconciled = true;
  client.portalActive = true;
  client.accountStage = "active";
  client.programReconciliation = matchedReconciliation({
    payment,
    amount: programAmount,
    method: manualMethod ? `manual_${manualMethod}` : "paystack_verified",
    byName: manualMethod ? userName : "Paystack",
  });
  client.adminReconciliationReview = { completed: false };
  client.finalReconciliation = { completed: false };

  if (startNewJourney) {
    const journeyWeeks = Math.max(
      1,
      Number(client.cycleWeeks) || (client.program === "core" ? 8 : 12)
    );

    if (hadPriorJourney) {
      resetJourneyOperationalState(client);
    }

    client.programStartedAt = now;
    client.startDate = now;
    client.programEndsAt = new Date(
      now.getTime() + journeyWeeks * 7 * DAY
    );
  }

  await client.save();

  // Preserve the Medical Review doctor. Only fill a missing coach.
  await ensureInitialCoach(client);

  await Application.updateMany(
    {
      email: client.email,
      status: { $in: ["pending", "contacted"] },
    },
    { status: "approved" }
  );

  if (!paymentAlreadyLinked) {
    await AuditLog.create({
      ...(staffId ? { user: staffId } : {}),
      userName,
      action: reactivationJourney
        ? "Client reactivated via verified renewal payment"
        : manualMethod
          ? `Subscription activated via manual ${manualMethod}`
          : "Subscription activated via verified payment",
      entityType: "Client",
      entityId: client._id.toString(),
      details: `${client.program} program, ₦${Number(programAmount).toLocaleString()}`,
    });
  }

  const order = await createOrderIfNeeded({
    client,
    subscription,
    staffId: staffId || undefined,
  });

  try {
    const { contact, opportunity } = await syncClientToCrm(
      client,
      enrollmentApplication,
      {
        userId: staffId || undefined,
        userName,
      }
    );

    const lifecycleMilestones = [
      "payment_completed",
      "client_activated",
      ...(order ? ["order_created"] : []),
      ...(client.assignedDoctor ? ["doctor_assigned"] : []),
      ...(client.assignedCoach ? ["coach_assigned"] : []),
    ];

    await syncClientLifecycleTags(client, {
      milestones: lifecycleMilestones,
      actorUserId: staffId || undefined,
    });

    const journeyKey = client.programStartedAt
      ? new Date(client.programStartedAt).toISOString()
      : String(subscription._id);

    await dispatchWorkflowEvent({
      type: "client_activated",
      eventKey: `client_activated:${client._id}:${journeyKey}`,
      clientId: client._id,
      applicationId: enrollmentApplication?._id,
      contactId: contact?._id,
      opportunityId: opportunity?._id,
      actorUserId: staffId || undefined,
      actorName: userName,
      data: {
        clientName: client.fullName,
        programInterest:
          client.program || contact?.programInterest || "not_sure",
        reactivated: reactivationJourney,
      },
    });

    if (reactivationJourney) {
      await dispatchWorkflowEvent({
        type: "client_status_changed",
        eventKey: `client_status_changed:${client._id}:reactivation:${payment._id}`,
        clientId: client._id,
        applicationId: enrollmentApplication?._id,
        contactId: contact?._id,
        opportunityId: opportunity?._id,
        actorUserId: staffId || undefined,
        actorName: userName,
        data: {
          clientName: client.fullName,
          fromStatus: reactivationFromStatus,
          toStatus: "active",
          reason: "Verified renewal payment",
          programInterest: client.program,
        },
      });
    }
  } catch (error) {
    console.error("CRM/client workflow sync failed:", error.message);
  }

  return subscription;
}

export async function findActivationApplication(client) {
  return findEnrollmentApplicationForClient(client);
}
