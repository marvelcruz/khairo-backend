import mongoose from "mongoose";
import TrialEvent from "../models/TrialEvent.js";
import Client from "../models/Client.js";
import Application from "../models/Application.js";
import { logAudit } from "../utils/auditLogger.js";

const normalizeEmail = (value = "") => String(value).trim().toLowerCase();
const clean = (value = "") => String(value).trim();

const registrationOpen = (event) =>
  event.isActive !== false &&
  new Date(event.date).getTime() > Date.now();

const registrationError = (code) => {
  const err = new Error(code);
  err.trialRegistrationCode = code;
  return err;
};

const registrationErrorResponse = (res, code) => {
  const responses = {
    EVENT_NOT_FOUND: [404, "Event not found."],
    EVENT_CLOSED: [409, "Registration for this trial event is closed."],
    EVENT_FULL: [409, "This trial event is full."],
    DUPLICATE: [409, "This email is already registered for the event."],
    ALREADY_ENROLLED: [409, "This person is already an enrolled Khairo Diet Clinic client."],
  };

  const [status, message] =
    responses[code] || [500, "Could not complete trial registration."];

  return res.status(status).json({
    success: false,
    message,
  });
};

const findCurrentApplication = async (email, dbSession = null) => {
  let query = Application.findOne({
    email,
    status: { $ne: "declined" },
  }).sort({ createdAt: -1 });

  if (dbSession) query = query.session(dbSession);

  return query;
};

const createTrialApplication = async ({
  name,
  email,
  phone,
  dbSession = null,
}) => {
  const payload = {
    fullName: clean(name),
    email: normalizeEmail(email),
    phone: clean(phone),
    programInterest: "not_sure",
    source: "trial_event",
  };

  if (dbSession) {
    const rows = await Application.create([payload], {
      session: dbSession,
    });
    return rows[0];
  }

  return Application.create(payload);
};

const ensureApplication = async ({
  name,
  email,
  phone,
  applicationId = null,
  dbSession = null,
}) => {
  if (applicationId) {
    let query = Application.findById(applicationId);

    if (dbSession) query = query.session(dbSession);

    const linked = await query;

    if (linked) return linked;
  }

  const normalized = normalizeEmail(email);

  const existing = await findCurrentApplication(
    normalized,
    dbSession
  );

  if (existing) return existing;

  return createTrialApplication({
    name,
    email: normalized,
    phone,
    dbSession,
  });
};

export const listPublicEvents = async (req, res, next) => {
  try {
    const events = await TrialEvent.find({})
      .sort({ date: -1 })
      .limit(20)
      .lean();

    const publicEvents = events.map((event) => {
      const registrations = event.registrations || [];

      return {
        _id: event._id,
        title: event.title,
        date: event.date,
        capacity: event.capacity,
        zoomLink: event.zoomLink || "",
        location: event.location || "",
        isActive: event.isActive,
        registrationOpen: registrationOpen(event),
        registrationCount: registrations.length,

        // Preserve the historical public-page .registrations.length
        // contract without exposing registrant personal information.
        registrations: registrations.map((reg) => ({
          _id: reg._id,
        })),
      };
    });

    res.json({
      success: true,
      events: publicEvents,
    });
  } catch (err) {
    next(err);
  }
};

export const listAdminEvents = async (req, res, next) => {
  try {
    const events = await TrialEvent.find({})
      .sort({ date: -1 })
      .limit(20)
      .lean();

    const registrations = events.flatMap(
      (event) => event.registrations || []
    );

    const emails = [
      ...new Set(
        registrations
          .map((reg) => normalizeEmail(reg.email))
          .filter(Boolean)
      ),
    ];

    const linkedApplicationIds = [
      ...new Set(
        registrations
          .map((reg) => reg.application)
          .filter(Boolean)
          .map(String)
      ),
    ];

    const applicationConditions = [];

    if (linkedApplicationIds.length) {
      applicationConditions.push({
        _id: { $in: linkedApplicationIds },
      });
    }

    if (emails.length) {
      applicationConditions.push({
        email: { $in: emails },
      });
    }

    const applications = applicationConditions.length
      ? await Application.find({
          $or: applicationConditions,
        })
          .select("_id email status createdAt")
          .sort({ createdAt: -1 })
          .lean()
      : [];

    const applicationsById = new Map();
    const latestApplicationByEmail = new Map();

    for (const app of applications) {
      applicationsById.set(String(app._id), app);

      const email = normalizeEmail(app.email);

      if (email && !latestApplicationByEmail.has(email)) {
        latestApplicationByEmail.set(email, app);
      }
    }

    const clientConditions = [];

    if (linkedApplicationIds.length) {
      clientConditions.push({
        fromApplication: { $in: linkedApplicationIds },
      });
    }

    if (emails.length) {
      clientConditions.push({
        email: { $in: emails },
      });
    }

    const enrolledClients = clientConditions.length
      ? await Client.find({
          reconciled: true,
          isArchived: { $ne: true },
          $or: clientConditions,
        })
          .select("email fromApplication")
          .lean()
      : [];

    const enrolledApplicationIds = new Set(
      enrolledClients
        .map((client) => client.fromApplication)
        .filter(Boolean)
        .map(String)
    );

    const enrolledEmails = new Set(
      enrolledClients
        .map((client) => normalizeEmail(client.email))
        .filter(Boolean)
    );

    const enriched = events.map((event) => ({
      ...event,
      registrationOpen: registrationOpen(event),
      registrations: (event.registrations || []).map((reg) => {
        const email = normalizeEmail(reg.email);

        const application =
          (reg.application &&
            applicationsById.get(String(reg.application))) ||
          latestApplicationByEmail.get(email) ||
          null;

        const enrolled =
          enrolledEmails.has(email) ||
          Boolean(
            application &&
              enrolledApplicationIds.has(String(application._id))
          );

        return {
          ...reg,
          applicationId: application?._id || reg.application || null,
          applicationStatus: application?.status || null,
          enrolled,
        };
      }),
    }));

    res.json({
      success: true,
      events: enriched,
    });
  } catch (err) {
    next(err);
  }
};

export const createEvent = async (req, res, next) => {
  try {
    const {
      title,
      date,
      capacity,
      zoomLink,
      location,
    } = req.body;

    const eventDate = new Date(date);
    const numericCapacity = Number(capacity);

    if (
      !date ||
      Number.isNaN(eventDate.getTime())
    ) {
      return res.status(400).json({
        success: false,
        message: "A valid trial date and time is required.",
      });
    }

    if (eventDate.getTime() <= Date.now()) {
      return res.status(400).json({
        success: false,
        message: "A trial event must be scheduled in the future.",
      });
    }

    if (
      !Number.isInteger(numericCapacity) ||
      numericCapacity < 1 ||
      numericCapacity > 500
    ) {
      return res.status(400).json({
        success: false,
        message: "Capacity must be a whole number between 1 and 500.",
      });
    }

    const cleanTitle = clean(title) || "Free Trial Day";

    const event = await TrialEvent.create({
      title: cleanTitle,
      date: eventDate,
      capacity: numericCapacity,
      zoomLink: clean(zoomLink),
      location: clean(location),
      isActive: true,
    });

    await logAudit(
      req,
      "Created trial event",
      "TrialEvent",
      event._id,
      `${cleanTitle} · ${eventDate.toLocaleString()}`
    );

    res.status(201).json({
      success: true,
      event,
    });
  } catch (err) {
    next(err);
  }
};

export const registerForEvent = async (req, res, next) => {
  const dbSession = await mongoose.startSession();

  try {
    const { eventId } = req.params;

    const name = clean(req.body.name);
    const email = normalizeEmail(req.body.email);
    const phone = clean(req.body.phone);

    if (!name || !email || !phone) {
      return res.status(400).json({
        success: false,
        message: "Name, email and phone are required.",
      });
    }

    if (
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    ) {
      return res.status(400).json({
        success: false,
        message: "Enter a valid email address.",
      });
    }

    let application = null;
    let registration = null;

    await dbSession.withTransaction(async () => {
      const event = await TrialEvent.findById(eventId)
        .session(dbSession);

      if (!event) {
        throw registrationError("EVENT_NOT_FOUND");
      }

      if (!registrationOpen(event)) {
        throw registrationError("EVENT_CLOSED");
      }

      if (
        event.registrations.length >=
        Number(event.capacity)
      ) {
        throw registrationError("EVENT_FULL");
      }

      const duplicate = event.registrations.some(
        (reg) =>
          normalizeEmail(reg.email) === email
      );

      if (duplicate) {
        throw registrationError("DUPLICATE");
      }

      const enrolledClient = await Client.findOne({
        email,
        reconciled: true,
        isArchived: { $ne: true },
      })
        .select("_id")
        .session(dbSession);

      if (enrolledClient) {
        throw registrationError("ALREADY_ENROLLED");
      }

      application = await ensureApplication({
        name,
        email,
        phone,
        dbSession,
      });

      event.registrations.push({
        name,
        email,
        phone,
        application: application._id,
      });

      await event.save({
        session: dbSession,
      });

      registration =
        event.registrations[
          event.registrations.length - 1
        ];
    });

    res.json({
      success: true,
      message:
        "Registered. Your details are now in the Khairo Diet Clinic requests pipeline.",
    });
  } catch (err) {
    if (err?.trialRegistrationCode) {
      return registrationErrorResponse(
        res,
        err.trialRegistrationCode
      );
    }

    next(err);
  } finally {
    await dbSession.endSession();
  }
};

export const markAttended = async (req, res, next) => {
  try {
    const { eventId, regId } = req.params;

    const event = await TrialEvent.findById(eventId);

    if (!event) {
      return res.status(404).json({
        success: false,
        message: "Event not found.",
      });
    }

    const reg = event.registrations.id(regId);

    if (!reg) {
      return res.status(404).json({
        success: false,
        message: "Registration not found.",
      });
    }

    if (
      new Date(event.date).getTime() > Date.now()
    ) {
      return res.status(409).json({
        success: false,
        message:
          "Attendance cannot be recorded before the trial event begins.",
      });
    }

    const application = await ensureApplication({
      name: reg.name,
      email: reg.email,
      phone: reg.phone,
      applicationId: reg.application,
    });

    reg.application = application._id;

    const alreadyAttended = reg.attended === true;

    reg.attended = true;

    await event.save();

    if (!alreadyAttended) {
      await logAudit(
        req,
        "Marked trial attended",
        "TrialEvent",
        event._id,
        reg.name
      );
    }

    const first =
      clean(reg.name).split(/\s+/)[0] || "there";

    const phone = clean(reg.phone).replace(/\D/g, "");

    const pricingUrl =
      (process.env.FRONTEND_URL ||
        "https://khairo-frontend-kappa.vercel.app") +
      "/pricing";

    const text = encodeURIComponent(
      `Hi ${first}! Thanks for joining our Khairo Diet Clinic trial session. Your details are already with our team and we'll follow up with the next enrollment step. You can review the Khairo Diet Clinic programs here: ${pricingUrl}`
    );

    const waLink = phone
      ? `https://wa.me/${phone}?text=${text}`
      : null;

    res.json({
      success: true,
      waLink,
      alreadyAttended,
      reg,
      applicationId: application._id,
    });
  } catch (err) {
    next(err);
  }
};

export const markConverted = async (req, res) => {
  res.status(409).json({
    success: false,
    message:
      "Trial enrollment is confirmed only after the normal payment and reconciliation workflow. Continue this prospect from Requests.",
  });
};
