import WebsiteContent from "../models/WebsiteContent.js";
import WebsiteContentVersion from "../models/WebsiteContentVersion.js";
import WebsiteMedia from "../models/WebsiteMedia.js";
import websiteContentDefaults from "../config/websiteContentDefaults.js";

const normalizeKey = (value = "") =>
  String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");


export const seedDefaultContent = async (req, res, next) => {
  try {
    const now = new Date();

    for (const item of websiteContentDefaults) {
      await WebsiteContent.findOneAndUpdate(
        {
          pageKey: item.pageKey,
          sectionKey: item.sectionKey,
        },
        {
          $setOnInsert: {
            pageKey: item.pageKey,
            sectionKey: item.sectionKey,
            label: item.label,
            type: item.type,
            draftValue: item.value,
            publishedValue: item.value,
            status: "published",
            order: item.order,
            group: item.group,
            publishedAt: now,
            publishedBy: req.user?._id,
            updatedBy: req.user?._id,
          },
        },
        {
          upsert: true,
          new: true,
          setDefaultsOnInsert: true,
        }
      );
    }

    res.json({
      success: true,
      count: websiteContentDefaults.length,
    });
  } catch (error) {
    next(error);
  }
};

export const listContent = async (req, res, next) => {
  try {
    const filter = {};
    if (req.query.pageKey) filter.pageKey = normalizeKey(req.query.pageKey);

    const content = await WebsiteContent.find(filter)
      .sort({ pageKey: 1, order: 1, sectionKey: 1 })
      .lean();

    res.json({ success: true, content });
  } catch (error) {
    next(error);
  }
};

export const getContentItem = async (req, res, next) => {
  try {
    const item = await WebsiteContent.findById(req.params.id).lean();

    if (!item) {
      return res.status(404).json({
        success: false,
        message: "Website content item not found.",
      });
    }

    res.json({ success: true, content: item });
  } catch (error) {
    next(error);
  }
};

export const createContentItem = async (req, res, next) => {
  try {
    const pageKey = normalizeKey(req.body.pageKey);
    const sectionKey = normalizeKey(req.body.sectionKey);

    if (!pageKey || !sectionKey) {
      return res.status(400).json({
        success: false,
        message: "Page and content key are required.",
      });
    }

    const exists = await WebsiteContent.findOne({ pageKey, sectionKey });

    if (exists) {
      return res.status(409).json({
        success: false,
        message: "That content key already exists on this page.",
      });
    }

    const content = await WebsiteContent.create({
      pageKey,
      sectionKey,
      label: req.body.label || sectionKey,
      type: req.body.type || "text",
      draftValue: req.body.draftValue ?? "",
      publishedValue: req.body.publishedValue ?? "",
      status: req.body.status || "draft",
      order: Number(req.body.order) || 0,
      group: req.body.group || "",
      description: req.body.description || "",
      updatedBy: req.user?._id,
    });

    res.status(201).json({ success: true, content });
  } catch (error) {
    next(error);
  }
};

export const updateContentItem = async (req, res, next) => {
  try {
    const allowed = [
      "label",
      "type",
      "draftValue",
      "order",
      "group",
      "description",
    ];

    const update = { updatedBy: req.user?._id };

    for (const field of allowed) {
      if (Object.prototype.hasOwnProperty.call(req.body, field)) {
        update[field] = req.body[field];
      }
    }

    const content = await WebsiteContent.findByIdAndUpdate(
      req.params.id,
      update,
      { new: true, runValidators: true }
    );

    if (!content) {
      return res.status(404).json({
        success: false,
        message: "Website content item not found.",
      });
    }

    res.json({ success: true, content });
  } catch (error) {
    next(error);
  }
};

export const publishContentItem = async (req, res, next) => {
  try {
    const content = await WebsiteContent.findById(req.params.id);

    if (!content) {
      return res.status(404).json({
        success: false,
        message: "Website content item not found.",
      });
    }

    content.publishedValue = content.draftValue;
    content.status = "published";
    content.publishedAt = new Date();
    content.publishedBy = req.user?._id;
    content.updatedBy = req.user?._id;

    await content.save();

    await WebsiteContentVersion.create({
      contentId: content._id,
      pageKey: content.pageKey,
      sectionKey: content.sectionKey,
      value: content.publishedValue,
      action: "publish",
      createdBy: req.user?._id,
    });

    res.json({ success: true, content });
  } catch (error) {
    next(error);
  }
};

export const publishPage = async (req, res, next) => {
  try {
    const pageKey = normalizeKey(req.params.pageKey);
    const items = await WebsiteContent.find({ pageKey });
    const now = new Date();

    for (const content of items) {
      content.publishedValue = content.draftValue;
      content.status = "published";
      content.publishedAt = now;
      content.publishedBy = req.user?._id;
      content.updatedBy = req.user?._id;

      await content.save();

      await WebsiteContentVersion.create({
        contentId: content._id,
        pageKey: content.pageKey,
        sectionKey: content.sectionKey,
        value: content.publishedValue,
        action: "publish",
        createdBy: req.user?._id,
      });
    }

    res.json({
      success: true,
      count: items.length,
      message: `${items.length} content items published.`,
    });
  } catch (error) {
    next(error);
  }
};

export const getVersions = async (req, res, next) => {
  try {
    const versions = await WebsiteContentVersion.find({
      contentId: req.params.id,
    })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();

    res.json({ success: true, versions });
  } catch (error) {
    next(error);
  }
};

export const restoreVersion = async (req, res, next) => {
  try {
    const version = await WebsiteContentVersion.findById(req.params.versionId);

    if (!version) {
      return res.status(404).json({
        success: false,
        message: "Version not found.",
      });
    }

    const content = await WebsiteContent.findById(version.contentId);

    if (!content) {
      return res.status(404).json({
        success: false,
        message: "Website content item not found.",
      });
    }

    content.draftValue = version.value;
    content.updatedBy = req.user?._id;
    await content.save();

    await WebsiteContentVersion.create({
      contentId: content._id,
      pageKey: content.pageKey,
      sectionKey: content.sectionKey,
      value: version.value,
      action: "restore",
      createdBy: req.user?._id,
    });

    res.json({ success: true, content });
  } catch (error) {
    next(error);
  }
};

export const deleteContentItem = async (req, res, next) => {
  try {
    const content = await WebsiteContent.findByIdAndDelete(req.params.id);

    if (!content) {
      return res.status(404).json({
        success: false,
        message: "Website content item not found.",
      });
    }

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
};

export const getPublicPageContent = async (req, res, next) => {
  try {
    const pageKey = normalizeKey(req.params.pageKey);

    const items = await WebsiteContent.find({
      pageKey,
      status: "published",
    })
      .sort({ order: 1, sectionKey: 1 })
      .select(
        "pageKey sectionKey label type publishedValue order group description publishedAt"
      )
      .lean();

    const values = {};

    for (const item of items) {
      values[item.sectionKey] = item.publishedValue;
    }

    res.json({
      success: true,
      pageKey,
      values,
      content: items,
    });
  } catch (error) {
    next(error);
  }
};

export const listMedia = async (req, res, next) => {
  try {
    const media = await WebsiteMedia.find({ archived: false })
      .sort({ createdAt: -1 })
      .lean();

    res.json({ success: true, media });
  } catch (error) {
    next(error);
  }
};

export const createMedia = async (req, res, next) => {
  try {
    const { name, url, alt, category } = req.body;

    if (!name || !url) {
      return res.status(400).json({
        success: false,
        message: "Image name and URL are required.",
      });
    }

    const media = await WebsiteMedia.create({
      name,
      url,
      alt: alt || "",
      category: category || "general",
      createdBy: req.user?._id,
    });

    res.status(201).json({ success: true, media });
  } catch (error) {
    next(error);
  }
};

export const updateMedia = async (req, res, next) => {
  try {
    const media = await WebsiteMedia.findByIdAndUpdate(
      req.params.id,
      {
        ...(req.body.name !== undefined ? { name: req.body.name } : {}),
        ...(req.body.url !== undefined ? { url: req.body.url } : {}),
        ...(req.body.alt !== undefined ? { alt: req.body.alt } : {}),
        ...(req.body.category !== undefined
          ? { category: req.body.category }
          : {}),
      },
      { new: true, runValidators: true }
    );

    if (!media) {
      return res.status(404).json({
        success: false,
        message: "Media item not found.",
      });
    }

    res.json({ success: true, media });
  } catch (error) {
    next(error);
  }
};

export const archiveMedia = async (req, res, next) => {
  try {
    const media = await WebsiteMedia.findByIdAndUpdate(
      req.params.id,
      { archived: true },
      { new: true }
    );

    if (!media) {
      return res.status(404).json({
        success: false,
        message: "Media item not found.",
      });
    }

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
};
