import dotenv from "dotenv";
import mongoose from "mongoose";

dotenv.config();

const SOURCE_URI = process.env.FITLUNGE_MONGO_URI;
const TARGET_URI = process.env.MONGO_URI;

if (!SOURCE_URI || !TARGET_URI) {
  console.error("Missing FITLUNGE_MONGO_URI or MONGO_URI");
  process.exit(1);
}

const collectionsToCopy = [
  "workflowdefinitions",
  "crmtags",
  "formdefinitions",
  "pricings",
  "catalogueitems",
  "websitecontents",
  "businesssettings",
  "sops",
  "messagetemplates",
  "customfielddefinitions",
  "automationsettings",
];

const sourceConn = mongoose.createConnection(SOURCE_URI);
const targetConn = mongoose.createConnection(TARGET_URI);

await sourceConn.asPromise();
await targetConn.asPromise();

console.log("Connected to both databases.\n");

const sourceDb = sourceConn.db;
const targetDb = targetConn.db;

for (const collName of collectionsToCopy) {
  try {
    const sourceColl = sourceDb.collection(collName);
    const targetColl = targetDb.collection(collName);

    const docs = await sourceColl.find({}).toArray();

    if (docs.length === 0) {
      console.log(`No documents in ${collName}, skipping.`);
      continue;
    }

    let copied = 0;
    for (const doc of docs) {
      const { _id, ...rest } = doc;
      await targetColl.updateOne(
        { _id: _id },
        { $set: rest },
        { upsert: true }
      );
      copied++;
    }

    console.log(`✅ ${collName}: copied/updated ${copied} docs.`);
  } catch (err) {
    console.log(`⚠️ ${collName}: ${err.message}`);
  }
}

await sourceConn.close();
await targetConn.close();
console.log("\n🎉 Migration complete.");
process.exit(0);
