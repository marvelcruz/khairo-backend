import dotenv from "dotenv";
import mongoose from "mongoose";
import Client from "./models/Client.js";

dotenv.config();
await mongoose.connect(process.env.MONGO_URI);

const result = await Client.updateMany({}, { $set: { portalActive: true } });
console.log(`✅ Activated portal access for ${result.modifiedCount} clients.`);

await mongoose.disconnect();
process.exit(0);
