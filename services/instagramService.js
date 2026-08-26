import {
  getInstagramAccessToken,
  maybeRefreshInstagramAccessToken,
} from "./instagramTokenStore.js";

const API =
  "https://graph.instagram.com";

async function instagramRequest(
  path,
  params = {},
  options = {}
) {
  await maybeRefreshInstagramAccessToken();

  const accessToken =
    await getInstagramAccessToken();

  const url =
    new URL(`${API}${path}`);

  for (
    const [key, value]
    of Object.entries(params)
  ) {
    if (
      value !== undefined &&
      value !== null
    ) {
      url.searchParams.set(
        key,
        String(value)
      );
    }
  }

  url.searchParams.set(
    "access_token",
    accessToken
  );

  const response =
    await fetch(url, {
      method:
        options.method || "GET",
    });

  let data;

  try {
    data =
      await response.json();
  } catch {
    data = {};
  }

  if (
    !response.ok ||
    data.error
  ) {
    const source =
      data.error || {};

    const error =
      new Error(
        source.message ||
          `Instagram API returned HTTP ${response.status}.`
      );

    error.status =
      response.status;

    error.instagramCode =
      source.code;

    error.instagramSubcode =
      source.error_subcode;

    throw error;
  }

  return data;
}

export async function getInstagramAccount() {
  return instagramRequest(
    "/me",
    {
      fields:
        "user_id,username,followers_count,follows_count,media_count",
    }
  );
}

export async function getInstagramMedia(
  limit = 25
) {
  return instagramRequest(
    "/me/media",
    {
      fields:
        "id,caption,media_type,media_product_type,permalink,timestamp,like_count,comments_count",
      limit,
    }
  );
}

export async function getInstagramPublishingLimit() {
  return instagramRequest(
    "/me/content_publishing_limit",
    {
      fields:
        "config,quota_usage",
    }
  );
}

export async function getInstagramAccountInsights() {
  return instagramRequest(
    "/me/insights",
    {
      metric:
        "reach,views",
      period: "day",
      metric_type:
        "total_value",
    }
  );
}

export async function getInstagramMediaInsights(
  mediaId
) {
  return instagramRequest(
    `/${mediaId}/insights`,
    {
      metric:
        "reach,total_interactions",
    }
  );
}

export async function createInstagramImageContainer({
  userId,
  imageUrl,
  caption = "",
}) {
  return instagramRequest(
    `/${userId}/media`,
    {
      image_url: imageUrl,
      caption,
    },
    {
      method: "POST",
    }
  );
}

export async function getInstagramContainerStatus(
  containerId
) {
  return instagramRequest(
    `/${containerId}`,
    {
      fields:
        "status_code,status",
    }
  );
}

export async function publishInstagramContainer({
  userId,
  creationId,
}) {
  return instagramRequest(
    `/${userId}/media_publish`,
    {
      creation_id:
        creationId,
    },
    {
      method: "POST",
    }
  );
}

export async function getInstagramMediaById(
  mediaId
) {
  return instagramRequest(
    `/${mediaId}`,
    {
      fields:
        "id,caption,media_type,media_product_type,permalink,timestamp,like_count,comments_count",
    }
  );
}

export {
  maybeRefreshInstagramAccessToken,
};
