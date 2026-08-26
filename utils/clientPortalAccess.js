import Subscription from "../models/Subscription.js";

const DAY = 24 * 60 * 60 * 1000;

export async function syncClientPortalAccess(client) {
  const now = new Date();

  const subscription = await Subscription.findOne({
    client: client._id,
  })
    .sort({
      currentPeriodStart: -1,
      createdAt: -1,
    })
    .lean();

  const programEnd =
    client.programEndsAt
      ? new Date(client.programEndsAt)
      : null;

  let stage = client.accountStage || "active";

  if (
    programEnd &&
    programEnd.getTime() <= now.getTime()
  ) {
    stage = "completed";
  } else if (subscription) {
    const subscriptionEnd =
      subscription.currentPeriodEnd
        ? new Date(subscription.currentPeriodEnd)
        : null;

    const subscriptionCurrent =
      ["active", "grace_period"].includes(subscription.status) &&
      (!subscriptionEnd ||
        subscriptionEnd.getTime() >= now.getTime());

    if (subscriptionCurrent) {
      stage = "active";
    } else {
      stage = "paused";
    }
  } else if (client.registeredFromPortal && !client.reconciled) {
    stage = "preview";
  } else if (client.reconciled) {
    stage = "active";
  }

  let changed = false;

  if (client.accountStage !== stage) {
    client.accountStage = stage;
    changed = true;
  }

  if (
    stage === "active" &&
    (!client.programStartedAt || !client.programEndsAt)
  ) {
    const start =
      client.startDate
        ? new Date(client.startDate)
        : new Date();

    const weeks =
      Math.max(
        1,
        Number(client.cycleWeeks) ||
          (client.program === "core" ? 8 : 12)
      );

    client.programStartedAt = start;
    client.programEndsAt =
      new Date(start.getTime() + weeks * 7 * DAY);

    changed = true;
  }

  if (changed) {
    await client.save({
      validateBeforeSave: false,
    });
  }

  const start =
    client.programStartedAt
      ? new Date(client.programStartedAt)
      : null;

  const end =
    client.programEndsAt
      ? new Date(client.programEndsAt)
      : null;

  const totalDays =
    Math.max(
      1,
      Number(client.cycleWeeks || 0) * 7
    );

  let programDay = null;
  let currentWeek = null;
  let daysRemaining = null;

  if (start && stage !== "preview") {
    programDay =
      Math.min(
        totalDays,
        Math.max(
          1,
          Math.floor(
            (now.getTime() - start.getTime()) / DAY
          ) + 1
        )
      );

    currentWeek =
      Math.max(
        1,
        Math.min(
          Number(client.cycleWeeks) || 1,
          Math.ceil(programDay / 7)
        )
      );

    daysRemaining =
      Math.max(
        0,
        totalDays - programDay
      );
  }

  return {
    stage,
    subscriptionStatus:
      subscription?.status || null,
    subscriptionPeriodEnd:
      subscription?.currentPeriodEnd || null,
    programStartedAt:
      client.programStartedAt || null,
    programEndsAt:
      client.programEndsAt || null,
    programDay,
    currentWeek,
    totalDays,
    daysRemaining,
  };
}
