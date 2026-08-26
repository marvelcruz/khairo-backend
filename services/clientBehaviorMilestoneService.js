import mongoose from "mongoose";
import Client from "../models/Client.js";
import ClientExperience from "../models/ClientExperience.js";
import ClientMessage from "../models/ClientMessage.js";
import CrmContact from "../models/CrmContact.js";
import CrmTag from "../models/CrmTag.js";
import Session from "../models/Session.js";
import { dispatchCrmTagChange } from "./crmTagWorkflowService.js";

const DEFINITIONS = {
  portal_activated: {
    name: "Portal Activated",
    description: "Permanent milestone showing that the client activated their KhairoDietClinic portal account.",
    automationRule: "milestone:portal_activated",
  },
  portal_login_recorded: {
    name: "Portal Login Recorded",
    description: "Permanent milestone showing that the client has signed in to the KhairoDietClinic portal.",
    automationRule: "milestone:portal_login_recorded",
  },
  weekly_checkin_started: {
    name: "Weekly Check-in Started",
    description: "Permanent milestone showing that the client has submitted at least one official weekly check-in.",
    automationRule: "milestone:weekly_checkin_started",
  },
  measurement_tracking_started: {
    name: "Measurement Tracking Started",
    description: "Permanent milestone showing that the client has recorded at least one body or wellbeing measurement entry.",
    automationRule: "milestone:measurement_tracking_started",
  },
  progress_photo_tracking_started: {
    name: "Progress Photo Tracking Started",
    description: "Permanent milestone showing that the client has uploaded at least one progress photo.",
    automationRule: "milestone:progress_photo_tracking_started",
  },
  client_messaging_started: {
    name: "Client Messaging Started",
    description: "Permanent milestone showing that the client has sent at least one portal message to the KhairoDietClinic team.",
    automationRule: "milestone:client_messaging_started",
  },
  appointment_requested: {
    name: "Appointment Requested",
    description: "Permanent milestone showing that the client has requested at least one appointment through the portal.",
    automationRule: "milestone:appointment_requested",
  },
  appointment_confirmed: {
    name: "Appointment Confirmed",
    description: "Permanent milestone showing that at least one client appointment has been confirmed.",
    automationRule: "milestone:appointment_confirmed",
  },
  appointment_completed: {
    name: "Appointment Completed",
    description: "Permanent milestone showing that the client has completed at least one appointment.",
    automationRule: "milestone:appointment_completed",
  },
};

async function ensureDefinitions() {
  await Promise.all(
    Object.entries(DEFINITIONS).map(([key, definition]) =>
      CrmTag.findOneAndUpdate(
        { key },
        {
          $setOnInsert: {
            key,
            name: definition.name,
            normalizedName: definition.name.trim().toLowerCase(),
            category: "behavior",
            description: definition.description,
            active: true,
          },
          $set: {
            automationManaged: true,
            automationRule: definition.automationRule,
          },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      )
    )
  );
}

function idSet(values = []) {
  return new Set(values.map((value) => String(value)));
}

async function progressPhotoClientIds(clientIds) {
  if (!mongoose.connection.db || !clientIds.length) return new Set();
  try {
    const values = await mongoose.connection.db
      .collection("clientProgressPhotos.files")
      .distinct("metadata.clientId", {
        "metadata.clientId": { $in: clientIds.map(String) },
      });
    return idSet(values);
  } catch {
    return new Set();
  }
}

export async function backfillClientBehaviorMilestones() {
  await ensureDefinitions();

  const clients = await Client.find({
    isArchived: { $ne: true },
    reconciled: true,
  })
    .select("_id portalActive portalLastLogin checkIns")
    .lean();

  if (!clients.length) {
    return { clients: 0, contactsChanged: 0, tagsAdded: 0 };
  }

  const ids = clients.map((client) => client._id);
  const [contacts, measurementIds, messageIds, requestedIds, confirmedIds, completedIds, photoIds] =
    await Promise.all([
      CrmContact.find({
        client: { $in: ids },
        isArchived: false,
      }),
      ClientExperience.find({
        client: { $in: ids },
        "measurements.0": { $exists: true },
      }).distinct("client"),
      ClientMessage.find({
        client: { $in: ids },
        senderType: "client",
      }).distinct("client"),
      Session.find({
        client: { $in: ids },
        requestedBy: "client",
      }).distinct("client"),
      Session.find({
        client: { $in: ids },
        status: { $in: ["confirmed", "completed"] },
      }).distinct("client"),
      Session.find({
        client: { $in: ids },
        status: "completed",
      }).distinct("client"),
      progressPhotoClientIds(ids),
    ]);

  const measurementSet = idSet(measurementIds);
  const messageSet = idSet(messageIds);
  const requestedSet = idSet(requestedIds);
  const confirmedSet = idSet(confirmedIds);
  const completedSet = idSet(completedIds);
  const contactByClient = new Map(
    contacts.map((contact) => [String(contact.client), contact])
  );

  let contactsChanged = 0;
  let tagsAdded = 0;

  for (const client of clients) {
    const clientId = String(client._id);
    const contact = contactByClient.get(clientId);
    if (!contact) continue;

    const desired = [];
    if (client.portalActive === true) desired.push("portal_activated");
    if (client.portalLastLogin) desired.push("portal_login_recorded");
    if (Array.isArray(client.checkIns) && client.checkIns.length > 0) {
      desired.push("weekly_checkin_started");
    }
    if (measurementSet.has(clientId)) desired.push("measurement_tracking_started");
    if (photoIds.has(clientId)) desired.push("progress_photo_tracking_started");
    if (messageSet.has(clientId)) desired.push("client_messaging_started");
    if (requestedSet.has(clientId)) desired.push("appointment_requested");
    if (confirmedSet.has(clientId)) desired.push("appointment_confirmed");
    if (completedSet.has(clientId)) desired.push("appointment_completed");

    const added = desired.filter((tag) => !(contact.tags || []).includes(tag));
    if (!added.length) continue;

    contact.tags = [...new Set([...(contact.tags || []), ...added])];
    contact.lastActivityAt = new Date();
    await contact.save();

    contactsChanged += 1;
    tagsAdded += added.length;

    for (const tag of added) {
      await dispatchCrmTagChange({
        contact,
        tag,
        change: "added",
        actorName: "System (behavior milestones)",
      });
    }
  }

  return {
    clients: clients.length,
    contactsChanged,
    tagsAdded,
  };
}
