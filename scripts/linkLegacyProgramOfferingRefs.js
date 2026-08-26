import dotenv from "dotenv";
import mongoose from "mongoose";
import CatalogueItem from "../models/CatalogueItem.js";
import Client from "../models/Client.js";
import Application from "../models/Application.js";
import Subscription from "../models/Subscription.js";
import Order from "../models/Order.js";
import CrmContact from "../models/CrmContact.js";
import CrmOpportunity from "../models/CrmOpportunity.js";

dotenv.config();

const APPLY = process.argv.includes("--apply");
const DRY_RUN = !APPLY;

const MODEL_LINKS = [
  { label: "Clients", model: Client, legacyField: "program", refField: "programOffering" },
  { label: "Applications selected programme", model: Application, legacyField: "program", refField: "programOffering" },
  { label: "Applications programme interest", model: Application, legacyField: "programInterest", refField: "programInterestOffering" },
  { label: "Subscriptions", model: Subscription, legacyField: "program", refField: "offering" },
  { label: "Orders", model: Order, legacyField: "program", refField: "offering" },
  { label: "CRM contacts", model: CrmContact, legacyField: "programInterest", refField: "programInterestOffering" },
  { label: "CRM opportunities", model: CrmOpportunity, legacyField: "programInterest", refField: "programInterestOffering" },
];

function validLegacyKey(value) {
  const key = String(value || "").trim().toLowerCase();
  return key && key !== "not_sure" ? key : null;
}

async function loadProgrammeMap() {
  const items = await CatalogueItem.find({
    type: "program",
    "legacySource.sourceType": "pricing_program",
    "legacySource.sourceKey": { $type: "string" },
  })
    .select("_id name slug legacySource.sourceKey isActive")
    .lean();

  const map = new Map();
  for (const item of items) {
    const key = validLegacyKey(item.legacySource?.sourceKey);
    if (!key) continue;
    if (map.has(key)) {
      throw new Error(`Duplicate catalogue mapping for legacy programme key "${key}".`);
    }
    map.set(key, item);
  }
  return map;
}

async function analyseLink(link, programmeMap) {
  const values = await link.model.aggregate([
    { $match: { [link.legacyField]: { $exists: true, $nin: [null, "", "not_sure"] } } },
    {
      $group: {
        _id: `$${link.legacyField}`,
        total: { $sum: 1 },
        alreadyLinked: {
          $sum: {
            $cond: [
              { $ne: [{ $ifNull: [`$${link.refField}`, null] }, null] },
              1,
              0,
            ],
          },
        },
      },
    },
    { $sort: { _id: 1 } },
  ]);

  const rows = [];
  for (const value of values) {
    const key = validLegacyKey(value._id);
    if (!key) continue;
    const offering = programmeMap.get(key);
    rows.push({
      key,
      total: value.total,
      alreadyLinked: value.alreadyLinked,
      unlinked: value.total - value.alreadyLinked,
      offering,
    });
  }
  return rows;
}

async function applyLink(link, key, offeringId) {
  return link.model.updateMany(
    {
      [link.legacyField]: key,
      $or: [
        { [link.refField]: { $exists: false } },
        { [link.refField]: null },
      ],
    },
    { $set: { [link.refField]: offeringId } }
  );
}

async function main() {
  if (!process.env.MONGO_URI) throw new Error("MONGO_URI is not configured.");
  await mongoose.connect(process.env.MONGO_URI);

  console.log("============================================================");
  console.log("LEGACY PROGRAMME -> CATALOGUE REFERENCE LINKER");
  console.log(DRY_RUN ? "DRY RUN - NO DATABASE WRITES" : "APPLY MODE");
  console.log("============================================================");

  const programmeMap = await loadProgrammeMap();
  if (programmeMap.size === 0) {
    throw new Error("No migrated catalogue programmes were found.");
  }

  console.log(`Catalogue programme mappings: ${programmeMap.size}`);
  for (const [key, item] of programmeMap) {
    console.log(`  ${key} -> ${item.name} (${item._id})`);
  }

  let totalWouldLink = 0;
  let totalLinked = 0;
  let missingMappings = 0;

  for (const link of MODEL_LINKS) {
    console.log("");
    console.log(link.label);
    console.log("------------------------------------------------------------");

    const rows = await analyseLink(link, programmeMap);
    if (rows.length === 0) {
      console.log("No legacy programme values found.");
      continue;
    }

    for (const row of rows) {
      if (!row.offering) {
        console.log(`  ${row.key}: ${row.total} record(s) - STOP: no catalogue mapping`);
        missingMappings += row.unlinked;
        continue;
      }

      console.log(
        `  ${row.key}: ${row.total} total, ${row.alreadyLinked} already linked, ${row.unlinked} to link -> ${row.offering.name}`
      );
      totalWouldLink += row.unlinked;

      if (APPLY && row.unlinked > 0) {
        const result = await applyLink(link, row.key, row.offering._id);
        totalLinked += result.modifiedCount;
      }
    }
  }

  if (missingMappings > 0) {
    throw new Error(
      `${missingMappings} unlinked record(s) use legacy programme keys with no catalogue mapping. Nothing should be committed until resolved.`
    );
  }

  console.log("");
  console.log("------------------------------------------------------------");
  console.log(`Would link / linked: ${APPLY ? totalLinked : totalWouldLink}`);
  console.log("Legacy programme strings were not changed.");
  console.log("Catalogue programme records were not changed.");
  console.log("Payments were not changed.");
  console.log("No application, subscription, order, CRM, or client behaviour was changed.");
  if (DRY_RUN) console.log("NO DATABASE WRITES PERFORMED.");
  else console.log("CATALOGUE REFERENCES LINKED.");
}

main()
  .catch((error) => {
    console.error("STOP:", error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect().catch(() => {});
  });
