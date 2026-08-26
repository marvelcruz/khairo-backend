import Session from "../models/Session.js";
import Client from "../models/Client.js";
import User from "../models/User.js";
import { sendEmail } from "../utils/mailer.js";
import { logAudit } from "../utils/auditLogger.js";

const populateChain = (q) =>
  q.populate("client", "fullName email phone program status").populate("staff", "name").populate("decidedBy", "name").populate("confirmedBy", "name");

async function leastLoadedStaff() {
  try {
    const staff = await User.find({ roles: { $in: ["coach", "doctor"] }, isActive: true }).select("_id");
    if (!staff.length) return null;
    let best = null;
    let bestCount = Infinity;
    for (const s of staff) {
      const count = await Session.countDocuments({ staff: s._id, status: { $in: ["pending", "confirmed"] } });
      if (count < bestCount) { bestCount = count; best = s._id; }
    }
    return best;
  } catch {
    return null;
  }
}

export const listSessions = async (req, res, next) => {
  try {
    const archived = req.query.archived === "true";

    const filter = archived
      ? { archived: true }
      : { archived: { $ne: true } };

    const roles = req.user?.roles || [];

    const isOperational =
      roles.includes("admin") || roles.includes("staff");

    if (!isOperational && (roles.includes("coach") || roles.includes("doctor"))) {
      const clientOr = [];
      if (roles.includes("coach")) clientOr.push({ assignedCoach: req.user._id });
      if (roles.includes("doctor")) clientOr.push({ assignedDoctor: req.user._id });

      const assignedClientIds = clientOr.length
        ? await Client.find(clientOr.length === 1 ? clientOr[0] : { $or: clientOr }).distinct("_id")
        : [];

      filter.$or = [
        { staff: req.user._id },
        { decidedBy: req.user._id },
        { confirmedBy: req.user._id },
        { client: { $in: assignedClientIds } },
      ];
    }

    const sessions = await populateChain(
      Session.find(filter)
    ).sort({
      startsAt: archived ? -1 : 1,
    });
    const Transcript = (await import("../models/Transcript.js")).default;
    const ids = sessions.map((s) => s._id);
    const counts = await Transcript.aggregate([
      { $match: { session: { $in: ids } } },
      { $group: { _id: "$session", n: { $sum: 1 } } },
    ]);
    const countMap = {};
    counts.forEach((cc) => { countMap[String(cc._id)] = cc.n; });
    const withCounts = sessions.map((s) => {
      const obj = s.toObject();
      obj.transcriptCount = countMap[String(s._id)] || 0;
      return obj;
    });
    res.status(200).json({ success: true, sessions: withCounts });
  } catch (err) {
    next(err);
  }
};

export const createSession = async (req, res, next) => {
  try {
    const { clientId, staffId, sessionType, startsAt, durationMins, zoomLink, note, isTeam, title } = req.body;
    const effectiveType = sessionType || "training";

    if (!isTeam && !clientId) {
      return res.status(400).json({ success: false, message: "Client is required for client sessions." });
    }

    if (!startsAt) {
      return res.status(400).json({ success: false, message: "Date/time is required." });
    }

    const startTime = new Date(startsAt);

    if (Number.isNaN(startTime.getTime())) {
      return res.status(400).json({ success: false, message: "Invalid date/time." });
    }

    if (startTime.getTime() < Date.now()) {
      return res.status(400).json({ success: false, message: "Cannot book a session in the past." });
    }

    let selectedStaff = null;

    if (!isTeam) {
      const client = await Client.findById(clientId).select("reconciled isArchived");

      if (!client) {
        return res.status(404).json({ success: false, message: "Client not found." });
      }

      if (client.isArchived) {
        return res.status(409).json({ success: false, message: "Archived clients cannot receive new sessions." });
      }

      if (effectiveType !== "consultation" && !client.reconciled) {
        return res.status(409).json({
          success: false,
          message: "Client must complete reconciliation before training or review sessions.",
        });
      }

      if (staffId) {
        const professional = await User.findOne({
          _id: staffId,
          isActive: true,
          roles: { $in: ["coach", "doctor"] },
        }).select("_id");

        if (!professional) {
          return res.status(400).json({
            success: false,
            message: "Assigned professional must be an active coach or doctor.",
          });
        }

        selectedStaff = professional._id;
      } else {
        selectedStaff = await leastLoadedStaff();
      }
    }

    const endTime = new Date(startTime.getTime() + (durationMins || 60) * 60000);

    if (!isTeam) {
      const conflictClauses = [
        { client: clientId, startsAt: { $lt: endTime, $gte: startTime } },
      ];

      if (selectedStaff) {
        conflictClauses.push({
          staff: selectedStaff,
          startsAt: { $lt: endTime, $gte: startTime },
        });
      }

      const overlaps = await Session.findOne({
        archived: { $ne: true },
        status: { $in: ["pending", "confirmed"] },
        $or: conflictClauses,
      });

      if (overlaps) {
        return res.status(409).json({
          success: false,
          message: "Conflict: that time slot overlaps with an existing session.",
        });
      }
    }

    const session = await Session.create({
      client: isTeam ? null : clientId,
      isTeam: !!isTeam,
      title: title || "",
      staff: isTeam ? null : selectedStaff,
      sessionType: effectiveType,
      startsAt: startTime,
      durationMins: durationMins || 60,
      zoomLink: zoomLink || "",
      note: note || "",
      requestedBy: "staff",
      status: isTeam ? "confirmed" : "pending",
    });

    await logAudit(
      req,
      "Booked session",
      "Session",
      session._id,
      `${isTeam ? "Team: " + (title || "Team meeting") : effectiveType} · ${startTime.toLocaleString()}`
    );

    res.status(201).json({
      success: true,
      session: await populateChain(Session.findById(session._id)),
    });
  } catch (err) {
    next(err);
  }
};

export const assignStaff = async (req, res, next) => {
  try {
    const { staffId } = req.body;
    const session = await Session.findById(req.params.id);

    if (!session) {
      return res.status(404).json({ success: false, message: "Session not found." });
    }

    if (!session.isTeam && session.sessionType !== "consultation" && session.client) {
      const client = await Client.findById(session.client).select("reconciled");

      if (!client?.reconciled) {
        return res.status(409).json({
          success: false,
          message: "Client must complete reconciliation before training or review session actions.",
        });
      }
    }

    let professional = null;

    if (staffId) {
      professional = await User.findOne({
        _id: staffId,
        isActive: true,
        roles: { $in: ["coach", "doctor"] },
      }).select("_id name");

      if (!professional) {
        return res.status(400).json({
          success: false,
          message: "Assigned professional must be an active coach or doctor.",
        });
      }
    }

    session.staff = professional?._id || null;
    await session.save();

    await logAudit(
      req,
      "Assigned professional to session",
      "Session",
      session._id,
      professional?.name || "unassigned"
    );

    res.status(200).json({
      success: true,
      session: await populateChain(Session.findById(session._id)),
    });
  } catch (err) {
    next(err);
  }
};

export const setSessionStatus = async (req, res, next) => {
  try {
    const { status, zoomLink } = req.body;
    const allowed = ["confirmed", "declined", "completed", "cancelled"];
    if (!allowed.includes(status)) {
      return res.status(400).json({ success: false, message: "Invalid status." });
    }
    const session = await Session.findById(req.params.id);
    if (!session) {
      return res.status(404).json({ success: false, message: "Session not found." });
    }

    if (!session.isTeam && session.sessionType !== "consultation" && session.client) {
      const client = await Client.findById(session.client).select("reconciled");

      if (!client?.reconciled) {
        return res.status(409).json({
          success: false,
          message: "Client must complete reconciliation before training or review session actions.",
        });
      }
    }

    if (
      status === "confirmed" &&
      new Date(session.startsAt).getTime() < Date.now()
    ) {
      return res.status(409).json({
        success: false,
        message: "A session scheduled in the past cannot be confirmed.",
      });
    }

    const transitions = {
      pending: ["confirmed", "declined", "cancelled"],
      confirmed: ["completed", "cancelled"],
      completed: [],
      declined: [],
      cancelled: [],
    };

    if (!(transitions[session.status] || []).includes(status)) {
      return res.status(409).json({
        success: false,
        message: `Cannot move a ${session.status} session to ${status}.`,
      });
    }

    if (status === "confirmed" && !session.isTeam && !session.staff) {
      return res.status(409).json({
        success: false,
        message: "Assign a professional before confirming the session.",
      });
    }

    session.status = status;
    session.decidedBy = req.user._id;
    session.decidedAt = new Date();
    if (status === "confirmed") {
      session.confirmedBy = req.user._id;
      session.confirmedAt = new Date();
    }
    if (zoomLink) session.zoomLink = zoomLink;
    await session.save();
    await logAudit(req, `${status.charAt(0).toUpperCase() + status.slice(1)} session`, "Session", session._id, session.sessionType);

    // Auto-reminder: when confirmed, email the client with session details
    if (status === "confirmed" && session.client) {
      try {
        const client = await Client.findById(session.client);
        const staff = session.staff ? await User.findById(session.staff).select("name") : null;
        if (client && client.email) {
          const sessionDate = new Date(session.startsAt);
          const dateStr = sessionDate.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
          const timeStr = sessionDate.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
          
          const html = `<div style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;background:#0a0a0a;padding:32px;color:#f5f5f5;">
            <div style="max-width:520px;margin:0 auto;background:#171717;border:1px solid #262626;border-radius:8px;padding:32px;">
              <div style="display:flex;align-items:center;gap:10px;margin-bottom:24px;">
                <div style="width:36px;height:36px;background:#0d9488;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:700;color:white;">F</div>
                <span style="font-weight:600;letter-spacing:-0.02em;">FITLUNGE</span>
              </div>
              <p style="margin:0 0 16px;font-size:15px;">Hi ${client.fullName},</p>
              <p style="margin:0 0 24px;font-size:15px;line-height:1.5;color:#d4d4d4;">Your <strong style="color:white;">${session.sessionType}</strong> session is confirmed:</p>
              <div style="background:#1f1f1f;border:1px solid #2f2f2f;border-radius:6px;padding:20px;margin-bottom:24px;">
                <p style="margin:0 0 8px;font-size:13px;color:#a3a3a3;">Date</p>
                <p style="margin:0 0 16px;font-size:15px;font-weight:600;color:white;">${dateStr}</p>
                <p style="margin:0 0 8px;font-size:13px;color:#a3a3a3;">Time</p>
                <p style="margin:0 0 16px;font-size:15px;font-weight:600;color:white;">${timeStr}</p>
                ${staff ? `<p style="margin:0 0 8px;font-size:13px;color:#a3a3a3;">With</p><p style="margin:0 0 16px;font-size:15px;font-weight:600;color:white;">${staff.name}</p>` : ""}
                ${session.zoomLink ? `<p style="margin:0 0 8px;font-size:13px;color:#a3a3a3;">Join</p><a href="${session.zoomLink}" style="display:inline-block;background:#0d9488;color:white;text-decoration:none;padding:10px 20px;border-radius:999px;font-weight:600;font-size:14px;">Open Zoom →</a>` : ""}
              </div>
              ${session.note ? `<p style="margin:0 0 16px;font-size:13px;color:#a3a3a3;"><strong style="color:white;">Note:</strong> ${session.note}</p>` : ""}
              <p style="margin:0;font-size:12px;color:#737373;">We'll see you soon!</p>
            </div>
          </div>`;

          await sendEmail({
            to: client.email,
            subject: `Your ${session.sessionType} session is confirmed — Khairo Diet Clinic`,
            html,
            text: `Hi ${client.fullName},\n\nYour ${session.sessionType} session is confirmed:\n\nDate: ${dateStr}\nTime: ${timeStr}${staff ? `\nWith: ${staff.name}` : ""}${session.zoomLink ? `\nJoin: ${session.zoomLink}` : ""}\n\nWe'll see you soon!\n\n— Khairo Diet Clinic`
          });
          await logAudit(req, "Emailed session confirmation", "Client", client._id, client.fullName);
        }
      } catch (err) {
        console.error("Failed to send session confirmation email:", err);
      }
    }

    if (status === "completed" && session.client) {
      try {
        const client = await Client.findById(session.client);
        if (client) {
          client.lastReviewedAt = new Date();
          await client.save();
        }
      } catch {}
      try {
        const Remark = (await import("../models/Remark.js")).default;
        const populated = await populateChain(Session.findById(session._id));
        await Remark.create({
          entityType: "Client",
          entityId: session.client,
          text: `${session.sessionType} session with ${populated.staff?.name || "staff"} completed`,
          author: req.user._id,
          authorName: req.user.name,
        });
      } catch {}
    }

    res.status(200).json({ success: true, session: await populateChain(Session.findById(session._id)) });
  } catch (err) {
    next(err);
  }
};

export const archiveSession = async (req, res, next) => {
  try {
    const session = await Session.findById(req.params.id);
    if (!session) return res.status(404).json({ success: false, message: "Session not found." });

    if (session.status !== "completed") {
      return res.status(409).json({
        success: false,
        message: "Only completed sessions can be archived.",
      });
    }

    session.archived = true;
    await session.save();
    await logAudit(req, "Archived session", "Session", session._id, session.sessionType);
    res.status(200).json({ success: true });
  } catch (err) {
    next(err);
  }
};

export const requestSession = async (req, res, next) => {
  try {
    const { startsAt, sessionType, note } = req.body;
    const effectiveType = sessionType || "consultation";

    if (!startsAt) {
      return res.status(400).json({
        success: false,
        message: "A preferred date/time is required.",
      });
    }

    const startTime = new Date(startsAt);

    if (Number.isNaN(startTime.getTime())) {
      return res.status(400).json({
        success: false,
        message: "Invalid date/time.",
      });
    }

    if (startTime.getTime() < Date.now()) {
      return res.status(400).json({
        success: false,
        message: "Cannot request a session in the past.",
      });
    }

    if (effectiveType !== "consultation" && !req.client.reconciled) {
      return res.status(409).json({
        success: false,
        message: "Complete reconciliation before requesting training or review sessions.",
      });
    }

    const selectedStaff = await leastLoadedStaff();
    const endTime = new Date(startTime.getTime() + 30 * 60000);

    const conflictClauses = [
      {
        client: req.client._id,
        startsAt: { $lt: endTime, $gte: startTime },
      },
    ];

    if (selectedStaff) {
      conflictClauses.push({
        staff: selectedStaff,
        startsAt: { $lt: endTime, $gte: startTime },
      });
    }

    const conflict = await Session.findOne({
      archived: { $ne: true },
      status: { $in: ["pending", "confirmed"] },
      $or: conflictClauses,
    });

    if (conflict) {
      return res.status(409).json({
        success: false,
        message: "That time overlaps with an existing session.",
      });
    }

    const session = await Session.create({
      client: req.client._id,
      staff: selectedStaff,
      requestedBy: "client",
      sessionType: effectiveType,
      startsAt: startTime,
      note,
      status: "pending",
    });

    res.status(201).json({ success: true, session });
  } catch (err) {
    next(err);
  }
};

export const getMySessions = async (req, res, next) => {
  try {
    const sessions = await Session.find({ client: req.client._id }).sort({ startsAt: -1 });
    res.status(200).json({ success: true, sessions });
  } catch (err) {
    next(err);
  }
};


// POST /api/sessions/:id/reschedule (client portal) - self-service reschedule
export const rescheduleMySession = async (req, res, next) => {
  try {
    const { startsAt } = req.body;
    if (!startsAt) return res.status(400).json({ success: false, message: "New date/time required." });
    const session = await Session.findById(req.params.id);
    if (!session) return res.status(404).json({ success: false, message: "Session not found." });
    if (String(session.client) !== String(req.client._id)) return res.status(403).json({ success: false, message: "Not your session." });
    if (!["pending", "confirmed"].includes(session.status)) return res.status(400).json({ success: false, message: "Only upcoming sessions can be rescheduled." });

    if (session.sessionType !== "consultation" && !req.client.reconciled) {
      return res.status(409).json({
        success: false,
        message: "Complete reconciliation before rescheduling training or review sessions.",
      });
    }

    const newStart = new Date(startsAt);
    if (newStart.getTime() < Date.now()) return res.status(400).json({ success: false, message: "Cannot reschedule to the past." });
    const newEnd = new Date(newStart.getTime() + (session.durationMins || 60) * 60000);

    // Conflict detection (client + staff)
    const conflict = await Session.findOne({
      _id: { $ne: session._id },
      archived: { $ne: true },
      status: { $in: ["pending", "confirmed"] },
      $or: [
        { client: session.client, startsAt: { $lt: newEnd, $gte: newStart } },
        ...(session.staff ? [{ staff: session.staff, startsAt: { $lt: newEnd, $gte: newStart } }] : []),
      ],
    });
    if (conflict) return res.status(409).json({ success: false, message: "That slot is already taken. Please pick another time." });

    const oldDate = session.startsAt.toLocaleString();
    session.startsAt = newStart;
    session.status = "pending"; // require re-confirmation after reschedule
    session.rescheduledBy = "client";
    await session.save();
    await (await import("../utils/auditLogger.js")).logAudit({ user: null, userName: req.client.fullName || "Client" }, "Rescheduled own session", "Session", session._id, `From ${oldDate} to ${newStart.toLocaleString()}`);
    res.json({ success: true, session: await populateChain(Session.findById(session._id)) });
  } catch (err) { next(err); }
};
