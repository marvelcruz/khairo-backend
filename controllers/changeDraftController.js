import ChangeDraft from "../models/ChangeDraft.js";
import Client from "../models/Client.js";
import { logAudit } from "../utils/auditLogger.js";
import {
  getLegacyCycleWeeks,
  isLegacyProgramKey,
  normalizeLegacyProgramKey,
  resolveLegacyProgramOffering,
} from "../utils/programOfferingResolver.js";

const ALLOWED_CLIENT_FIELDS = ["program", "status", "goalWeightKg", "startingWeightKg", "cycleWeeks", "mealPlanNotes"];

export const getDrafts = async (req, res, next) => {
  try {
    const { entityType, entityId } = req.params;
    const drafts = await ChangeDraft.find({ entityType, entityId })
      .sort({ createdAt: -1 })
      .populate("submittedBy", "name")
      .populate("finalizedBy", "name");
    res.status(200).json({ success: true, drafts });
  } catch (err) { next(err); }
};

export const createDraft = async (req, res, next) => {
  try {
    const { entityType, entityId } = req.params;
    const { title, changes, note } = req.body;
    if (!title || !changes || typeof changes !== "object") {
      return res.status(400).json({ success: false, message: "Title and changes are required." });
    }
    const draft = await ChangeDraft.create({ entityType, entityId, title, changes, note, submittedBy: req.user._id });
    await draft.populate("submittedBy", "name");
    res.status(201).json({ success: true, draft });
  } catch (err) { next(err); }
};

export const finalizeDraft = async (req, res, next) => {
  try {
    const draft = await ChangeDraft.findById(req.params.id);
    if (!draft || draft.status !== "pending") {
      return res.status(404).json({ success: false, message: "Pending draft not found." });
    }

    if (draft.entityType === "Client") {
      const safe = {};
      for (const [key, val] of Object.entries(draft.changes || {})) {
        if (ALLOWED_CLIENT_FIELDS.includes(key)) safe[key] = val;
      }

      if (safe.program !== undefined) {
        const program =
          normalizeLegacyProgramKey(
            safe.program
          );

        if (!isLegacyProgramKey(program)) {
          return res.status(400).json({
            success: false,
            message:
              "A currently supported program is required.",
          });
        }

        const offering =
          await resolveLegacyProgramOffering(
            program
          );

        if (!offering) {
          return res.status(409).json({
            success: false,
            message:
              "This program is not linked to an active catalogue offering. Please contact an administrator.",
          });
        }

        safe.program = program;
        safe.programOffering =
          offering._id;

        if (safe.cycleWeeks === undefined) {
          safe.cycleWeeks =
            getLegacyCycleWeeks(
              offering,
              program
            );
        }
      }

      const client = await Client.findByIdAndUpdate(draft.entityId, safe, { new: true, runValidators: true });
      if (!client) return res.status(404).json({ success: false, message: "Client not found." });
      await logAudit(req, "Finalized draft: " + draft.title, "Client", client._id, client.fullName);
    }

    draft.status = "finalized";
    draft.finalizedBy = req.user._id;
    draft.finalizedAt = new Date();
    await draft.save();
    await draft.populate("finalizedBy", "name");
    res.status(200).json({ success: true, draft });
  } catch (err) { next(err); }
};

export const rejectDraft = async (req, res, next) => {
  try {
    const draft = await ChangeDraft.findById(req.params.id);
    if (!draft || draft.status !== "pending") {
      return res.status(404).json({ success: false, message: "Pending draft not found." });
    }
    draft.status = "rejected";
    draft.finalizedBy = req.user._id;
    draft.finalizedAt = new Date();
    await draft.save();
    await logAudit(req, "Rejected draft: " + draft.title, draft.entityType, draft.entityId, "");
    res.status(200).json({ success: true, draft });
  } catch (err) { next(err); }
};
