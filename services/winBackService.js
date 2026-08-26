import Client from "../models/Client.js";
import CrmActivity from "../models/CrmActivity.js";
import CrmContact from "../models/CrmContact.js";
import BusinessSettings from "../models/BusinessSettings.js";
import { isEmailConfigured, sendEmail } from "../utils/mailer.js";
import { addCrmActivity } from "./crmService.js";

const DAY = 24 * 60 * 60 * 1000;

function buildOfferText(settings) {
  const type = settings.winBackOfferType || "percentage";
  const value = Number(settings.winBackOfferValue || 0);

  if (type === "percentage") {
    return `${value}% off your next program`;
  }

  return `₦${value.toLocaleString()} off your next program`;
}

async function sendWinBackOffer(client, settings) {
  const subject = "Your Khairo Diet Clinic win-back offer";
  const offerText = buildOfferText(settings);
  const message = settings.winBackMessage || "We miss you!";
  const text = `Hi ${client.fullName},\n\n${message}\n\n${offerText}.\n\nIf you have any questions, just reply and we'll help.\n\n- Khairo Diet Clinic`;
  const html = `<p>Hi ${client.fullName},</p><p>${message}</p><p><strong>${offerText}.</strong></p><p>If you have any questions, just reply and we'll help.</p><p>- Khairo Diet Clinic</p>`;

  let emailStatus = "skipped";

  if (client.email && isEmailConfigured()) {
    try {
      await sendEmail({
        to: client.email,
        subject,
        text,
        html,
      });
      emailStatus = "delivered";
    } catch (error) {
      emailStatus = "failed";
      console.error("Win-back email failed:", error?.message || error);
    }
  }

  return emailStatus;
}

export async function runWinBackOffers() {
  const settingsRecord = await BusinessSettings.findOne({ key: "business" });

  if (!settingsRecord?.growth?.winBackEnabled) {
    return { skipped: true, reason: "win_back_disabled" };
  }

  const growth = settingsRecord.growth;
  const thresholdDays = Number(growth.winBackThresholdDays || 30);
  const thresholdDate = new Date(Date.now() - thresholdDays * DAY);

  const clients = await Client.find({
    isArchived: false,
    status: { $in: ["paused", "completed", "cancelled"] },
    $or: [
      { programEndsAt: { $lte: thresholdDate } },
      { portalLastLogin: { $lte: thresholdDate } },
      { updatedAt: { $lte: thresholdDate } },
    ],
  })
    .select("fullName email phone program status programEndsAt portalLastLogin updatedAt assignedCoach")
    .limit(100)
    .lean();

  const result = {
    scanned: clients.length,
    sent: 0,
    skipped: 0,
    failed: 0,
  };

  for (const client of clients) {
    const contact = await CrmContact.findOne({
      client: client._id,
      isArchived: false,
    }).lean();

    const existing = await CrmActivity.exists({
      ...(contact ? { contact: contact._id } : {}),
      "metadata.event": "win_back_offer_sent",
      "metadata.clientId": String(client._id),
    });

    if (existing) {
      result.skipped += 1;
      continue;
    }

    const emailStatus = await sendWinBackOffer(client, growth);

    if (contact) {
      await addCrmActivity({
        contact,
        opportunity: null,
        type: "system",
        subject: "Win-back offer sent",
        body: `${client.fullName} was sent a win-back offer. Email: ${emailStatus}.`,
        createdBy: null,
        metadata: {
          event: "win_back_offer_sent",
          clientId: String(client._id),
          emailStatus,
          thresholdDays,
          offerType: growth.winBackOfferType,
          offerValue: growth.winBackOfferValue,
        },
      });
    }

    if (emailStatus === "delivered") result.sent += 1;
    else if (emailStatus === "failed") result.failed += 1;
    else result.skipped += 1;
  }

  return result;
}
