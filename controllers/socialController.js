import SocialAccount from "../models/SocialAccount.js";
import SocialPost from "../models/SocialPost.js";

import {
  createInstagramImageContainer,
  getInstagramContainerStatus,
  publishInstagramContainer,
  getInstagramMediaById,
  maybeRefreshInstagramAccessToken,
} from "../services/instagramService.js";

const num = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0
    ? parsed
    : 0;
};

const engagement = (m = {}) =>
  num(m.likes) +
  num(m.comments) +
  num(m.shares) +
  num(m.saves);

function integrationStatus() {
  return {
    meta: {
      label: "Facebook & Instagram",
      configured: Boolean(
        process.env.META_APP_ID &&
        process.env.META_APP_SECRET &&
        process.env.META_REDIRECT_URI
      ),
    },
    linkedin: {
      label: "LinkedIn",
      configured: Boolean(
        process.env.LINKEDIN_CLIENT_ID &&
        process.env.LINKEDIN_CLIENT_SECRET
      ),
    },
    tiktok: {
      label: "TikTok",
      configured: Boolean(
        process.env.TIKTOK_CLIENT_KEY &&
        process.env.TIKTOK_CLIENT_SECRET
      ),
    },
  };
}

function summary(posts) {
  const published = posts.filter(
    (p) => p.status === "published"
  );

  const out = {
    publishedPosts: published.length,
    impressions: 0,
    reach: 0,
    engagements: 0,
    clicks: 0,
    leads: 0,
    conversions: 0,
  };

  for (const post of published) {
    const m = post.metrics || {};
    out.impressions += num(m.impressions);
    out.reach += num(m.reach);
    out.engagements += engagement(m);
    out.clicks += num(m.clicks);
    out.leads += num(m.leads);
    out.conversions += num(m.conversions);
  }

  const audience = Math.max(
    out.reach,
    out.impressions,
    1
  );

  return {
    ...out,
    engagementRate:
      out.engagements / audience,
    clickRate:
      out.clicks / audience,
    leadRate:
      out.leads / Math.max(out.clicks, 1),
    conversionRate:
      out.conversions /
      Math.max(out.leads, 1),
  };
}

function groups(posts, field) {
  const map = new Map();

  for (const post of posts) {
    if (post.status !== "published") continue;

    const key =
      String(post[field] || "").trim() ||
      "Unclassified";

    const g =
      map.get(key) || {
        key,
        posts: 0,
        reach: 0,
        impressions: 0,
        engagements: 0,
        clicks: 0,
        leads: 0,
        conversions: 0,
      };

    const m = post.metrics || {};

    g.posts++;
    g.reach += num(m.reach);
    g.impressions += num(m.impressions);
    g.engagements += engagement(m);
    g.clicks += num(m.clicks);
    g.leads += num(m.leads);
    g.conversions += num(m.conversions);

    map.set(key, g);
  }

  return [...map.values()]
    .map((g) => ({
      ...g,
      engagementRate:
        g.engagements /
        Math.max(g.reach, g.impressions, 1),
    }))
    .sort(
      (a, b) =>
        b.conversions - a.conversions ||
        b.engagementRate -
          a.engagementRate
    );
}

function recommendations(posts) {
  const published = posts.filter(
    (p) => p.status === "published"
  );

  if (!published.length) {
    return [
      {
        id: "baseline",
        priority: "high",
        title: "Build the performance baseline",
        why:
          "There is not enough social performance data yet.",
        action:
          "Add recent published posts and their metrics or connect the social accounts.",
      },
    ];
  }

  const result = [];
  const formats = groups(posts, "format");
  const topics = groups(posts, "topic");
  const providers = groups(posts, "provider");
  const totals = summary(posts);

  if (formats[0]) {
    result.push({
      id: "format",
      priority: "high",
      title: `Create more ${formats[0].key} content`,
      why:
        `${formats[0].key} is currently the strongest tracked content format.`,
      action:
        `Publish another ${formats[0].key} post and compare it with the current baseline.`,
    });
  }

  const topic = topics.find(
    (x) => x.key !== "Unclassified"
  );

  if (topic) {
    result.push({
      id: "topic",
      priority: "high",
      title: `Build on "${topic.key}"`,
      why:
        `"${topic.key}" is currently one of the strongest tracked topics.`,
      action:
        `Create a follow-up post around a new question or client concern related to "${topic.key}".`,
    });
  }

  if (providers.length > 1 && providers[0]) {
    result.push({
      id: "channel",
      priority: "medium",
      title: `Prioritize ${providers[0].key}`,
      why:
        `${providers[0].key} currently has the strongest tracked results.`,
      action:
        `Give ${providers[0].key} priority in the next content cycle while continuing to test other channels.`,
    });
  }

  if (
    totals.reach >= 250 &&
    totals.clickRate < 0.01
  ) {
    result.push({
      id: "cta",
      priority: "high",
      title: "Strengthen the call to action",
      why:
        "The content is reaching people but relatively few are clicking.",
      action:
        "Test one clear call to action such as booking a consultation or starting a trial.",
    });
  }

  if (
    totals.clicks >= 10 &&
    totals.leadRate < 0.05
  ) {
    result.push({
      id: "journey",
      priority: "high",
      title: "Review the post-click journey",
      why:
        "Social content is generating clicks but relatively few tracked leads.",
      action:
        "Review the landing page, offer and lead form before increasing traffic.",
    });
  }

  return result.slice(0, 6);
}

export const getSocialDashboard = async (
  req,
  res,
  next
) => {
  try {
    // Automatic Instagram token maintenance.
    // A refresh failure must not prevent
    // the Social Media dashboard from loading.
    await maybeRefreshInstagramAccessToken()
      .catch(() => {});

    const [accounts, posts] =
      await Promise.all([
        SocialAccount.find({
          isArchived: false,
        }).sort({ createdAt: -1 }),

        SocialPost.find({
          isArchived: false,
        }).sort({ createdAt: -1 }),
      ]);

    res.json({
      success: true,
      integrations: integrationStatus(),
      accounts,
      posts,
      summary: summary(posts),
      recommendations:
        recommendations(posts),
      performance: {
        byProvider:
          groups(posts, "provider"),
        byFormat:
          groups(posts, "format"),
        byTopic:
          groups(posts, "topic"),
      },
    });
  } catch (error) {
    next(error);
  }
};

export const createSocialAccount = async (
  req,
  res,
  next
) => {
  try {
    const {
      provider,
      displayName,
      handle,
    } = req.body;

    if (
      !provider ||
      !displayName?.trim()
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Provider and account name are required.",
      });
    }

    const account =
      await SocialAccount.create({
        provider,
        displayName:
          displayName.trim(),
        handle:
          handle?.trim() || "",
      });

    res.status(201).json({
      success: true,
      account,
    });
  } catch (error) {
    next(error);
  }
};

export const createSocialPost = async (
  req,
  res,
  next
) => {
  try {
    const {
      provider,
      title,
      caption,
      format,
      topic,
    } = req.body;

    if (
      !provider ||
      !caption?.trim()
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Platform and caption are required.",
      });
    }

    const post =
      await SocialPost.create({
        provider,
        title:
          title?.trim() || "",
        caption:
          caption.trim(),
        format:
          format || "image",
        topic:
          topic?.trim() || "",
        createdBy:
          req.user?._id || null,
      });

    res.status(201).json({
      success: true,
      post,
    });
  } catch (error) {
    next(error);
  }
};

export const updateSocialPostStatus = async (
  req,
  res,
  next
) => {
  try {
    const allowed = [
      "draft",
      "approved",
      "scheduled",
      "published",
    ];

    if (
      !allowed.includes(
        req.body.status
      )
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid status.",
      });
    }

    const post =
      await SocialPost.findById(
        req.params.id
      );

    if (!post) {
      return res.status(404).json({
        success: false,
        message:
          "Social post not found.",
      });
    }

    post.status =
      req.body.status;

    if (
      post.status === "approved"
    ) {
      post.approvedBy =
        req.user?._id || null;
      post.approvedAt =
        new Date();
    }

    if (
      post.status === "published" &&
      !post.publishedAt
    ) {
      post.publishedAt =
        new Date();
    }

    await post.save();

    res.json({
      success: true,
      post,
    });
  } catch (error) {
    next(error);
  }
};

export const updateSocialMetrics = async (
  req,
  res,
  next
) => {
  try {
    const post =
      await SocialPost.findById(
        req.params.id
      );

    if (!post) {
      return res.status(404).json({
        success: false,
        message:
          "Social post not found.",
      });
    }

    const incoming =
      req.body.metrics ||
      req.body;

    const keys = [
      "impressions",
      "reach",
      "likes",
      "comments",
      "shares",
      "saves",
      "clicks",
      "leads",
      "conversions",
    ];

    for (const key of keys) {
      if (
        incoming[key] !==
        undefined
      ) {
        post.metrics[key] =
          num(incoming[key]);
      }
    }

    post.status =
      "published";

    if (!post.publishedAt) {
      post.publishedAt =
        new Date();
    }

    await post.save();

    res.json({
      success: true,
      post,
    });
  } catch (error) {
    next(error);
  }
};

export const publishInstagramPost = async (
  req,
  res,
  next
) => {
  try {
    const {
      caption,
      imageUrl,
      title,
      topic,
    } = req.body;

    if (!caption?.trim()) {
      return res.status(400).json({
        success: false,
        message:
          "Instagram caption is required.",
      });
    }

    if (!imageUrl?.trim()) {
      return res.status(400).json({
        success: false,
        message:
          "A publicly accessible image URL is required.",
      });
    }

    let parsedImageUrl;

    try {
      parsedImageUrl =
        new URL(imageUrl.trim());
    } catch {
      return res.status(400).json({
        success: false,
        message:
          "Image URL is invalid.",
      });
    }

    if (
      !["http:", "https:"].includes(
        parsedImageUrl.protocol
      )
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Image URL must use HTTP or HTTPS.",
      });
    }

    const account =
      await SocialAccount.findOne({
        provider: "instagram",
        status: "connected",
        isArchived: false,
      });

    if (!account) {
      return res.status(409).json({
        success: false,
        message:
          "Instagram is not connected.",
      });
    }

    const instagramUserId =
      account.externalAccountId;

    if (!instagramUserId) {
      return res.status(409).json({
        success: false,
        message:
          "Instagram account ID is missing.",
      });
    }

    const container =
      await createInstagramImageContainer({
        userId: instagramUserId,
        imageUrl:
          parsedImageUrl.toString(),
        caption:
          caption.trim(),
      });

    const containerId =
      container?.id;

    if (!containerId) {
      throw new Error(
        "Instagram did not return a media container ID."
      );
    }

    let status = "UNKNOWN";

    for (
      let attempt = 0;
      attempt < 20;
      attempt += 1
    ) {
      const result =
        await getInstagramContainerStatus(
          containerId
        );

      status =
        result?.status_code ||
        "UNKNOWN";

      if (status === "FINISHED") {
        break;
      }

      if (
        status === "ERROR" ||
        status === "EXPIRED"
      ) {
        throw new Error(
          `Instagram media processing returned ${status}.`
        );
      }

      await new Promise(
        (resolve) =>
          setTimeout(resolve, 3000)
      );
    }

    if (status !== "FINISHED") {
      throw new Error(
        "Instagram media processing timed out."
      );
    }

    const published =
      await publishInstagramContainer({
        userId:
          instagramUserId,
        creationId:
          containerId,
      });

    const externalPostId =
      published?.id;

    if (!externalPostId) {
      throw new Error(
        "Instagram did not return a published media ID."
      );
    }

    const live =
      await getInstagramMediaById(
        externalPostId
      );

    const post =
      await SocialPost.create({
        account:
          account._id,
        provider:
          "instagram",
        externalPostId,
        externalUrl:
          live?.permalink || "",
        mediaUrl:
          parsedImageUrl.toString(),
        title:
          title?.trim() || "",
        caption:
          caption.trim(),
        format:
          "image",
        topic:
          topic?.trim() || "",
        status:
          "published",
        publishedAt:
          live?.timestamp
            ? new Date(
                live.timestamp
              )
            : new Date(),
        createdBy:
          req.user?._id || null,
        metrics: {
          likes:
            Number(
              live?.like_count
            ) || 0,
          comments:
            Number(
              live?.comments_count
            ) || 0,
        },
      });

    account.lastSyncedAt =
      new Date();

    await account.save();

    res.status(201).json({
      success: true,
      message:
        "Instagram post published successfully.",
      post,
      instagram: {
        id:
          externalPostId,
        permalink:
          live?.permalink ||
          "",
        mediaType:
          live?.media_type ||
          "",
        timestamp:
          live?.timestamp ||
          null,
      },
    });
  } catch (error) {
    next(error);
  }
};
