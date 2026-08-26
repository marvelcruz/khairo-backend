import Client from "../models/Client.js";
import Payment from "../models/Payment.js";
import DailyLog from "../models/DailyLog.js";
import { logAudit } from "../utils/auditLogger.js";
import {
  getLegacyCycleWeeks,
  isLegacyProgramKey,
  normalizeLegacyProgramKey,
  resolveLegacyProgramOffering,
} from "../utils/programOfferingResolver.js";
import { clientScopeForUser } from "../utils/careTeamAccess.js";

const escapeRegex = (str = "") => str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const clampLimit = (requested, max = 100, fallback = 20) => {
  const num = Number(requested);
  if (!num || num <= 0) return fallback;
  return Math.min(num, max);
};

// Middleware to filter sensitive data based on user permissions
export const filterByPermissions = (req, res, next) => {
  const user = req.user;

  if (!user) return next();

  const roles = user.roles || [];

  if (roles.includes("admin")) {
    return next();
  }

  const permissions = user.permissions || [];

  const hideContact =
    !permissions.includes("view_contact_info");

  const hideFin =
    !permissions.includes("view_financials");

  req.hideContactInfo = hideContact;
  req.hideFinancials = hideFin;

  const strip = (value) => {
    if (Array.isArray(value)) {
      return value.map(strip);
    }

    if (!value || typeof value !== "object") {
      return value;
    }

    const base =
      typeof value.toObject === "function"
        ? value.toObject()
        : value;

    const out = { ...base };

    const isClient =
      out.fullName !== undefined ||
      out.currentWeightKg !== undefined ||
      out.program !== undefined;

    const isApplication =
      out.programInterest !== undefined ||
      out.consultationDecision !== undefined ||
      out.healthNotes !== undefined;

    if (isClient) {
      if (hideContact) {
        delete out.email;
        delete out.phone;
      }

      if (hideFin) {
        delete out.totalPaid;
        delete out.nextPaymentDue;
      }
    }

    // Coaches need workflow/reconciliation data, not raw
    // pre-enrollment health notes.
    if (
      isApplication &&
      !roles.includes("admin")
    ) {
      delete out.healthNotes;
    }

    const canSeeReconciliationDetails =
      roles.includes("admin") ||
      roles.includes("coach");

    if (
      isApplication &&
      !canSeeReconciliationDetails
    ) {
      if (
        out.programReconciliation &&
        typeof out.programReconciliation === "object"
      ) {
        out.programReconciliation = {
          status:
            out.programReconciliation.status,
        };
      }

      if (
        out.adminReconciliationReview &&
        typeof out.adminReconciliationReview === "object"
      ) {
        out.adminReconciliationReview = {
          completed:
            out.adminReconciliationReview.completed === true,
        };
      }

      if (
        out.finalReconciliation &&
        typeof out.finalReconciliation === "object"
      ) {
        out.finalReconciliation = {
          completed:
            out.finalReconciliation.completed === true,
        };
      }

      if (
        out.timeline &&
        typeof out.timeline === "object"
      ) {
        const scrubbedTimeline = {};

        for (
          const [key, event]
          of Object.entries(out.timeline)
        ) {
          if (
            !event ||
            typeof event !== "object"
          ) {
            scrubbedTimeline[key] = event;
            continue;
          }

          const safeEvent = { ...event };

          delete safeEvent.amount;
          delete safeEvent.amountReceived;
          delete safeEvent.expected;
          delete safeEvent.paymentAmount;
          delete safeEvent.note;

          scrubbedTimeline[key] = safeEvent;
        }

        out.timeline = scrubbedTimeline;
      }
    }

    [
      "client",
      "clients",
      "applications",
      "results",
      "order",
      "orders",
      "sessions",
      "payments",
      "expiringThisWeek",
      "pairs",
      "mentee",
      "mentor",
      "contact",
      "contacts",
      "recentContacts",
      "opportunity",
      "opportunities",
      "activities",
    ].forEach((key) => {
      if (out[key] !== undefined) {
        out[key] = strip(out[key]);
      }
    });

    return out;
  };

  const originalJson = res.json.bind(res);

  res.json = (body) =>
    originalJson(strip(body));

  next();
};

export const createClient = async (req, res, next) => {
  try {
    const {
      addedBy,
      password,
      portalActive,
      reconciled,
      programReconciliation,
      adminReconciliationReview,
      finalReconciliation,
      fromApplication,
      totalPaid,
      nextPaymentDue,
      currentPeriodEnd,
      programOffering,
      ...safeBody
    } = req.body;

    const program =
      normalizeLegacyProgramKey(
        safeBody.program
      );

    if (!isLegacyProgramKey(program)) {
      return res.status(400).json({
        success: false,
        message:
          "A currently supported program is required.",
      });
    }

    const offering =
      await resolveLegacyProgramOffering(program);

    if (!offering) {
      return res.status(409).json({
        success: false,
        message:
          "This program is not linked to an active catalogue offering. Please contact an administrator.",
      });
    }

    safeBody.program = program;
    safeBody.programOffering = offering._id;

    if (safeBody.cycleWeeks === undefined) {
      safeBody.cycleWeeks =
        getLegacyCycleWeeks(
          offering,
          program
        );
    }

    if (safeBody.email) {
      const email =
        String(safeBody.email)
          .toLowerCase()
          .trim();

      const existing =
        await Client.findOne({ email });

      if (existing) {
        return res.status(409).json({
          success: false,
          message:
            "A client with this email already exists.",
        });
      }

      safeBody.email = email;
    }

    const client = await Client.create({
      ...safeBody,
      reconciled: false,
      portalActive: false,
      addedBy: req.user._id,
    });

    res.status(201).json({
      success: true,
      client,
    });
  } catch (err) {
    next(err);
  }
};

export const getClients = async (req, res, next) => {
  try {
    const { search, status, program, coach, page = 1, limit = 20 } = req.query;
    const safeLimit = clampLimit(limit);

    const query =
      req.query.archived === "true"
        ? { isArchived: true }
        : {
            isArchived: { $ne: true },
            accountStage: { $ne: "preview" },
          };

    // The client roster begins only after the reconciliation workflow is complete.
    if (req.query.reconciled === "true") {
      query.reconciled = true;
    }

    if (status) query.status = status;
    if (program) query.program = program;

    const accessScope = clientScopeForUser(req.user, {
      allowStaff: true,
      allowSales: false,
    });
    Object.assign(query, accessScope);

    const roles = req.user.roles || [];
    if (coach && (roles.includes("admin") || roles.includes("staff"))) {
      query.assignedCoach = coach;
    }
    if (search) {
      const safeSearch = escapeRegex(search);
      query.$or = [
        { fullName: { $regex: safeSearch, $options: "i" } },
        { email: { $regex: safeSearch, $options: "i" } },
        { phone: { $regex: safeSearch, $options: "i" } },
      ];
    }

    const skip = (Number(page) - 1) * safeLimit;

    const [clients, total] = await Promise.all([
      Client.find(query)
        .populate("assignedCoach", "name").populate("assignedDoctor", "name").populate("assignedDoctor", "name")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(safeLimit),
      Client.countDocuments(query),
    ]);

    res.status(200).json({
      success: true,
      count: clients.length,
      total,
      page: Number(page),
      pages: Math.ceil(total / safeLimit),
      clients,
    });
  } catch (err) {
    next(err);
  }
};

export const getClientById = async (req, res, next) => {
  try {
    const client = await Client.findById(req.params.id).populate("assignedCoach", "name").populate("assignedDoctor", "name").populate("assignedDoctor", "name");
    if (!client) {
      return res.status(404).json({ success: false, message: "Client not found." });
    }
    res.status(200).json({ success: true, client });
  } catch (err) {
    next(err);
  }
};

export const updateClient = async (req, res, next) => {
  try {
    const {
      addedBy,
      password,
      portalActive,
      reconciled,
      programReconciliation,
      adminReconciliationReview,
      finalReconciliation,
      fromApplication,
      totalPaid,
      nextPaymentDue,
      currentPeriodEnd,
      programOffering,
      ...safeUpdates
    } = req.body;

    if (safeUpdates.program !== undefined) {
      const program =
        normalizeLegacyProgramKey(
          safeUpdates.program
        );

      if (!isLegacyProgramKey(program)) {
        return res.status(400).json({
          success: false,
          message:
            "A currently supported program is required.",
        });
      }

      const offering =
        await resolveLegacyProgramOffering(
          program
        );

      if (!offering) {
        return res.status(409).json({
          success: false,
          message:
            "This program is not linked to an active catalogue offering. Please contact an administrator.",
        });
      }

      safeUpdates.program = program;
      safeUpdates.programOffering =
        offering._id;

      if (safeUpdates.cycleWeeks === undefined) {
        safeUpdates.cycleWeeks =
          getLegacyCycleWeeks(
            offering,
            program
          );
      }
    }

    const before = await Client.findById(req.params.id).select("status privateNotes fullName");
    if (!before) {
      return res.status(404).json({ success: false, message: "Client not found." });
    }

    const client = await Client.findByIdAndUpdate(req.params.id, safeUpdates, {
      new: true,
      runValidators: true,
    }).populate("assignedCoach", "name").populate("assignedDoctor", "name").populate("assignedDoctor", "name");
    if (!client) {
      return res.status(404).json({ success: false, message: "Client not found." });
    }

    if (safeUpdates.status && safeUpdates.status !== before.status) {
      await logAudit(req, `Changed status from ${before.status} to ${safeUpdates.status}`, "Client", client._id, client.fullName);
    }
    if (safeUpdates.privateNotes !== undefined && safeUpdates.privateNotes !== before.privateNotes) {
      await logAudit(req, "Updated private notes", "Client", client._id, client.fullName);
    }

    res.status(200).json({ success: true, client });
  } catch (err) {
    next(err);
  }
};

// @route POST /api/clients/:id/checkins (staff only)
export const addCheckIn = async (req, res, next) => {
  try {
    const { weightKg, notes, date } = req.body;
    const client = await Client.findById(req.params.id);
    if (!client) {
      return res.status(404).json({ success: false, message: "Client not found." });
    }

    client.checkIns.push({
      weightKg,
      notes,
      date: date || new Date(),
      recordedBy: req.user._id,
    });
    await client.save();

    res.status(201).json({ success: true, client });
  } catch (err) {
    next(err);
  }
};

// @route POST /api/clients/:id/checklist (staff only) - add one meal item
export const addChecklistItem = async (req, res, next) => {
  try {
    const { text } = req.body;
    if (!text || !text.trim()) {
      return res.status(400).json({ success: false, message: "Checklist item text is required." });
    }
    const client = await Client.findById(req.params.id);
    if (!client) return res.status(404).json({ success: false, message: "Client not found." });

    client.mealChecklist.push({ text: text.trim() });
    await client.save();

    res.status(201).json({ success: true, client });
  } catch (err) {
    next(err);
  }
};

// @route DELETE /api/clients/:id/checklist/:itemId (staff only)
export const removeChecklistItem = async (req, res, next) => {
  try {
    const client = await Client.findById(req.params.id);
    if (!client) return res.status(404).json({ success: false, message: "Client not found." });

    client.mealChecklist = client.mealChecklist.filter(
      (item) => item._id.toString() !== req.params.itemId
    );
    await client.save();

    res.status(200).json({ success: true, client });
  } catch (err) {
    next(err);
  }
};

// @route POST /api/clients/:id/mark-reviewed (staff only)
export const markReviewed = async (req, res, next) => {
  try {
    const client = await Client.findById(req.params.id);
    if (!client) return res.status(404).json({ success: false, message: "Client not found" });
    if (!client.reconciled) {
      return res.status(409).json({
        success: false,
        message: "Client must complete reconciliation before coaching review actions.",
      });
    }
    client.lastReviewedAt = new Date();
    const now = new Date();
    client.dismissedFlags = client.dismissedFlags || [];
    ["missed_logs", "weight_trend", "low_adherence"].forEach((t) => {
      client.dismissedFlags.push({ type: t, dismissedAt: now, by: req.user ? req.user._id : null });
    });
    await client.save();
    if (req.hideContactInfo) {
      client.email = undefined;
      client.phone = undefined;
    }
    if (req.hideFinancials) {
      client.totalPaid = undefined;
      client.nextPaymentDue = undefined;
    }
    res.json({ success: true, client });
  } catch (err) { next(err); }
};

// @route POST /api/clients/:id/dismiss-flag (staff only)
export const dismissFlag = async (req, res, next) => {
  try {
    const { flagType } = req.body;
    const client = await Client.findById(req.params.id);
    if (!client) return res.status(404).json({ success: false, message: "Client not found" });
    if (!client.reconciled) {
      return res.status(409).json({
        success: false,
        message: "Client must complete reconciliation before coaching flag actions.",
      });
    }
    client.dismissedFlags = client.dismissedFlags || [];
    client.dismissedFlags.push({ type: flagType, dismissedAt: new Date(), by: req.user._id });
    await client.save();
    res.json({ success: true, client });
  } catch (err) { next(err); }
};

// @route GET /api/clients/queue/review (staff only)
// Clients due for a check-in (never checked in, or > 7 days ago), oldest first.
export const getReviewQueue = async (req, res, next) => {
  try {
    // Every active client gets a check-in every 7 days, regardless of program.
    const CHECKIN_DAYS = 7;
    const query = { isArchived: false, status: "active", reconciled: true };
    if (req.query.mine === "true") query.assignedCoach = req.user._id;

    const all = await Client.find(query)
      .sort({ lastReviewedAt: 1 })
      .select("fullName email phone program lastReviewedAt currentWeightKg goalWeightKg assignedCoach")
      .populate("assignedCoach", "name").populate("assignedDoctor", "name").populate("assignedDoctor", "name");

    const now = Date.now();
    const clients = all.filter((c) => {
      if (!c.lastReviewedAt) return true;
      return now - new Date(c.lastReviewedAt).getTime() > CHECKIN_DAYS * 86400000;
    });

    res.status(200).json({ success: true, clients });
  } catch (err) {
    next(err);
  }
};

// @route GET /api/clients/queue/needs-attention (staff only)
// Flags clients with: 3+ missed logs in the last 5 days, weight trending the
// wrong way relative to their goal, or low workout adherence in the last 7 days.
export const getNeedsAttention = async (req, res, next) => {
  try {
    const attentionQuery = { isArchived: false, status: "active", reconciled: true };
    if (req.query.mine === "true") attentionQuery.assignedCoach = req.user._id;

    const clients = await Client.find(attentionQuery)
      .select("fullName email phone program startingWeightKg goalWeightKg assignedCoach dismissedFlags")
      .populate("assignedCoach", "name").populate("assignedDoctor", "name").populate("assignedDoctor", "name");

    const now = new Date();
    const fiveDaysAgo = new Date(now);
    fiveDaysAgo.setDate(fiveDaysAgo.getDate() - 5);
    const sevenDaysAgo = new Date(now);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const fiveDaysAgoKey = fiveDaysAgo.toISOString().slice(0, 10);
    const sevenDaysAgoKey = sevenDaysAgo.toISOString().slice(0, 10);

    const results = [];

    for (const client of clients) {
      const recentLogs = await DailyLog.find({
        client: client._id,
        logDate: { $gte: sevenDaysAgoKey },
      }).sort({ logDate: 1 });

      const flags = [];

      // 1) Missed logs: fewer than 3 logged days in the last 5.
      const last5DaysLogs = recentLogs.filter((l) => l.logDate >= fiveDaysAgoKey);
      if (last5DaysLogs.length <= 2) {
        const dismissed = client.dismissedFlags?.some(d => d.type === "missed_logs" && (Date.now() - new Date(d.dismissedAt).getTime()) < 7 * 86400000);
        if (!dismissed) flags.push({ type: "missed_logs", detail: `Only ${last5DaysLogs.length} of the last 5 days logged` });
      }

      // 2) Weight trending the wrong way, if we have a goal direction and 2+ weight points.
      const weightLogs = recentLogs.filter((l) => typeof l.weightKg === "number");
      if (weightLogs.length >= 2 && client.goalWeightKg != null && client.startingWeightKg != null) {
        const wantsToLose = client.goalWeightKg < client.startingWeightKg;
        const first = weightLogs[0].weightKg;
        const last = weightLogs[weightLogs.length - 1].weightKg;
        const trendingUp = last > first;
        const trendingDown = last < first;
        if ((wantsToLose && trendingUp) || (!wantsToLose && trendingDown)) {
          const dismissed = client.dismissedFlags?.some(d => d.type === "weight_trend" && (Date.now() - new Date(d.dismissedAt).getTime()) < 7 * 86400000);
          if (!dismissed) flags.push({ type: "weight_trend", detail: `Weight moved from ${first}kg to ${last}kg, away from goal` });
        }
      }

      // 3) Low workout adherence: workout done on fewer than half of logged days.
      if (recentLogs.length >= 3) {
        const workoutsDone = recentLogs.filter((l) => l.workoutDone).length;
        if (workoutsDone / recentLogs.length < 0.5) {
          const dismissed = client.dismissedFlags?.some(d => d.type === "low_adherence" && (Date.now() - new Date(d.dismissedAt).getTime()) < 7 * 86400000);
          if (!dismissed) flags.push({ type: "low_adherence", detail: `Workout done ${workoutsDone}/${recentLogs.length} logged days` });
        }
      }

      if (flags.length > 0) {
        results.push({ client, flags });
      }
    }

    res.status(200).json({ success: true, results });
  } catch (err) {
    next(err);
  }
};

// @route PATCH /api/clients/:id/timetable-mode (staff only) - body: { mode: "weekly" | "full_cycle" }
export const setTimetableMode = async (req, res, next) => {
  try {
    const { mode } = req.body;
    if (!["weekly", "full_cycle"].includes(mode)) {
      return res.status(400).json({ success: false, message: "Mode must be 'weekly' or 'full_cycle'." });
    }
    const client = await Client.findByIdAndUpdate(req.params.id, { mealTimetableMode: mode }, { new: true });
    if (!client) return res.status(404).json({ success: false, message: "Client not found." });

    res.status(200).json({ success: true, client });
  } catch (err) {
    next(err);
  }
};

// @route POST /api/clients/:id/timetable/:dayNumber (staff only) - body: { text }
// Adds one meal item to the given program day, creating the day entry if needed.
export const addTimetableItem = async (req, res, next) => {
  try {
    const { text, period } = req.body;
    const dayNumber = Number(req.params.dayNumber);
    if (!text || !text.trim()) {
      return res.status(400).json({ success: false, message: "Item text is required." });
    }
    if (!dayNumber || dayNumber < 1) {
      return res.status(400).json({ success: false, message: "Invalid day number." });
    }
    const safePeriod = ["morning", "afternoon", "evening"].includes(period) ? period : "morning";

    const client = await Client.findById(req.params.id);
    if (!client) return res.status(404).json({ success: false, message: "Client not found." });

    let dayEntry = client.mealTimetable.find((d) => d.dayNumber === dayNumber);
    if (!dayEntry) {
      client.mealTimetable.push({ dayNumber, items: [] });
      dayEntry = client.mealTimetable[client.mealTimetable.length - 1];
    }
    dayEntry.items.push({ text: text.trim(), period: safePeriod });
    await client.save();

    res.status(201).json({ success: true, client });
  } catch (err) {
    next(err);
  }
};

// @route DELETE /api/clients/:id/timetable/:dayNumber/:itemId (staff only)
export const removeTimetableItem = async (req, res, next) => {
  try {
    const dayNumber = Number(req.params.dayNumber);
    const client = await Client.findById(req.params.id);
    if (!client) return res.status(404).json({ success: false, message: "Client not found." });

    const dayEntry = client.mealTimetable.find((d) => d.dayNumber === dayNumber);
    if (dayEntry) {
      dayEntry.items = dayEntry.items.filter((item) => item._id.toString() !== req.params.itemId);
    }
    await client.save();

    res.status(200).json({ success: true, client });
  } catch (err) {
    next(err);
  }
};

export const addExercise = async (req, res, next) => {
  try {
    const client = await Client.findById(req.params.id);
    if (!client) return res.status(404).json({ success: false, message: "Client not found." });

    const dayNumber = parseInt(req.params.day);
    const { text, reps, duration } = req.body;
    if (!text) return res.status(400).json({ success: false, message: "Exercise text is required." });

    let day = client.mealTimetable.find((d) => d.dayNumber === dayNumber);
    if (!day) {
      client.mealTimetable.push({ dayNumber, items: [], exercises: [] });
      day = client.mealTimetable.find((d) => d.dayNumber === dayNumber);
    }
    if (!day.exercises) day.exercises = [];

    day.exercises.push({ text, reps: reps || "", duration: duration || "" });
    await client.save();

    res.status(200).json({ success: true, client });
  } catch (err) {
    next(err);
  }
};

export const removeExercise = async (req, res, next) => {
  try {
    const client = await Client.findById(req.params.id);
    if (!client) return res.status(404).json({ success: false, message: "Client not found." });

    const dayNumber = parseInt(req.params.day);
    const exerciseId = req.params.exerciseId;

    const day = client.mealTimetable.find((d) => d.dayNumber === dayNumber);
    if (!day || !day.exercises) return res.status(404).json({ success: false, message: "Exercise not found." });

    day.exercises = day.exercises.filter((ex) => ex._id.toString() !== exerciseId);
    await client.save();

    res.status(200).json({ success: true, client });
  } catch (err) {
    next(err);
  }
};


export const archiveClient = async (req, res, next) => {
  try {
    const client = await Client.findByIdAndUpdate(req.params.id, { isArchived: true }, { new: true });
    if (!client) return res.status(404).json({ success: false, message: "Client not found." });
    await logAudit(req, "Archived client", "Client", client._id, client.fullName);
    res.status(200).json({ success: true, client });
  } catch (err) { next(err); }
};

export const restoreClient = async (req, res, next) => {
  try {
    const client = await Client.findByIdAndUpdate(req.params.id, { isArchived: false }, { new: true });
    if (!client) return res.status(404).json({ success: false, message: "Client not found." });
    await logAudit(req, "Restored archived client", "Client", client._id, client.fullName);
    res.status(200).json({ success: true, client });
  } catch (err) { next(err); }
};
