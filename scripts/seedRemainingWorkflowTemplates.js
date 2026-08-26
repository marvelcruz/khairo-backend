import mongoose from "mongoose";
import dotenv from "dotenv";
import { connectDB } from "../config/db.js";
import WorkflowDefinition from "../models/WorkflowDefinition.js";

dotenv.config();
await connectDB();

const templates = [
  {
    name: "Regional Team Prospect Follow-up",
    templateCategory: "CRM",
    trigger: { type: "crm_lead_created", config: { source: "regional_team" } },
    actions: [
      {
        type: "create_task",
        config: {
          subject: "Follow up regional team prospect",
          body: "Contact {{contact.name}} from the regional team prospect list.",
          dueInDays: 1,
          hour: 10,
        },
      },
    ],
  },
  {
    name: "3-Month Review Task",
    templateCategory: "Client Success",
    trigger: { type: "client_activated", config: {} },
    actions: [
      { type: "wait", config: { durationMinutes: 129600 } },
      {
        type: "create_task",
        config: {
          subject: "3-month review due",
          body: "Complete the 3-month review for {{client.name}}.",
          dueInDays: 1,
          hour: 10,
        },
      },
    ],
  },
  {
    name: "6-Month Review Task",
    templateCategory: "Client Success",
    trigger: { type: "client_activated", config: {} },
    actions: [
      { type: "wait", config: { durationMinutes: 259200 } },
      {
        type: "create_task",
        config: {
          subject: "6-month review due",
          body: "Complete the 6-month review for {{client.name}}.",
          dueInDays: 1,
          hour: 10,
        },
      },
    ],
  },
  {
    name: "9-Month Review Task",
    templateCategory: "Client Success",
    trigger: { type: "client_activated", config: {} },
    actions: [
      { type: "wait", config: { durationMinutes: 388800 } },
      {
        type: "create_task",
        config: {
          subject: "9-month review due",
          body: "Complete the 9-month review for {{client.name}}.",
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
