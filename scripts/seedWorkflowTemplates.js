import mongoose from "mongoose";
import dotenv from "dotenv";
import { connectDB } from "../config/db.js";
import WorkflowDefinition from "../models/WorkflowDefinition.js";

dotenv.config();
await connectDB();

const templates = [
  {
    name: "New Lead Follow-up",
    templateCategory: "CRM",
    trigger: { type: "crm_lead_created", config: {} },
    actions: [
      {
        type: "create_task",
        config: {
          subject: "Follow up new lead",
          body: "Reach out to {{contact.name}} and confirm next steps.",
          dueInDays: 1,
          hour: 10,
        },
      },
    ],
  },
  {
    name: "New Application Follow-up",
    templateCategory: "Applications",
    trigger: { type: "application_submitted", config: {} },
    actions: [
      {
        type: "create_task",
        config: {
          subject: "Review new application",
          body: "Review {{application.name}} application and decide next action.",
          dueInDays: 1,
          hour: 10,
        },
      },
    ],
  },
  {
    name: "Qualification Review Task",
    templateCategory: "CRM",
    trigger: {
      type: "crm_stage_changed",
      config: { toStage: "qualification" },
    },
    actions: [
      {
        type: "create_task",
        config: {
          subject: "Review qualification",
          body: "Review {{contact.name}} qualification information.",
          dueInDays: 1,
          hour: 10,
        },
      },
    ],
  },
  {
    name: "Consultation Reminder Email",
    templateCategory: "Appointments",
    trigger: { type: "appointment_booked", config: {} },
    actions: [
      {
        type: "send_email",
        config: {
          subject: "Your KhairoDietClinic consultation is booked",
          body: "Hi {{contact.name}}, your consultation is confirmed. We'll remind you closer to the appointment.",
        },
      },
    ],
  },
  {
    name: "No-show Follow-up",
    templateCategory: "Appointments",
    trigger: { type: "appointment_no_show", config: {} },
    actions: [
      {
        type: "create_task",
        config: {
          subject: "Follow up no-show",
          body: "Contact {{contact.name}} after missing their appointment.",
          dueInDays: 1,
          hour: 10,
        },
      },
    ],
  },
  {
    name: "Payment Success Follow-up",
    templateCategory: "Revenue",
    trigger: { type: "payment_success", config: {} },
    actions: [
      {
        type: "create_task",
        config: {
          subject: "Confirm payment and onboarding",
          body: "Confirm payment for {{client.name}} and prepare onboarding.",
          dueInDays: 1,
          hour: 10,
        },
      },
    ],
  },
  {
    name: "Client Activation Onboarding",
    templateCategory: "Client Success",
    trigger: { type: "client_activated", config: {} },
    actions: [
      {
        type: "create_task",
        config: {
          subject: "Complete client onboarding",
          body: "Help {{client.name}} complete onboarding steps and portal activation.",
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
