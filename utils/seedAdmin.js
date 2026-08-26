import dotenv from "dotenv";
import mongoose from "mongoose";
import { connectDB } from "../config/db.js";
import User from "../models/User.js";

dotenv.config();

const seed = async () => {
  await connectDB();

  const email = process.env.SEED_ADMIN_EMAIL;
  const password = process.env.SEED_ADMIN_PASSWORD;
  const name = process.env.SEED_ADMIN_NAME || "Admin";

  if (!email || !password) {
    console.error("SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD must be set in .env");
    process.exit(1);
  }

  const existing = await User.findOne({ email: email.toLowerCase() });
  if (existing) {
    console.log(`Admin account already exists for ${email}. No changes made.`);
    process.exit(0);
  }

  await User.create({ name, email: email.toLowerCase(), password, role: "admin" });

  console.log(`Admin account created for ${email}.`);
  console.log("IMPORTANT: log in and change this password immediately, then remove SEED_ADMIN_PASSWORD from .env.");

  await mongoose.disconnect();
  process.exit(0);
};

seed();
