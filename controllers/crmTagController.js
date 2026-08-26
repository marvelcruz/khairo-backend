import CrmActivity from "../models/CrmActivity.js";
import CrmContact from "../models/CrmContact.js";
import CrmOpportunity, {
  CRM_STAGE_VALUES,
} from "../models/CrmOpportunity.js";
import CrmTag, {
  CRM_TAG_CATEGORIES,
  CRM_TAG_LIFECYCLE_MODES,
} from "../models/CrmTag.js";
import {
  makeUniqueCrmTagKey,
  normalizeCrmTagLookup,
  validateCrmTagKeys,
} from "../services/crmTagService.js";
import { dispatchCrmTagChange } from "../services/crmTagWorkflowService.js";

function cleanAliases(values = []) {
  if (!Array.isArray(values)) return [];

  return [
    ...new Set(
      values
        .map(normalizeCrmTagLookup)
        .filter(Boolean)
    ),
  ].slice(0, 20);
}

function validateLifecycleInput({ lifecycleMode = "manual", removeOnStages = [] } = {}) {
  if (!CRM_TAG_LIFECYCLE_MODES.includes(lifecycleMode)) {
    return { error: "Choose a valid tag lifecycle mode." };
  }

  if (!Array.isArray(removeOnStages)) {
    return { error: "Tag removal stages must be an array." };
  }

  const invalidStages = removeOnStages.filter(
    (stage) => !CRM_STAGE_VALUES.includes(stage)
  );

  if (invalidStages.length) {
    return { error: `Invalid tag removal stage: ${invalidStages[0]}.` };
  }

  const cleanedStages = [...new Set(removeOnStages)];

  if (lifecycleMode !== "workflow_limited" && cleanedStages.length) {
    return {
      error: "Pipeline removal stages can only be configured for workflow-limited tags.",
    };
  }

  if (lifecycleMode === "workflow_limited" && !cleanedStages.length) {
    return {
      error: "Choose at least one pipeline stage that removes a workflow-limited tag.",
    };
  }

  return {
    lifecycleMode,
    removeOnStages: lifecycleMode === "workflow_limited" ? cleanedStages : [],
  };
}

async function checkTagCollisions(
  {
    name,
    aliases = [],
    excludeId,
  }
) {
  const normalizedName =
    normalizeCrmTagLookup(name);

  const tokens = [
    normalizedName,
    ...cleanAliases(aliases),
  ].filter(Boolean);

  const collision =
    await CrmTag.findOne({
      ...(excludeId
        ? { _id: { $ne: excludeId } }
        : {}),
      $or: [
        {
          normalizedName: {
            $in: tokens,
          },
        },
        {
          aliases: {
            $in: tokens,
          },
        },
      ],
    }).lean();

  return collision;
}

export async function listCrmTags(
  req,
  res,
  next
) {
  try {
    const includeInactive =
      String(
        req.query.includeInactive || ""
      ) === "true";

    const query =
      includeInactive
        ? {}
        : { active: true };

    const [tags, usageRows] =
      await Promise.all([
        CrmTag.find(query)
          .sort({
            category: 1,
            name: 1,
          })
          .lean(),

        CrmContact.aggregate([
          {
            $match: {
              isArchived: false,
            },
          },
          { $unwind: "$tags" },
          {
            $group: {
              _id: "$tags",
              count: { $sum: 1 },
            },
          },
        ]),
      ]);

    const usage =
      new Map(
        usageRows.map((row) => [
          row._id,
          row.count,
        ])
      );

    res.status(200).json({
      success: true,
      categories:
        CRM_TAG_CATEGORIES,
      lifecycleModes:
        CRM_TAG_LIFECYCLE_MODES,
      pipelineStages:
        CRM_STAGE_VALUES,
      tags: tags.map((tag) => ({
        ...tag,
        usageCount:
          usage.get(tag.key) || 0,
      })),
    });
  } catch (error) {
    next(error);
  }
}

export async function createCrmTag(
  req,
  res,
  next
) {
  try {
    const {
      name,
      category = "other",
      description = "",
      aliases = [],
      lifecycleMode = "manual",
      removeOnStages = [],
    } = req.body;

    const cleanName =
      String(name || "").trim();

    if (!cleanName) {
      return res.status(400).json({
        success: false,
        message: "Tag name is required.",
      });
    }

    if (
      !CRM_TAG_CATEGORIES.includes(
        category
      )
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Choose a valid tag category.",
      });
    }

    const lifecycle = validateLifecycleInput({
      lifecycleMode,
      removeOnStages,
    });

    if (lifecycle.error) {
      return res.status(400).json({
        success: false,
        message: lifecycle.error,
      });
    }

    const collision =
      await checkTagCollisions({
        name: cleanName,
        aliases,
      });

    if (collision) {
      return res.status(409).json({
        success: false,
        message:
          `This tag conflicts with "${collision.name}".`,
      });
    }

    const tag =
      await CrmTag.create({
        key:
          await makeUniqueCrmTagKey(
            cleanName
          ),
        name: cleanName,
        normalizedName:
          normalizeCrmTagLookup(
            cleanName
          ),
        category,
        description:
          String(description || "")
            .trim(),
        aliases:
          cleanAliases(aliases),
        lifecycleMode:
          lifecycle.lifecycleMode,
        removeOnStages:
          lifecycle.removeOnStages,
        createdBy: req.user._id,
        updatedBy: req.user._id,
      });

    res.status(201).json({
      success: true,
      tag,
    });
  } catch (error) {
    next(error);
  }
}

export async function updateCrmTag(
  req,
  res,
  next
) {
  try {
    const tag =
      await CrmTag.findById(
        req.params.id
      );

    if (!tag) {
      return res.status(404).json({
        success: false,
        message: "CRM tag not found.",
      });
    }

    const name =
      req.body.name !== undefined
        ? String(
            req.body.name || ""
          ).trim()
        : tag.name;

    const aliases =
      req.body.aliases !== undefined
        ? cleanAliases(
            req.body.aliases
          )
        : tag.aliases;

    if (!name) {
      return res.status(400).json({
        success: false,
        message: "Tag name is required.",
      });
    }

    const category =
      req.body.category !== undefined
        ? req.body.category
        : tag.category;

    if (
      !CRM_TAG_CATEGORIES.includes(
        category
      )
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Choose a valid tag category.",
      });
    }

    const lifecycle = validateLifecycleInput({
      lifecycleMode:
        req.body.lifecycleMode !== undefined
          ? req.body.lifecycleMode
          : tag.lifecycleMode || "manual",
      removeOnStages:
        req.body.removeOnStages !== undefined
          ? req.body.removeOnStages
          : tag.removeOnStages || [],
    });

    if (lifecycle.error) {
      return res.status(400).json({
        success: false,
        message: lifecycle.error,
      });
    }

    const collision =
      await checkTagCollisions({
        name,
        aliases,
        excludeId: tag._id,
      });

    if (collision) {
      return res.status(409).json({
        success: false,
        message:
          `This tag conflicts with "${collision.name}".`,
      });
    }

    tag.name = name;
    tag.normalizedName =
      normalizeCrmTagLookup(name);
    tag.aliases = aliases;
    tag.category = category;
    tag.lifecycleMode =
      lifecycle.lifecycleMode;
    tag.removeOnStages =
      lifecycle.removeOnStages;

    if (
      req.body.description !==
      undefined
    ) {
      tag.description =
        String(
          req.body.description || ""
        ).trim();
    }

    if (
      req.body.active !==
      undefined
    ) {
      tag.active =
        Boolean(req.body.active);
    }

    tag.updatedBy = req.user._id;

    await tag.save();

    res.status(200).json({
      success: true,
      tag,
    });
  } catch (error) {
    next(error);
  }
}

export async function bulkApplyCrmTags(
  req,
  res,
  next
) {
  try {
    const {
      contactIds = [],
      add = [],
      remove = [],
    } = req.body;

    if (
      !Array.isArray(contactIds) ||
      !contactIds.length
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Choose at least one CRM contact.",
      });
    }

    if (contactIds.length > 250) {
      return res.status(400).json({
        success: false,
        message:
          "Tag up to 250 contacts at a time.",
      });
    }

    const addKeys =
      await validateCrmTagKeys(
        add,
        { activeOnly: true }
      );

    const removeKeys =
      await validateCrmTagKeys(
        remove,
        { activeOnly: false }
      );

    const contacts =
      await CrmContact.find({
        _id: { $in: contactIds },
        isArchived: false,
      });

    let changed = 0;
    const now = new Date();

    for (const contact of contacts) {
      const before =
        [...(contact.tags || [])];

      const nextTags =
        new Set(before);

      for (const key of addKeys) {
        nextTags.add(key);
      }

      for (const key of removeKeys) {
        nextTags.delete(key);
      }

      const after =
        [...nextTags];

      if (
        JSON.stringify(
          [...before].sort()
        ) ===
        JSON.stringify(
          [...after].sort()
        )
      ) {
        continue;
      }

      const beforeSet = new Set(before);
      const afterSet = new Set(after);
      const actuallyAdded = after.filter(
        (key) => !beforeSet.has(key)
      );
      const actuallyRemoved = before.filter(
        (key) => !afterSet.has(key)
      );

      contact.tags = after;
      contact.updatedBy = req.user._id;
      contact.lastActivityAt = now;

      await contact.save();

      await CrmActivity.create({
        contact: contact._id,
        type: "system",
        subject: "CRM tags updated",
        body: [
          actuallyAdded.length
            ? `Added: ${actuallyAdded.join(", ")}.`
            : "",
          actuallyRemoved.length
            ? `Removed: ${actuallyRemoved.join(", ")}.`
            : "",
        ]
          .filter(Boolean)
          .join(" "),
        createdBy: req.user._id,
        metadata: {
          event:
            "crm_tags_updated",
          added: actuallyAdded,
          removed: actuallyRemoved,
        },
      });

      for (const key of actuallyRemoved) {
        await dispatchCrmTagChange({
          contact,
          tag: key,
          change: "removed",
          actorUserId: req.user._id,
          actorName: req.user.name,
        });
      }

      for (const key of actuallyAdded) {
        await dispatchCrmTagChange({
          contact,
          tag: key,
          change: "added",
          actorUserId: req.user._id,
          actorName: req.user.name,
        });
      }

      changed += 1;
    }

    res.status(200).json({
      success: true,
      matched: contacts.length,
      changed,
      added: addKeys,
      removed: removeKeys,
    });
  } catch (error) {
    if (
      /approved tag library|CRM tags must/.test(
        error.message || ""
      )
    ) {
      return res.status(400).json({
        success: false,
        message: error.message,
      });
    }

    next(error);
  }
}
