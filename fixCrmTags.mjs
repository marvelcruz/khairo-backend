import dotenv from "dotenv";
import mongoose from "mongoose";

dotenv.config();

const SOURCE_URI = process.env.FITLUNGE_MONGO_URI;
const TARGET_URI = process.env.MONGO_URI;

const sourceConn = mongoose.createConnection(SOURCE_URI);
const targetConn = mongoose.createConnection(TARGET_URI);
await sourceConn.asPromise();
await targetConn.asPromise();

const sourceColl = sourceConn.db.collection("crmtags");
const targetColl = targetConn.db.collection("crmtags");

// Clear Khairo tags (seeded defaults) so we can copy FitLunge's exactly
await targetColl.deleteMany({});
console.log("Cleared existing Khairo crmtags.");

const docs = await sourceColl.find({}).toArray();
for (const doc of docs) {
  const { _id, ...rest } = doc;
  await targetColl.insertOne({ _id, ...rest });
}
console.log(`✅ Copied ${docs.length} crmtags from FitLunge to Khairo.`);

await sourceConn.close();
await targetConn.close();
process.exit(0);
