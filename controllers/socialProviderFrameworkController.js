import SocialAccount from "../models/SocialAccount.js";

const PROVIDERS = [
  {
    provider: "instagram",
    label: "Instagram",
    description:
      "Posts, reels, stories, engagement and account insights.",
    capabilities: {
      publishing: true,
      analytics: true,
      scheduling: true,
      media: true,
      reconnect: true,
    },
    adapterStatus: "live",
  },
  {
    provider: "facebook",
    label: "Facebook",
    description:
      "Page publishing, scheduled content and performance insights.",
    capabilities: {
      publishing: true,
      analytics: true,
      scheduling: true,
      media: true,
      reconnect: true,
    },
    adapterStatus: "ready_to_connect",
  },
  {
    provider: "linkedin",
    label: "LinkedIn",
    description:
      "Business posts, thought leadership and engagement reporting.",
    capabilities: {
      publishing: true,
      analytics: true,
      scheduling: true,
      media: true,
      reconnect: true,
    },
    adapterStatus: "ready_to_connect",
  },
  {
    provider: "tiktok",
    label: "TikTok",
    description:
      "Short-form video publishing and performance reporting.",
    capabilities: {
      publishing: true,
      analytics: true,
      scheduling: true,
      media: true,
      reconnect: true,
    },
    adapterStatus: "ready_to_connect",
  },
  {
    provider: "google_business",
    label: "Google Business",
    description:
      "Business updates, offers and local visibility reporting.",
    capabilities: {
      publishing: true,
      analytics: true,
      scheduling: true,
      media: true,
      reconnect: true,
    },
    adapterStatus: "ready_to_connect",
  },
];

export const getSocialProviderFramework = async (
  req,
  res,
  next
) => {
  try {
    const accounts =
      await SocialAccount.find({
        isArchived: false,
      }).lean();

    const providers =
      PROVIDERS.map((definition) => {
        const account =
          accounts.find(
            (item) =>
              item.provider ===
              definition.provider
          );

        return {
          ...definition,
          connection: {
            status:
              account?.status ||
              "not_connected",

            displayName:
              account?.displayName ||
              "",

            handle:
              account?.handle ||
              "",

            externalAccountId:
              account?.externalAccountId ||
              "",

            connectedAt:
              account?.connectedAt ||
              null,

            lastSyncedAt:
              account?.lastSyncedAt ||
              null,

            tokenExpiresAt:
              account?.tokenExpiresAt ||
              null,

            lastTokenRefreshAt:
              account?.lastTokenRefreshAt ||
              null,

            connectionError:
              account?.connectionError ||
              "",
          },
        };
      });

    res.json({
      success: true,
      providers,
    });
  } catch (error) {
    next(error);
  }
};
