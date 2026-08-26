import "dotenv/config";

import mongoose from "mongoose";

import {
  saveInstagramAccessToken,
  getInstagramConnectionState,
} from "../services/instagramTokenStore.js";

try {
  if (!process.env.MONGO_URI) {
    throw new Error(
      "MONGO_URI is missing."
    );
  }

  if (
    !process.env.INSTAGRAM_ACCESS_TOKEN
  ) {
    throw new Error(
      "INSTAGRAM_ACCESS_TOKEN is missing."
    );
  }

  await mongoose.connect(
    process.env.MONGO_URI
  );

  await saveInstagramAccessToken(
    process.env.INSTAGRAM_ACCESS_TOKEN,
    60 * 24 * 60 * 60
  );

  const state =
    await getInstagramConnectionState();

  console.log(
    "PASS: Current Instagram token encrypted in MongoDB."
  );

  console.log(
    `Account: @${state.handle}`
  );

  console.log(
    `Status: ${state.status}`
  );

  console.log(
    `Days remaining: ${state.daysRemaining}`
  );

  console.log(
    `Automatic refresh begins at 10 days remaining.`
  );
} catch (error) {
  console.error(
    "FAIL:",
    error.message
  );

  process.exitCode = 1;
} finally {
  await mongoose
    .disconnect()
    .catch(() => {});
}
