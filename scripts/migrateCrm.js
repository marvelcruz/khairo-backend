import dotenv from "dotenv";
import mongoose from "mongoose";
import { connectDB } from "../config/db.js";
import Application from "../models/Application.js";
import Client from "../models/Client.js";
import User from "../models/User.js";
import CrmContact from "../models/CrmContact.js";
import CrmOpportunity from "../models/CrmOpportunity.js";
import { syncApplicationToCrm, syncClientToCrm } from "../services/crmService.js";

dotenv.config();

const apply = process.argv.includes("--apply");

async function main() {
  await connectDB();

  const [applications, clients, currentCrmContacts, currentCrmOpportunities, salesUsers] = await Promise.all([
    Application.find().sort({ createdAt: 1 }),
    Client.find().sort({ createdAt: 1 }),
    CrmContact.countDocuments(),
    CrmOpportunity.countDocuments(),
    User.find({ roles: "sales" }).select("name email permissions"),
  ]);

  const salesMissingAccess = salesUsers.filter((user) => {
    const permissions = user.permissions || [];
    return !permissions.includes("view_crm") || !permissions.includes("view_contact_info");
  });

  console.log("KHAIRO CRM MIGRATION");
  console.log(apply ? "MODE: APPLY" : "MODE: DRY RUN");
  console.log("");
  console.log("Applications:", applications.length);
  console.log("Clients:", clients.length);
  console.log("Existing CRM contacts:", currentCrmContacts);
  console.log("Existing CRM opportunities:", currentCrmOpportunities);
  console.log("Sales users needing CRM permissions:", salesMissingAccess.length);

  if (!apply) {
    console.log("");
    console.log("No data was changed.");
    console.log("Run again with --apply only after the CRM deployment has passed QA.");
    return;
  }

  let syncedApplications = 0;
  let syncedClients = 0;

  for (const application of applications) {
    await syncApplicationToCrm(application, { userName: "CRM migration" });
    syncedApplications += 1;
  }

  for (const client of clients) {
    const application =
      (client.fromApplication && (await Application.findById(client.fromApplication))) ||
      (client.email && (await Application.findOne({ email: client.email }).sort({ createdAt: -1 }))) ||
      null;

    if (client.reconciled) {
      await syncClientToCrm(client, application, { userName: "CRM migration" });
      syncedClients += 1;
      continue;
    }

    if (application) {
      const result = await syncApplicationToCrm(application, { userName: "CRM migration" });
      result.contact.client = client._id;
      await result.contact.save();
      result.opportunity.client = client._id;
      await result.opportunity.save();
    }
  }

  if (salesMissingAccess.length) {
    await User.updateMany(
      { _id: { $in: salesMissingAccess.map((user) => user._id) } },
      { $addToSet: { permissions: { $each: ["view_crm", "view_contact_info"] } } }
    );
  }

  const [contactsAfter, opportunitiesAfter] = await Promise.all([
    CrmContact.countDocuments(),
    CrmOpportunity.countDocuments(),
  ]);

  console.log("");
  console.log("Applications synchronized:", syncedApplications);
  console.log("Reconciled clients synchronized:", syncedClients);
  console.log("CRM contacts after:", contactsAfter);
  console.log("CRM opportunities after:", opportunitiesAfter);
  console.log("Sales permissions updated:", salesMissingAccess.length);
  console.log("CRM migration complete.");
}

main()
  .catch((error) => {
    console.error("CRM migration failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
