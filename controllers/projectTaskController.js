import mongoose from "mongoose";
import InternalTask from "../models/InternalTask.js";
import Project from "../models/Project.js";
import Sop from "../models/Sop.js";
import User from "../models/User.js";
import { logAudit } from "../utils/auditLogger.js";
import { normalizedProfile } from "../utils/roleProfiles.js";

const PROJECT_STATUSES = ["active", "completed", "archived"];
const TASK_STATUSES = ["todo", "in_progress", "done"];
const DATE_MIN = new Date("2000-01-01T00:00:00.000Z").getTime();
const DATE_MAX = new Date("2101-01-01T00:00:00.000Z").getTime();

function clean(value = "") {
  return String(value ?? "").trim();
}

function isDoctor(user) {
  return normalizedProfile(user?.roles || []) === "doctor";
}

function parseDueAt(value) {
  if (value === undefined) return { provided: false, value: undefined };
  if (value === null || value === "") return { provided: true, value: null };
  if (typeof value !== "string" || !/(?:Z|[+-]\d{2}:\d{2})$/i.test(value.trim())) {
    return { provided: true, error: "Task due date must include an explicit timezone." };
  }
  const date = new Date(value);
  const time = date.getTime();
  if (!Number.isFinite(time) || time < DATE_MIN || time > DATE_MAX) {
    return { provided: true, error: "Task due date is invalid." };
  }
  return { provided: true, value: date };
}

async function activeAssignee(id) {
  if (!id) return null;
  if (!mongoose.isValidObjectId(id)) return false;
  return User.findOne({ _id: id, isActive: true }).select("_id name email roles isActive");
}

async function activeProject(id) {
  if (!id) return null;
  if (!mongoose.isValidObjectId(id)) return false;
  return Project.findOne({ _id: id, status: "active" });
}

async function activeSop(id) {
  if (!id) return null;
  if (!mongoose.isValidObjectId(id)) return false;
  return Sop.findOne({ _id: id, status: { $ne: "archived" } }).select("_id title category status");
}

function normalizedChecklist(value = []) {
  if (!Array.isArray(value)) throw new Error("Task checklist must be a list.");
  if (value.length > 30) throw new Error("A task can contain up to 30 checklist items.");
  return value.map((item, index) => {
    const text = clean(typeof item === "string" ? item : item?.text);
    if (!text) throw new Error(`Checklist item ${index + 1} needs text.`);
    if (text.length > 300) throw new Error(`Checklist item ${index + 1} is too long.`);
    return {
      ...(item?._id && mongoose.isValidObjectId(item._id) ? { _id: item._id } : {}),
      text,
      completed: Boolean(item?.completed),
    };
  });
}

async function populatedTask(task) {
  await task.populate([
    { path: "project", select: "name status" },
    { path: "sop", select: "title category status" },
    { path: "assignedTo", select: "name email roles isActive" },
  ]);
  return task;
}

export async function listProjectsTasks(req, res, next) {
  try {
    const doctorView = isDoctor(req.user);
    const projects = await Project.find({ status: { $ne: "archived" } })
      .sort({ status: 1, name: 1 })
      .lean();
    const projectIds = projects.map((project) => project._id);

    const taskQuery = {
      $and: [
        { $or: [{ project: null }, { project: { $in: projectIds } }] },
        ...(doctorView ? [{ assignedTo: req.user._id }] : []),
      ],
    };

    const [tasks, assignees, sops] = await Promise.all([
      InternalTask.find(taskQuery)
        .sort({ status: 1, dueAt: 1, createdAt: -1 })
        .populate("project", "name status")
        .populate("sop", "title category status")
        .populate("assignedTo", "name email roles isActive")
        .lean(),
      doctorView
        ? User.find({ _id: req.user._id, isActive: true }).select("_id name email roles isActive").lean()
        : User.find({
            isActive: true,
            roles: { $in: ["admin", "staff", "coach", "doctor", "sales"] },
          })
            .select("_id name email roles isActive")
            .sort({ name: 1 })
            .lean(),
      Sop.find({ status: "active" }).select("_id title category").sort({ sortOrder: 1, title: 1 }).lean(),
    ]);

    const now = new Date();
    const stats = {
      open: tasks.filter((task) => task.status !== "done").length,
      inProgress: tasks.filter((task) => task.status === "in_progress").length,
      completed: tasks.filter((task) => task.status === "done").length,
      overdue: tasks.filter((task) => task.status !== "done" && task.dueAt && new Date(task.dueAt) < now).length,
    };

    res.status(200).json({
      success: true,
      projects,
      tasks,
      assignees,
      sops,
      stats,
      viewer: { id: String(req.user._id), profile: doctorView ? "doctor" : "staff" },
    });
  } catch (error) {
    next(error);
  }
}

export async function createProject(req, res, next) {
  try {
    const name = clean(req.body.name);
    const description = clean(req.body.description);
    if (!name) return res.status(400).json({ success: false, message: "Project name is required." });
    if (name.length > 160 || description.length > 1200) {
      return res.status(400).json({ success: false, message: "Project details are too long." });
    }
    const project = await Project.create({
      name,
      description,
      status: "active",
      createdBy: req.user._id,
      updatedBy: req.user._id,
    });
    await logAudit(req, "Created internal project", "Project", project._id.toString(), project.name);
    res.status(201).json({ success: true, project });
  } catch (error) {
    next(error);
  }
}

export async function updateProject(req, res, next) {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ success: false, message: "Invalid project id." });
    const project = await Project.findById(req.params.id);
    if (!project) return res.status(404).json({ success: false, message: "Project not found." });

    if (req.body.name !== undefined) {
      const name = clean(req.body.name);
      if (!name || name.length > 160) return res.status(400).json({ success: false, message: "Enter a valid project name." });
      project.name = name;
    }
    if (req.body.description !== undefined) {
      const description = clean(req.body.description);
      if (description.length > 1200) return res.status(400).json({ success: false, message: "Project description is too long." });
      project.description = description;
    }
    if (req.body.status !== undefined) {
      const status = clean(req.body.status);
      if (!PROJECT_STATUSES.includes(status)) return res.status(400).json({ success: false, message: "Invalid project status." });
      if (["completed", "archived"].includes(status)) {
        const openTask = await InternalTask.exists({ project: project._id, status: { $ne: "done" } });
        if (openTask) return res.status(409).json({ success: false, message: "Complete the project's open tasks first." });
      }
      project.status = status;
    }
    project.updatedBy = req.user._id;
    await project.save();
    await logAudit(req, "Updated internal project", "Project", project._id.toString(), project.name);
    res.status(200).json({ success: true, project });
  } catch (error) {
    next(error);
  }
}

export async function createTask(req, res, next) {
  try {
    const title = clean(req.body.title);
    const description = clean(req.body.description);
    if (!title) return res.status(400).json({ success: false, message: "Task title is required." });
    if (title.length > 300 || description.length > 3000) {
      return res.status(400).json({ success: false, message: "Task details are too long." });
    }

    const project = await activeProject(req.body.project);
    if (req.body.project && !project) return res.status(400).json({ success: false, message: "Choose an active project or leave Project blank for a one-off task." });

    const sop = await activeSop(req.body.sop);
    if (req.body.sop && !sop) return res.status(400).json({ success: false, message: "Choose a valid SOP." });

    const assignee = await activeAssignee(req.body.assignedTo);
    if (req.body.assignedTo && !assignee) return res.status(400).json({ success: false, message: "Assigned team member was not found or is inactive." });

    const parsedDueAt = parseDueAt(req.body.dueAt);
    if (parsedDueAt.error) return res.status(400).json({ success: false, message: parsedDueAt.error });

    const requestedStatus = clean(req.body.status || "todo");
    if (!TASK_STATUSES.includes(requestedStatus)) return res.status(400).json({ success: false, message: "Invalid task status." });

    const checklist = normalizedChecklist(req.body.checklist || []).map((item) => ({
      ...item,
      completedAt: item.completed ? new Date() : null,
      completedBy: item.completed ? req.user._id : null,
    }));

    const task = await InternalTask.create({
      project: project?._id || null,
      sop: sop?._id || null,
      source: sop ? "sop" : "manual",
      title,
      description,
      checklist,
      status: requestedStatus,
      assignedTo: assignee?._id || null,
      dueAt: parsedDueAt.provided ? parsedDueAt.value : null,
      completedAt: requestedStatus === "done" ? new Date() : null,
      createdBy: req.user._id,
      updatedBy: req.user._id,
    });

    await populatedTask(task);
    await logAudit(req, "Created internal task", "InternalTask", task._id.toString(), task.title);
    res.status(201).json({ success: true, task });
  } catch (error) {
    if (error?.message && !String(error.message).includes("Mongo")) return res.status(400).json({ success: false, message: error.message });
    next(error);
  }
}

export async function updateTask(req, res, next) {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ success: false, message: "Invalid task id." });
    const task = await InternalTask.findById(req.params.id);
    if (!task) return res.status(404).json({ success: false, message: "Task not found." });

    const doctorView = isDoctor(req.user);
    if (doctorView) {
      if (String(task.assignedTo || "") !== String(req.user._id)) return res.status(403).json({ success: false, message: "You can only update tasks assigned to you." });
      const allowed = new Set(["status", "checklist"]);
      const attempted = Object.keys(req.body || {}).filter((key) => !allowed.has(key));
      if (attempted.length) return res.status(403).json({ success: false, message: "Doctors can update task progress and checklist completion only." });
    }

    if (req.body.title !== undefined) {
      const title = clean(req.body.title);
      if (!title || title.length > 300) return res.status(400).json({ success: false, message: "Enter a valid task title." });
      task.title = title;
    }
    if (req.body.description !== undefined) {
      const description = clean(req.body.description);
      if (description.length > 3000) return res.status(400).json({ success: false, message: "Task description is too long." });
      task.description = description;
    }
    if (req.body.project !== undefined) {
      const project = await activeProject(req.body.project);
      if (req.body.project && !project) return res.status(400).json({ success: false, message: "Choose an active project or leave Project blank for a one-off task." });
      task.project = project?._id || null;
    }
    if (req.body.sop !== undefined) {
      const sop = await activeSop(req.body.sop);
      if (req.body.sop && !sop) return res.status(400).json({ success: false, message: "Choose a valid SOP." });
      task.sop = sop?._id || null;
      task.source = sop ? "sop" : "manual";
    }
    if (req.body.assignedTo !== undefined) {
      const assignee = await activeAssignee(req.body.assignedTo);
      if (req.body.assignedTo && !assignee) return res.status(400).json({ success: false, message: "Assigned team member was not found or is inactive." });
      task.assignedTo = assignee?._id || null;
    }
    if (req.body.dueAt !== undefined) {
      const parsedDueAt = parseDueAt(req.body.dueAt);
      if (parsedDueAt.error) return res.status(400).json({ success: false, message: parsedDueAt.error });
      task.dueAt = parsedDueAt.value;
    }
    if (req.body.checklist !== undefined) {
      const incoming = normalizedChecklist(req.body.checklist);
      const current = new Map((task.checklist || []).map((item) => [String(item._id), item]));
      task.checklist = incoming.map((item) => {
        const previous = item._id ? current.get(String(item._id)) : null;
        const becameComplete = item.completed && !previous?.completed;
        return {
          ...item,
          completedAt: item.completed ? previous?.completedAt || (becameComplete ? new Date() : new Date()) : null,
          completedBy: item.completed ? previous?.completedBy || req.user._id : null,
        };
      });
    }
    if (req.body.status !== undefined) {
      const status = clean(req.body.status);
      if (!TASK_STATUSES.includes(status)) return res.status(400).json({ success: false, message: "Invalid task status." });
      task.status = status;
      task.completedAt = status === "done" ? task.completedAt || new Date() : null;
    }

    task.updatedBy = req.user._id;
    await task.save();
    await populatedTask(task);
    await logAudit(req, "Updated internal task", "InternalTask", task._id.toString(), task.title);
    res.status(200).json({ success: true, task });
  } catch (error) {
    if (error?.message && !String(error.message).includes("Mongo")) return res.status(400).json({ success: false, message: error.message });
    next(error);
  }
}
