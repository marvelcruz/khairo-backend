import mongoose from "mongoose";
import CrmContact from "../models/CrmContact.js";
import WorkflowDefinition from "../models/WorkflowDefinition.js";
import WorkflowRun from "../models/WorkflowRun.js";
import { logAudit } from "../utils/auditLogger.js";
import {
  runManualWorkflow,
  validateWorkflowInput,
  workflowReferenceData,
} from "../services/workflowService.js";

function workflowDto(workflow) {
  const doc = workflow.toObject ? workflow.toObject() : workflow;
  const runCount = Number(doc.runCount || 0);
  return {
    ...doc,
    successRate: runCount ? Math.round((Number(doc.successCount || 0) / runCount) * 100) : null,
  };
}

export async function listWorkflows(req, res, next) {
  try {
    const workflows = await WorkflowDefinition.find({}).sort({ updatedAt: -1 });
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const [runsToday, failuresToday] = await Promise.all([
      WorkflowRun.countDocuments({ createdAt: { $gte: start } }),
      WorkflowRun.countDocuments({ createdAt: { $gte: start }, status: { $in: ["failed", "partial"] } }),
    ]);
    res.json({
      success: true,
      workflows: workflows.map(workflowDto),
      stats: {
        total: workflows.length,
        active: workflows.filter((item) => item.status === "active").length,
        runsToday,
        failuresToday,
      },
    });
  } catch (error) {
    next(error);
  }
}

export async function getWorkflow(req, res, next) {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ success: false, message: "Invalid workflow id." });
    const workflow = await WorkflowDefinition.findById(req.params.id);
    if (!workflow) return res.status(404).json({ success: false, message: "Workflow not found." });
    res.json({ success: true, workflow: workflowDto(workflow) });
  } catch (error) {
    next(error);
  }
}

export async function createWorkflow(req, res, next) {
  try {
    const input = validateWorkflowInput(req.body);
    const workflow = await WorkflowDefinition.create({ ...input, status: "draft", createdBy: req.user._id, updatedBy: req.user._id });
    await logAudit(req, "Created workflow", "WorkflowDefinition", workflow._id.toString(), workflow.name);
    res.status(201).json({ success: true, workflow: workflowDto(workflow) });
  } catch (error) {
    if (error?.message && !String(error.message).includes("Mongo")) return res.status(400).json({ success: false, message: error.message });
    next(error);
  }
}

export async function updateWorkflow(req, res, next) {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ success: false, message: "Invalid workflow id." });
    const workflow = await WorkflowDefinition.findById(req.params.id);
    if (!workflow) return res.status(404).json({ success: false, message: "Workflow not found." });
    const input = validateWorkflowInput({ ...workflow.toObject(), ...req.body, trigger: req.body.trigger ?? workflow.trigger, actions: req.body.actions ?? workflow.actions });
    Object.assign(workflow, input, { updatedBy: req.user._id });
    await workflow.save();
    await logAudit(req, "Updated workflow", "WorkflowDefinition", workflow._id.toString(), workflow.name);
    res.json({ success: true, workflow: workflowDto(workflow) });
  } catch (error) {
    if (error?.message && !String(error.message).includes("Mongo")) return res.status(400).json({ success: false, message: error.message });
    next(error);
  }
}

export async function setWorkflowStatus(req, res, next) {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ success: false, message: "Invalid workflow id." });
    const status = String(req.body.status || "");
    if (!["draft", "active", "paused"].includes(status)) return res.status(400).json({ success: false, message: "Invalid workflow status." });
    const workflow = await WorkflowDefinition.findById(req.params.id);
    if (!workflow) return res.status(404).json({ success: false, message: "Workflow not found." });
    if (status === "active") validateWorkflowInput(workflow.toObject());
    workflow.status = status;
    workflow.updatedBy = req.user._id;
    if (status === "active" && !workflow.activatedAt) workflow.activatedAt = new Date();
    await workflow.save();
    await logAudit(req, status === "active" ? "Activated workflow" : status === "paused" ? "Paused workflow" : "Moved workflow to draft", "WorkflowDefinition", workflow._id.toString(), workflow.name);
    res.json({ success: true, workflow: workflowDto(workflow) });
  } catch (error) {
    if (error?.message && !String(error.message).includes("Mongo")) return res.status(400).json({ success: false, message: error.message });
    next(error);
  }
}

export async function listWorkflowRuns(req, res, next) {
  try {
    const query = {};
    if (req.query.workflowId) {
      if (!mongoose.isValidObjectId(req.query.workflowId)) return res.status(400).json({ success: false, message: "Invalid workflow id." });
      query.workflow = req.query.workflowId;
    }
    const runs = await WorkflowRun.find(query).sort({ createdAt: -1 }).limit(200).lean();
    res.json({ success: true, runs });
  } catch (error) {
    next(error);
  }
}

export async function getWorkflowReferenceData(req, res, next) {
  try {
    const data = await workflowReferenceData();
    res.json({ success: true, ...data });
  } catch (error) {
    next(error);
  }
}

export async function getManualRunContacts(req, res, next) {
  try {
    const contacts = await CrmContact.find({ isArchived: false }).select("fullName email phone").sort({ updatedAt: -1 }).limit(80).lean();
    res.json({ success: true, contacts });
  } catch (error) {
    next(error);
  }
}

export async function runWorkflowManually(req, res, next) {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ success: false, message: "Invalid workflow id." });
    const workflow = await WorkflowDefinition.findById(req.params.id);
    if (!workflow) return res.status(404).json({ success: false, message: "Workflow not found." });
    const result = await runManualWorkflow(workflow, { contactId: req.body.contactId, actorUserId: req.user._id, actorName: req.user.name });
    await logAudit(req, "Ran workflow manually", "WorkflowDefinition", workflow._id.toString(), workflow.name);
    res.status(201).json({ success: true, run: result.run });
  } catch (error) {
    if (error?.message && !String(error.message).includes("Mongo")) return res.status(400).json({ success: false, message: error.message });
    next(error);
  }
}


export async function duplicateWorkflowTemplate(req, res, next) {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid workflow id." });
    }

    const template = await WorkflowDefinition.findById(req.params.id);
    if (!template) {
      return res.status(404).json({ success: false, message: "Workflow template not found." });
    }

    if (!template.isTemplate) {
      return res.status(400).json({ success: false, message: "Only template workflows can be duplicated." });
    }

    const workflow = new WorkflowDefinition({
      name: `${template.name} Copy`,
      description: template.description,
      status: "draft",
      mode: "live",
      isTemplate: false,
      templateCategory: template.templateCategory || "",
      trigger: template.trigger,
      actions: template.actions,
      createdBy: req.user._id,
      updatedBy: req.user._id,
    });

    await workflow.save();

    await logAudit(
      req,
      "Duplicated workflow template",
      "WorkflowDefinition",
      workflow._id.toString(),
      `${template.name} → ${workflow.name}`
    );

    res.status(201).json({ success: true, workflow: workflowDto(workflow) });
  } catch (error) {
    next(error);
  }
}
