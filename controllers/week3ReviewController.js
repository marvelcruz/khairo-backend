import Client from "../models/Client.js";
import CrmActivity from "../models/CrmActivity.js";
import CrmContact from "../models/CrmContact.js";
import CrmOpportunity from "../models/CrmOpportunity.js";
import { addCrmActivity } from "../services/crmService.js";
import { logAudit } from "../utils/auditLogger.js";

const DAY = 24 * 60 * 60 * 1000;
const OUTCOMES = new Set(["on_track", "needs_support", "escalate"]);

function startAt(client) {
  return client.programStartedAt || client.startDate;
}

function dueAt(client) {
  const start = startAt(client);
  return start ? new Date(new Date(start).getTime() + 21 * DAY) : null;
}

export const getWeek3ReviewQueue = async (req, res, next) => {
  try {
    const cutoff = new Date(Date.now() - 21 * DAY);
    const clients = await Client.find({
      isArchived: false,
      status: "active",
      accountStage: "active",
      "week3Review.completed": { $ne: true },
      $or: [
        { programStartedAt: { $lte: cutoff } },
        { programStartedAt: { $exists: false }, startDate: { $lte: cutoff } },
        { programStartedAt: null, startDate: { $lte: cutoff } },
      ],
    })
      .select("fullName email phone program startDate programStartedAt assignedCoach week3Review")
      .populate("assignedCoach", "name roles")
      .sort({ programStartedAt: 1, startDate: 1 })
      .limit(250)
      .lean();

    const now = Date.now();
    const items = clients.map((client) => {
      const due = dueAt(client);
      const start = startAt(client);
      return {
        clientId: String(client._id),
        fullName: client.fullName,
        email: client.email,
        phone: client.phone,
        program: client.program,
        assignedCoach: client.assignedCoach || null,
        startAt: start,
        dueAt: due,
        daysActive: start ? Math.max(0, Math.floor((now - new Date(start).getTime()) / DAY)) : 0,
        overdueDays: due ? Math.max(0, Math.floor((now - due.getTime()) / DAY)) : 0,
      };
    });

    res.status(200).json({ success: true, count: items.length, items });
  } catch (error) {
    next(error);
  }
};

export const completeWeek3Review = async (req, res, next) => {
  try {
    const client = await Client.findById(req.params.id);
    if (!client || client.isArchived) {
      return res.status(404).json({ success: false, message: "Client not found." });
    }

    const due = dueAt(client);
    if (!due || due.getTime() > Date.now()) {
      return res.status(409).json({ success: false, message: "Week 3 review is not due yet." });
    }

    const outcome = String(req.body?.outcome || "").trim().toLowerCase();
    if (!OUTCOMES.has(outcome)) {
      return res.status(400).json({
        success: false,
        message: "Choose On Track, Needs Support, or Escalate.",
      });
    }

    const notes = String(req.body?.notes || "").trim().slice(0, 3000);
    const now = new Date();

    client.week3Review = {
      ...(client.week3Review?.toObject?.() || client.week3Review || {}),
      completed: true,
      outcome,
      notes,
      completedAt: now,
      completedBy: req.user._id,
      taskCreatedAt: client.week3Review?.taskCreatedAt,
    };
    await client.save();

    const contact = await CrmContact.findOne({ client: client._id, isArchived: false });
    let escalationTask = null;
    let supportTask = null;

    if (contact) {
      const opportunity = await CrmOpportunity.findOne({ contact: contact._id }).sort({ updatedAt: -1 });

      await CrmActivity.updateMany(
        {
          contact: contact._id,
          type: "task",
          completedAt: { $exists: false },
          "metadata.event": { $in: ["week3_review_due", "week3_review_coach_reminder"] },
          "metadata.clientId": String(client._id),
        },
        { $set: { completedAt: now } }
      );

      await addCrmActivity({
        contact,
        opportunity,
        type: "system",
        subject: "Week 3 review completed",
        body: `Week 3 review outcome: ${outcome.replaceAll("_", " ")}.${notes ? ` Notes: ${notes}` : ""}`,
        createdBy: req.user._id,
        metadata: {
          event: "week3_review_completed",
          clientId: String(client._id),
          outcome,
        },
      });

      if (outcome === "escalate") {
        escalationTask = await addCrmActivity({
          contact,
          opportunity,
          type: "task",
          subject: "Week 3 review escalation",
          body: `Review ${client.fullName}'s Week 3 escalation.${notes ? ` Context: ${notes}` : ""}`,
          dueAt: now,
          assignedTo: client.assignedCoach || contact.assignedTo,
          createdBy: req.user._id,
          metadata: {
            event: "week3_review_escalation",
            clientId: String(client._id),
          },
        });
      }

      if (outcome === "needs_support") {
        supportTask = await addCrmActivity({
          contact,
          opportunity,
          type: "task",
          subject: "Week 3 review needs support follow-up",
          body: `Follow up on ${client.fullName}'s Week 3 support needs.${notes ? ` Context: ${notes}` : ""}`,
          dueAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
          assignedTo: client.assignedCoach || contact.assignedTo,
          createdBy: req.user._id,
          metadata: {
            event: "week3_review_needs_support_follow_up",
            clientId: String(client._id),
          },
        });
      }
    }

    await logAudit(
      req,
      "Completed Week 3 review",
      "Client",
      client._id.toString(),
      `${client.fullName}: ${outcome}`
    );

    res.status(200).json({
      success: true,
      week3Review: client.week3Review,
      escalationTask,
      supportTask,
    });
  } catch (error) {
    next(error);
  }
};
