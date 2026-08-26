import dotenv from "dotenv";
import mongoose from "mongoose";
import { connectDB } from "./config/db.js";
import User from "./models/User.js";

dotenv.config();

const ADMIN_EMAIL = "admin@khairodietclinic.com";
const ADMIN_PASSWORD = "YourStrongPassword123"; // CHANGE THIS
const ADMIN_NAME = "Admin";

const replacements = [
  ["khairo Diet Clnic", "Khairo Diet Clinic"],
  ["khairo Diet Clinic", "Khairo Diet Clinic"],
  ["FITLUNGE", "KHAIRO"],
  ["FIT LUNGE", "KHAIRO"],
  ["FitLunge", "Khairo Diet Clinic"],
  ["fitlunge", "khairo"],
  ["FIT", "KHAIRO"],
  ["LUNGE", ""],
];

const deepReplace = (obj) => {
  if (typeof obj === "string") {
    let newStr = obj;
    for (const [from, to] of replacements) {
      newStr = newStr.split(from).join(to);
    }
    return newStr;
  }
  if (Array.isArray(obj)) {
    return obj.map((item) => deepReplace(item));
  }
  if (obj && typeof obj === "object") {
    for (const key of Object.keys(obj)) {
      if (key === "_id") continue; // never touch IDs
      obj[key] = deepReplace(obj[key]);
    }
  }
  return obj;
};

const fixDatabase = async () => {
  await connectDB();
  console.log("Connected to MongoDB.\n");

  // 1. Create admin if not exists
  const existingAdmin = await User.findOne({ email: ADMIN_EMAIL.toLowerCase() });
  if (existingAdmin) {
    console.log(`Admin already exists (${ADMIN_EMAIL}). Skipping creation.`);
  } else {
    await User.create({
      name: ADMIN_NAME,
      email: ADMIN_EMAIL.toLowerCase(),
      password: ADMIN_PASSWORD,
      role: "admin",
    });
    console.log(`✅ Admin created: ${ADMIN_EMAIL} / ${ADMIN_PASSWORD}`);
  }

  // 2. Fix old branding in all collections
  const collections = await mongoose.connection.db.listCollections().toArray();
  for (const coll of collections) {
    const collName = coll.name;
    const model = mongoose.connection.db.collection(collName);
    const docs = await model.find({}).toArray();

    for (const doc of docs) {
      const updated = deepReplace(doc);
      const originalStr = JSON.stringify(doc);
      const updatedStr = JSON.stringify(updated);
      if (originalStr !== updatedStr) {
        await model.replaceOne({ _id: doc._id }, updated);
        console.log(`Fixed document in ${collName} (id: ${doc._id})`);
      }
    }
  }

  console.log("\n🎉 Database cleanup complete.");
  await mongoose.disconnect();
  process.exit(0);
};

fixDatabase().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
