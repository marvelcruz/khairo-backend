import Newsletter from "../models/Newsletter.js";

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120) || "newsletter";
}

async function uniqueSlug(title, excludeId) {
  const base = slugify(title);
  let candidate = base;
  let suffix = 2;

  while (
    await Newsletter.exists({
      slug: candidate,
      ...(excludeId ? { _id: { $ne: excludeId } } : {}),
    })
  ) {
    candidate = `${base.slice(0, 112)}-${suffix++}`;
  }

  return candidate;
}

function publicNewsletterDto(newsletter) {
  return {
    id: newsletter._id,
    title: newsletter.title,
    slug: newsletter.slug,
    excerpt: newsletter.excerpt || "",
    content: newsletter.content,
    logoUrl: newsletter.logoUrl || "",
    publishedAt: newsletter.publishedAt,
    clientVisible: newsletter.clientVisible,
    publicVisible: newsletter.publicVisible,
  };
}

export const listNewsletters = async (req, res, next) => {
  try {
    const query = {};
    if (req.query.status) {
      if (!["draft", "published"].includes(req.query.status)) {
        return res.status(400).json({ success: false, message: "Invalid status filter." });
      }
      query.status = req.query.status;
    }

    const newsletters = await Newsletter.find(query)
      .sort({ publishedAt: -1, createdAt: -1 })
      .limit(200)
      .lean();

    res.status(200).json({ success: true, newsletters });
  } catch (error) {
    next(error);
  }
};

export const getNewsletter = async (req, res, next) => {
  try {
    const newsletter = await Newsletter.findById(req.params.id);
    if (!newsletter) {
      return res.status(404).json({ success: false, message: "Newsletter not found." });
    }
    res.status(200).json({ success: true, newsletter });
  } catch (error) {
    next(error);
  }
};

export const createNewsletter = async (req, res, next) => {
  try {
    const title = String(req.body?.title || "").trim();
    const content = String(req.body?.content || "").trim();
    const excerpt = String(req.body?.excerpt || "").trim();
    const logoUrl = String(req.body?.logoUrl || "").trim();
    const status = req.body?.status === "published" ? "published" : "draft";
    const clientVisible = Boolean(req.body?.clientVisible ?? true);
    const publicVisible = Boolean(req.body?.publicVisible ?? true);

    if (!title || !content) {
      return res.status(400).json({ success: false, message: "Title and content are required." });
    }

    const newsletter = await Newsletter.create({
      title,
      slug: await uniqueSlug(title),
      excerpt,
      content,
      logoUrl,
      status,
      clientVisible,
      publicVisible,
      publishedAt: status === "published" ? new Date() : undefined,
      createdBy: req.user._id,
      updatedBy: req.user._id,
    });

    res.status(201).json({ success: true, newsletter });
  } catch (error) {
    next(error);
  }
};

export const updateNewsletter = async (req, res, next) => {
  try {
    const newsletter = await Newsletter.findById(req.params.id);
    if (!newsletter) {
      return res.status(404).json({ success: false, message: "Newsletter not found." });
    }

    const title = req.body?.title !== undefined ? String(req.body.title).trim() : newsletter.title;
    const content = req.body?.content !== undefined ? String(req.body.content).trim() : newsletter.content;
    const excerpt = req.body?.excerpt !== undefined ? String(req.body.excerpt).trim() : newsletter.excerpt;
    const logoUrl = req.body?.logoUrl !== undefined ? String(req.body.logoUrl).trim() : newsletter.logoUrl;
    const status = req.body?.status === "published" ? "published" : req.body?.status === "draft" ? "draft" : newsletter.status;
    const clientVisible = req.body?.clientVisible !== undefined ? Boolean(req.body.clientVisible) : newsletter.clientVisible;
    const publicVisible = req.body?.publicVisible !== undefined ? Boolean(req.body.publicVisible) : newsletter.publicVisible;

    if (!title || !content) {
      return res.status(400).json({ success: false, message: "Title and content are required." });
    }

    newsletter.title = title;
    newsletter.excerpt = excerpt;
    newsletter.content = content;
    newsletter.logoUrl = logoUrl;
    newsletter.status = status;
    newsletter.clientVisible = clientVisible;
    newsletter.publicVisible = publicVisible;
    newsletter.slug = await uniqueSlug(title, newsletter._id);

    if (status === "published" && !newsletter.publishedAt) {
      newsletter.publishedAt = new Date();
    } else if (status === "draft") {
      newsletter.publishedAt = undefined;
    }

    newsletter.updatedBy = req.user._id;
    await newsletter.save();

    res.status(200).json({ success: true, newsletter });
  } catch (error) {
    next(error);
  }
};

export const deleteNewsletter = async (req, res, next) => {
  try {
    const newsletter = await Newsletter.findById(req.params.id);
    if (!newsletter) {
      return res.status(404).json({ success: false, message: "Newsletter not found." });
    }
    await newsletter.deleteOne();
    res.status(200).json({ success: true });
  } catch (error) {
    next(error);
  }
};

export const getPublicNewsletters = async (req, res, next) => {
  try {
    const newsletters = await Newsletter.find({
      status: "published",
      publicVisible: true,
    })
      .sort({ publishedAt: -1, createdAt: -1 })
      .limit(50)
      .lean();

    res.status(200).json({
      success: true,
      newsletters: newsletters.map(publicNewsletterDto),
    });
  } catch (error) {
    next(error);
  }
};

export const getClientNewsletters = async (req, res, next) => {
  try {
    const newsletters = await Newsletter.find({
      status: "published",
      clientVisible: true,
    })
      .sort({ publishedAt: -1, createdAt: -1 })
      .limit(50)
      .lean();

    res.status(200).json({
      success: true,
      newsletters: newsletters.map(publicNewsletterDto),
    });
  } catch (error) {
    next(error);
  }
};
