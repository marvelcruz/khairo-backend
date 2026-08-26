import mongoose from "mongoose";
import dotenv from "dotenv";
import { connectDB } from "../config/db.js";
import WorkflowDefinition from "../models/WorkflowDefinition.js";

dotenv.config();
await connectDB();

const templates = [
  {
    name: "New Application Notification to Admin",
    templateCategory: "Applications",
    trigger: { type: "application_submitted", config: {} },
    actions: [
      {
        type: "notify_staff",
        config: {
          userId: "",
          subject: "New Khairo Diet Clinic application received",
          body: "{{application.name}} submitted a new application. Review it in Applications.",
        },
      },
    ],
  },
  {
    name: "Portal Signup Welcome Task",
    templateCategory: "CRM",
    trigger: { type: "crm_lead_created", config: {} },
    actions: [
      {
        type: "create_task",
        config: {
          subject: "Welcome new portal signup",
          body: "Welcome {{contact.name}} and help them choose the right Khairo Diet Clinic program.",
          dueInDays: 1,
          hour: 10,
        },
      },
    ],
  },
  {
    name: "Payment Success Notification to Admin",
    templateCategory: "Revenue",
    trigger: { type: "payment_success", config: {} },
    actions: [
      {
        type: "notify_staff",
        config: {
          userId: "",
          subject: "Payment received",
          body: "{{client.name}} completed a payment. Confirm onboarding and next steps.",
        },
      },
    ],
  },
  {
    name: "Appointment Completed Follow-up",
    templateCategory: "Appointments",
    trigger: { type: "appointment_completed", config: {} },
    actions: [
      {
        type: "create_task",
        config: {
          subject: "Follow up after completed appointment",
          body: "Review notes and schedule the next Khairo Diet Clinic step for {{contact.name}}.",
          dueInDays: 1,
          hour: 10,
        },
      },
    ],
  },
  {
    name: "Client Activation Notification to Admin",
    templateCategory: "Client Success",
    trigger: { type: "client_activated", config: {} },
    actions: [
      {
        type: "notify_staff",
        config: {
          userId: "",
          subject: "Client activated",
          body: "{{client.name}} is now active. Ensure onboarding is completed.",
        },
      },
    ],
  },
  {
    name: "Lapsed Client Follow-up",
    templateCategory: "Client Success",
    trigger: { type: "client_status_changed", config: {} },
    actions: [
      {
        type: "create_task",
        config: {
          subject: "Follow up with lapsed client",
          body: "Contact {{client.name}} after their status changed. Offer support or win-back if appropriate.",
          dueInDays: 1,
          hour: 10,
        },
      },
    ],
  },
];

let created = 0;

for (const template of templates) {
  const existing = await WorkflowDefinition.findOne({
    name: template.name,
    isTemplate: true,
  });

  if (existing) continue;

  await WorkflowDefinition.create({
    ...template,
    description: `Editable template for ${template.name}.`,
    status: "draft",
    isTemplate: true,
    mode: "live",
  });

  created += 1;
  console.log(`Created template: ${template.name}`);
}

console.log(`Done. New templates created: ${created}`);
await mongoose.disconnect();
process.exit(0);
