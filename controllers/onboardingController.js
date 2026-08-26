import Client from "../models/Client.js";
import { syncClientLifecycleTags } from "../services/clientLifecycleTagService.js";
import { clientScopeForUser } from "../utils/careTeamAccess.js";

const ONBOARDING_STEPS = new Set([
  "loggedWeight",
  "tickedMeal",
  "bookedCall",
  "joinedGroup",
]);

const ONBOARDING_STEP_KEYS = [
  "loggedWeight",
  "tickedMeal",
  "bookedCall",
  "joinedGroup",
];

export const getOnboarding = async (req, res, next) => {
  try {
    const client = req.client;

    if (!client) {
      return res.status(401).json({
        success: false,
        message: "Client session not found.",
      });
    }

    res.status(200).json({
      success: true,
      onboarding: client.onboarding || {},
      name: client.fullName,
    });
  } catch (err) {
    next(err);
  }
};

export const updateOnboarding = async (req, res, next) => {
  try {
    const client = req.client;
    const { step } = req.body;

    if (!client) {
      return res.status(401).json({
        success: false,
        message: "Client session not found.",
      });
    }

    if (!ONBOARDING_STEPS.has(step)) {
      return res.status(400).json({
        success: false,
        message: "Invalid onboarding step.",
      });
    }

    client.set(`onboarding.${step}`, true);
    await client.save();

    await syncClientLifecycleTags(client);

    res.status(200).json({
      success: true,
      onboarding: client.onboarding,
    });
  } catch (err) {
    next(err);
  }
};

export const getStaffOnboardingQueue = async (req, res, next) => {
  try {
    const query = {
      isArchived: { $ne: true },
      status: "active",
      accountStage: "active",
      reconciled: true,
      portalActive: true,
      programStartedAt: { $exists: true, $ne: null },
    };

    Object.assign(
      query,
      clientScopeForUser(req.user, {
        allowStaff: true,
        allowSales: false,
      })
    );

    const clients = await Client.find(query)
      .select(
        "fullName email phone program cycleWeeks onboarding programStartedAt programEndsAt portalActive accountStage assignedCoach assignedDoctor"
      )
      .populate("assignedCoach", "name")
      .populate("assignedDoctor", "name")
      .sort({ programStartedAt: -1 })
      .limit(300);

    const now = Date.now();

    const items = clients.map((client) => {
      const onboarding = Object.fromEntries(
        ONBOARDING_STEP_KEYS.map((key) => [
          key,
          client.onboarding?.[key] === true,
        ])
      );

      const completedSteps = ONBOARDING_STEP_KEYS.filter(
        (key) => onboarding[key]
      ).length;

      const progressPercent = Math.round(
        (completedSteps / ONBOARDING_STEP_KEYS.length) * 100
      );

      const startedAt = client.programStartedAt
        ? new Date(client.programStartedAt)
        : null;

      const daysSinceActivation = startedAt
        ? Math.max(
            0,
            Math.floor(
              (now - startedAt.getTime()) /
                (24 * 60 * 60 * 1000)
            )
          )
        : null;

      return {
        _id: client._id,
        fullName: client.fullName,
        email: client.email,
        phone: client.phone,
        program: client.program,
        cycleWeeks: client.cycleWeeks,
        programStartedAt: client.programStartedAt,
        programEndsAt: client.programEndsAt,
        portalActive: client.portalActive,
        accountStage: client.accountStage,
        assignedCoach: client.assignedCoach || null,
        assignedDoctor: client.assignedDoctor || null,
        onboarding,
        completedSteps,
        totalSteps: ONBOARDING_STEP_KEYS.length,
        progressPercent,
        onboardingStatus:
          completedSteps === ONBOARDING_STEP_KEYS.length
            ? "complete"
            : completedSteps === 0
              ? "not_started"
              : "in_progress",
        daysSinceActivation,
      };
    });

    res.status(200).json({
      success: true,
      count: items.length,
      items,
    });
  } catch (err) {
    next(err);
  }
};
