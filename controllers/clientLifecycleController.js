import Client from "../models/Client.js";
import Subscription from "../models/Subscription.js";
import CrmContact from "../models/CrmContact.js";
import CrmOpportunity from "../models/CrmOpportunity.js";
import { addCrmActivity } from "../services/crmService.js";
import { syncClientLifecycleTags } from "../services/clientLifecycleTagService.js";
import { dispatchWorkflowEvent } from "../services/workflowService.js";
import { logAudit } from "../utils/auditLogger.js";

const ALLOWED_TRANSITIONS = {
  active: new Set(["paused", "completed", "cancelled"]),
  paused: new Set(["active", "completed", "cancelled"]),
  completed: new Set(),
  cancelled: new Set(),
};

function cleanReason(value) {
  return String(value || "").trim().slice(0, 1000);
}

export const updateClientLifecycle = async (req, res, next) => {
  try {
    const client = await Client.findById(req.params.id);
    if (!client || client.isArchived) {
      return res.status(404).json({ success: false, message: "Client not found." });
    }

    const targetStatus = String(req.body?.status || "").trim().toLowerCase();
    const reason = cleanReason(req.body?.reason);

    if (!Object.prototype.hasOwnProperty.call(ALLOWED_TRANSITIONS, targetStatus)) {
      return res.status(400).json({
        success: false,
        message: "Choose active, paused, completed, or cancelled.",
      });
    }

    const previousStatus = client.status;
    if (previousStatus === targetStatus) {
      return res.status(200).json({ success: true, changed: false, client });
    }

    if (!ALLOWED_TRANSITIONS[previousStatus]?.has(targetStatus)) {
      return res.status(409).json({
        success: false,
        message:
          previousStatus === "completed" || previousStatus === "cancelled"
            ? "Completed or cancelled clients cannot be reactivated through a status edit. Use the renewal/reactivation workflow instead."
            : `Client cannot move from ${previousStatus} to ${targetStatus}.`,
      });
    }

    if (targetStatus === "cancelled" && !reason) {
      return res.status(400).json({
        success: false,
        message: "A cancellation reason is required.",
      });
    }

    client.status = targetStatus;
    await client.save();

    if (targetStatus === "paused") {
      await Subscription.updateMany(
        { client: client._id, status: { $in: ["active", "grace_period"] } },
        { $set: { status: "paused" } }
      );
    } else if (targetStatus === "active") {
      await Subscription.updateMany(
        { client: client._id, status: "paused" },
        { $set: { status: "active" } }
      );
    } else if (targetStatus === "completed" || targetStatus === "cancelled") {
      await Subscription.updateMany(
        {
          client: client._id,
          status: { $in: ["pending", "active", "grace_period", "paused"] },
        },
        {
          $set: {
            status: targetStatus === "cancelled" ? "cancelled" : "expired",
          },
        }
      );
    }

    await syncClientLifecycleTags(client, {
      actorUserId: req.user?._id,
    });

    const contact = await CrmContact.findOne({
      client: client._id,
      isArchived: false,
    });

    let opportunity = null;
    if (contact) {
      contact.lifecycleStage = ["completed", "cancelled"].includes(targetStatus)
        ? "former_client"
        : "client";
      contact.updatedBy = req.user?._id;
      contact.lastActivityAt = new Date();
      await contact.save();

      opportunity = await CrmOpportunity.findOne({ contact: contact._id }).sort({
        updatedAt: -1,
      });

      await addCrmActivity({
        contact,
        opportunity,
        type: "system",
        subject: "Client lifecycle changed",
        body: [
          `${client.fullName} moved from ${previousStatus} to ${targetStatus}.`,
          reason ? `Reason: ${reason}` : "",
        ]
          .filter(Boolean)
          .join(" "),
        createdBy: req.user?._id,
        metadata: {
          event: "client_status_changed",
          clientId: String(client._id),
          fromStatus: previousStatus,
          toStatus: targetStatus,
          reason,
        },
      });
    }

    await logAudit(
      req,
      "Changed client lifecycle status",
      "Client",
      String(client._id),
      `${client.fullName}: ${previousStatus} → ${targetStatus}${reason ? ` · ${reason}` : ""}`
    );

    dispatchWorkflowEvent({
      type: "client_status_changed",
      eventKey: `client_status_changed:${client._id}:${Date.now()}`,
      clientId: client._id,
      contactId: contact?._id,
      opportunityId: opportunity?._id,
      actorUserId: req.user?._id,
      actorName: req.user?.name || "Staff",
      data: {
        clientName: client.fullName,
        fromStatus: previousStatus,
        toStatus: targetStatus,
        reason,
        programInterest: client.program,
      },
    }).catch((error) =>
      console.error("Client lifecycle workflow trigger failed:", error?.message || error)
    );

    return res.status(200).json({
      success: true,
      changed: true,
      previousStatus,
      status: targetStatus,
      client,
    });
  } catch (error) {
    next(error);
  }
};
