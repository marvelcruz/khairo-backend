import "dotenv/config";
import mongoose from "mongoose";

import SocialAccount from
  "../models/SocialAccount.js";

import {
  getInstagramAccount,
  getInstagramPublishingLimit,
} from "../services/instagramService.js";

const run = async () => {
  if (!process.env.MONGO_URI) {
    throw new Error(
      "MONGO_URI is not configured."
    );
  }

  console.log(
    "Connecting Khairo Diet Clinic to Instagram..."
  );

  const instagram =
    await getInstagramAccount();

  const userId =
    String(
      instagram.user_id ||
      instagram.id ||
      ""
    );

  const username =
    String(
      instagram.username ||
      ""
    ).trim();

  if (
    username !==
    "be_comingmarvel"
  ) {
    throw new Error(
      `Unexpected Instagram account: ${username}`
    );
  }

  if (
    userId !==
    "17841400539723341"
  ) {
    throw new Error(
      `Unexpected Instagram user ID: ${userId}`
    );
  }

  const quota =
    await getInstagramPublishingLimit();

  await mongoose.connect(
    process.env.MONGO_URI
  );

  const existingAccounts =
    await SocialAccount.find({
      provider: "instagram",
      isArchived: false,
    });

  let account =
    existingAccounts.find(
      (item) =>
        item.externalAccountId ===
          userId ||
        item.handle
          ?.replace(/^@/, "")
          .toLowerCase() ===
          username.toLowerCase()
    );

  if (
    !account &&
    existingAccounts.length === 1
  ) {
    account =
      existingAccounts[0];
  }

  if (
    !account &&
    existingAccounts.length > 1
  ) {
    throw new Error(
      "Multiple Instagram SocialAccount records exist and none matches be_comingmarvel. No record was changed."
    );
  }

  if (!account) {
    account =
      new SocialAccount({
        provider:
          "instagram",
      });
  }

  account.displayName =
    "Instagram - be_comingmarvel";

  account.handle =
    username;

  account.externalAccountId =
    userId;

  account.status =
    "connected";

  account.connectedAt =
    account.connectedAt ||
    new Date();

  account.lastSyncedAt =
    new Date();

  account.isArchived =
    false;

  await account.save();

  const quotaRecord =
    quota?.data?.[0];

  console.log("");
  console.log(
    "=========================================="
  );
  console.log(
    "FITLUNGE INSTAGRAM CONNECTION PASSED"
  );
  console.log(
    "=========================================="
  );
  console.log(
    "Provider:       instagram"
  );
  console.log(
    `Account:        @${username}`
  );
  console.log(
    `Instagram ID:   ${userId}`
  );
  console.log(
    `Khairo Diet Clinic ID:    ${account._id}`
  );
  console.log(
    `Status:         ${account.status}`
  );
  console.log(
    `Followers:      ${instagram.followers_count ?? "unknown"}`
  );
  console.log(
    `Media count:    ${instagram.media_count ?? "unknown"}`
  );

  if (quotaRecord) {
    console.log(
      `Publish quota:  ${quotaRecord.quota_usage ?? "?"}/${quotaRecord.config?.quota_total ?? "?"}`
    );
  }

  console.log(
    `Connected at:   ${account.connectedAt.toISOString()}`
  );
  console.log(
    `Last synced:    ${account.lastSyncedAt.toISOString()}`
  );
  console.log(
    "Token stored:   server-side only"
  );
  console.log(
    "=========================================="
  );
};

try {
  await run();
} catch (error) {
  console.error("");
  console.error(
    "FITLUNGE INSTAGRAM CONNECTION FAILED"
  );
  console.error(
    error.message
  );

  if (error.instagramCode) {
    console.error(
      `Instagram code: ${error.instagramCode}`
    );
  }

  process.exitCode = 1;
} finally {
  await mongoose
    .disconnect()
    .catch(() => {});
}
