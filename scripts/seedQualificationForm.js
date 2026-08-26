import "dotenv/config";

import mongoose from "mongoose";
import { connectDB } from "../config/db.js";
import FormDefinition from "../models/FormDefinition.js";
import WorkflowDefinition from "../models/WorkflowDefinition.js";

await connectDB();

try {
  const formConfig = {
    name: "KhairoDietClinic Qualification Form",
    slug: "khairo-qualification",
    description:
      "Tell us a little about yourself and what you would like KhairoDietClinic to help you achieve. This should take about 2 minutes.",
    status: "published",
    visibility: "public",
    targetEntityType: "crm_contact",
    publicAction: "create_crm_lead",
    submitLabel: "Submit qualification",
    confirmationTitle: "Thank you",
    confirmationMessage:
      "We have received your information and will contact you about the next step.",
    elements: [
      {
        kind: "field",
        source: "standard",
        standardKey: "firstName",
        label: "First name",
        required: true,
      },
      {
        kind: "field",
        source: "standard",
        standardKey: "lastName",
        label: "Last name",
        required: true,
      },
      {
        kind: "field",
        source: "standard",
        standardKey: "email",
        label: "Email",
        required: true,
      },
      {
        kind: "field",
        source: "standard",
        standardKey: "phone",
        label: "Phone",
        required: true,
      },
      {
        kind: "field",
        source: "standard",
        standardKey: "programInterest",
        label: "Which KhairoDietClinic programme are you interested in?",
      },
      {
        kind: "field",
        source: "standard",
        standardKey: "goals",
        label: "What would you most like KhairoDietClinic to help you achieve?",
        required: true,
      },
      {
        kind: "field",
        source: "standard",
        standardKey: "healthNotes",
        label:
          "Is there anything about your health, medications, or medical history that our team should know before discussing the most appropriate programme with you?",
        helpText: "Detailed medical review happens separately.",
      },
      {
        kind: "field",
        source: "standard",
        standardKey: "startTimeline",
        label: "When would you ideally like to get started?",
        required: true,
      },
      {
        kind: "field",
        source: "standard",
        standardKey: "readyToSpeak",
        label:
          "Are you ready to speak with a KhairoDietClinic team member about the next step?",
        required: true,
      },
    ],
  };

  let form = await FormDefinition.findOne({ slug: formConfig.slug });

  if (form) {
    Object.assign(form, formConfig);
    if (!form.publishedAt) form.publishedAt = new Date();
    await form.save();
    console.log("FORM UPDATED:", form._id.toString());
  } else {
    form = await FormDefinition.create({
      ...formConfig,
      publishedAt: new Date(),
    });
    console.log("FORM CREATED:", form._id.toString());
  }

  const workflowConfig = {
    description:
      "Moves new qualification-form leads into Qualification and creates the staff review follow-up.",
    status: "active",
    trigger: {
      type: "form_submitted",
      config: {
        formId: form._id,
        allowedCurrentStages: [
          "new",
          "qualification",
          "nurture",
          "lost",
        ],
      },
    },
    actions: [
      {
        type: "set_stage",
        config: { stage: "qualification" },
      },
      {
        type: "create_task",
        config: {
          subject: "Review qualification",
          body: "Review {{contact.name}} qualification form.",
          dueInDays: 1,
          hour: 10,
        },
      },
      {
        type: "set_follow_up",
        config: {
          daysFromNow: 1,
          hour: 10,
        },
      },
    ],
  };

  let workflow = await WorkflowDefinition.findOne({
    name: "Qualification Form Submitted",
  });

  if (workflow) {
    workflow.description = workflowConfig.description;
    workflow.status = workflowConfig.status;
    workflow.trigger = workflowConfig.trigger;
    workflow.actions = workflowConfig.actions;
    if (!workflow.activatedAt) workflow.activatedAt = new Date();
    await workflow.save();
    console.log("WORKFLOW UPDATED:", workflow._id.toString());
  } else {
    workflow = await WorkflowDefinition.create({
      name: "Qualification Form Submitted",
      ...workflowConfig,
      activatedAt: new Date(),
    });
    console.log("WORKFLOW CREATED:", workflow._id.toString());
  }
} finally {
  await mongoose.disconnect();
}
