import mongoose from "mongoose";

const RETRY_DELAY_MS = Math.max(
  5000,
  Number(process.env.MONGO_RETRY_DELAY_MS || 10000)
);
const SERVER_SELECTION_TIMEOUT_MS = Math.max(
  3000,
  Number(process.env.MONGO_SERVER_SELECTION_TIMEOUT_MS || 8000)
);

let retryTimer = null;
let connecting = false;

export const connectDB = async () => {
  if (mongoose.connection.readyState === 1) {
    return mongoose.connection;
  }

  if (connecting) {
    return null;
  }

  connecting = true;

  try {
    const conn = await mongoose.connect(
      process.env.MONGO_URI,
      {
        ...(process.env.KHAIRO_CRM_QA_DB
          ? { dbName: process.env.KHAIRO_CRM_QA_DB }
          : {}),
        serverSelectionTimeoutMS: SERVER_SELECTION_TIMEOUT_MS,
      }
    );

    console.log(`MongoDB connected: ${conn.connection.host}`);
    return conn.connection;
  } catch (err) {
    console.error(`MongoDB connection error: ${err.message}`);

    if (!retryTimer) {
      retryTimer = setTimeout(() => {
        retryTimer = null;
        void connectDB();
      }, RETRY_DELAY_MS);
      retryTimer.unref?.();
    }

    return null;
  } finally {
    connecting = false;
  }
};
