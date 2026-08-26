import dotenv from "dotenv";
import mongoose from "mongoose";

dotenv.config();

const SOURCE_URI = process.env.FITLUNGE_MONGO_URI;
const TARGET_URI = process.env.MONGO_URI;

const sourceConn = mongoose.createConnection(SOURCE_URI);
const targetConn = mongoose.createConnection(TARGET_URI);

await sourceConn.asPromise();
await targetConn.asPromise();

console.log("Source collections (FitLunge):");
const sourceColls = await sourceConn.db.listCollections().toArray();
sourceColls.forEach(c => console.log(" -", c.name));

console.log("\nTarget collections (Khairo):");
const targetColls = await targetConn.db.listCollections().toArray();
targetColls.forEach(c => console.log(" -", c.name));

await sourceConn.close();
await targetConn.close();
process.exit(0);
