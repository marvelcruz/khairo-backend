import dotenv from "dotenv";
import mongoose from "mongoose";
import { pathToFileURL } from "url";
import Pricing from "../models/Pricing.js";
import CatalogueItem from "../models/CatalogueItem.js";
import {
  extractProgramsFromPricing,
  buildNewCataloguePayload,
} from "../utils/pricingCatalogueBridge.js";

dotenv.config();

function describeChanges(existing, program) {
  const changes = [];
  if (existing.name !== program.name) changes.push(`name: ${JSON.stringify(existing.name)} -> ${JSON.stringify(program.name)}`);
  if (Number(existing.price) !== Number(program.price)) changes.push(`price: ${existing.price} -> ${program.price}`);
  if (Number(existing.durationWeeks) !== Number(program.weeks)) changes.push(`durationWeeks: ${existing.durationWeeks} -> ${program.weeks}`);
  if (Boolean(existing.isFeatured) !== Boolean(program.popular)) changes.push(`isFeatured: ${Boolean(existing.isFeatured)} -> ${Boolean(program.popular)}`);
  if (existing.type !== "program") changes.push(`type: ${existing.type} -> program`);
  return changes;
}

async function uniqueMigrationSlug(base, source) {
  let candidate = base;
  let suffix = 2;

  while (true) {
    const existing = await CatalogueItem.findOne({ slug: candidate }).select("legacySource").lean();
    if (!existing) return candidate;

    const sameSource =
      existing.legacySource?.sourceType === source.sourceType &&
      String(existing.legacySource?.sourceId || "") === String(source.sourceId || "") &&
      existing.legacySource?.sourceKey === source.sourceKey;

    if (sameSource) return candidate;
    candidate = `${base}-${suffix++}`;
  }
}

async function run() {
  const wantsApply = process.argv.includes("--apply");
  const wantsDryRun = process.argv.includes("--dry-run") || !wantsApply;

  if (wantsApply && process.argv.includes("--dry-run")) {
    throw new Error("Choose either --dry-run or --apply, not both.");
  }

  if (!process.env.MONGO_URI) {
    throw new Error("MONGO_URI is not configured.");
  }

  // Keep --dry-run genuinely read-only, including index metadata.
  await mongoose.connect(process.env.MONGO_URI, { autoIndex: false });

  const rawPricing = await Pricing.collection.findOne({});
  if (!rawPricing) {
    throw new Error("No Pricing record exists. Nothing can be migrated.");
  }

  const { sourceMode, programs } = extractProgramsFromPricing(rawPricing);
  if (!programs.length) {
    throw new Error("Pricing contains no programs that can be migrated.");
  }

  console.log("============================================================");
  console.log("PRICING -> CATALOGUE PROGRAM BRIDGE");
  console.log(wantsDryRun ? "DRY RUN - NO DATABASE WRITES" : "APPLY MODE");
  console.log("============================================================");
  console.log(`Pricing record: ${rawPricing._id}`);
  console.log(`Source mode: ${sourceMode}`);
  console.log(`Programs found: ${programs.length}`);
  if (sourceMode === "legacy_scalars") {
    console.log("Legacy names/durations/featured flags come from the current Pricing model defaults.");
  }
  console.log("");

  const summary = { create: 0, update: 0, unchanged: 0 };

  for (let index = 0; index < programs.length; index += 1) {
    const program = programs[index];
    const source = {
      sourceType: "pricing_program",
      sourceKey: program.key,
      sourceId: rawPricing._id,
    };

    const existing = await CatalogueItem.findOne({
      "legacySource.sourceType": source.sourceType,
      "legacySource.sourceKey": source.sourceKey,
      "legacySource.sourceId": source.sourceId,
    });

    console.log(`${index + 1}. ${program.name} [${program.key}]`);
    console.log(`   Price: ₦${Number(program.price).toLocaleString("en-NG")}`);
    console.log(`   Duration: ${program.weeks} weeks`);
    console.log(`   Featured: ${program.popular ? "yes" : "no"}`);

    if (!existing) {
      summary.create += 1;
      console.log("   Action: CREATE private catalogue program");

      if (!wantsDryRun) {
        const payload = buildNewCataloguePayload(program, rawPricing._id, index);
        payload.slug = await uniqueMigrationSlug(payload.slug, source);
        await CatalogueItem.create(payload);
        console.log(`   Created slug: ${payload.slug}`);
      }

      console.log("");
      continue;
    }

    const changes = describeChanges(existing, program);
    if (!changes.length) {
      summary.unchanged += 1;
      console.log(`   Action: UNCHANGED (${existing.slug})`);
      console.log("");
      continue;
    }

    summary.update += 1;
    console.log(`   Action: UPDATE linked catalogue item (${existing.slug})`);
    for (const change of changes) console.log(`   - ${change}`);

    if (!wantsDryRun) {
      existing.name = program.name;
      existing.type = "program";
      existing.price = program.price;
      existing.durationWeeks = program.weeks;
      existing.isFeatured = Boolean(program.popular);
      // Intentionally preserve slug, visibility, archive state, billing and sort order.
      await existing.save();
    }

    console.log("");
  }

  console.log("------------------------------------------------------------");
  console.log(`Would create / created: ${summary.create}`);
  console.log(`Would update / updated: ${summary.update}`);
  console.log(`Unchanged: ${summary.unchanged}`);
  console.log("------------------------------------------------------------");
  console.log("Existing Pricing was not changed.");
  console.log("Clients were not changed.");
  console.log("Applications were not changed.");
  console.log("Subscriptions were not changed.");
  console.log("Orders were not changed.");
  console.log("Payments were not changed.");
  console.log("Migrated catalogue programs remain private.");

  if (wantsDryRun) {
    console.log("NO DATABASE WRITES PERFORMED.");
    console.log("Run with --apply only after reviewing this output.");
  } else {
    console.log("CATALOGUE PROGRAM BRIDGE APPLIED.");
  }
}

const invokedDirectly =
  process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;

if (invokedDirectly) {
  run()
    .catch((error) => {
      console.error("STOP:", error.message);
      process.exitCode = 1;
    })
    .finally(async () => {
      await mongoose.disconnect().catch(() => {});
    });
}
