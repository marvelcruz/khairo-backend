import dotenv from "dotenv";
import mongoose from "mongoose";
import User from "./models/User.js";

dotenv.config();
await mongoose.connect(process.env.MONGO_URI);

const updates = [
  { email: "admin@khairodietclinic.com", roles: ["admin"], permissions: [] },
  { email: "doctor@khairodietclinic.com", roles: ["doctor"], permissions: ["view_clients", "view_contact_info", "view_coaching", "view_medical_review"] },
];

for (const u of updates) {
  const user = await User.findOneAndUpdate(
    { email: u.email },
    { $set: { roles: u.roles, permissions: u.permissions } },
    { upsert: true, new: true }
  );
  console.log(`✅ Fixed ${user.email}: roles=${user.roles}, permissions=${user.permissions}`);
}

await mongoose.disconnect();
process.exit(0);
