import CatalogueItem from "../models/CatalogueItem.js";
import Pricing from "../models/Pricing.js";

const DEFAULT_LEGACY_PROGRAMS = [
  { key: "core", name: "Core", weeks: 8, popular: false },
  { key: "plus", name: "Plus", weeks: 12, popular: true },
  { key: "vip", name: "VIP", weeks: 12, popular: false },
];

function legacyKey(item) {
  return (
    item?.legacySource?.sourceKey ||
    String(item?.key || item?.slug || item?.name || "")
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
  );
}

function mapCatalogueItemToProgram(item) {
  return {
    key: legacyKey(item),
    name: item.name,
    price: Number(item.price || 0),
    weeks: Number(item.durationWeeks || 12),
    popular: Boolean(item.isFeatured),
    catalogueItemId: String(item._id),
  };
}

export async function listCataloguePrograms() {
  const items = await CatalogueItem.find({
    type: "program",
    isActive: true,
  })
    .sort({ sortOrder: 1, name: 1 })
    .lean();

  return items.map(mapCatalogueItemToProgram);
}

export async function ensureLegacyCataloguePrograms() {
  const pricing = await Pricing.findOne().lean();
  if (!pricing) return { created: 0 };

  const sourcePrograms = [];

  if (Array.isArray(pricing.programs) && pricing.programs.length > 0) {
    sourcePrograms.push(
      ...pricing.programs.map((program) => ({
        key: program.key,
        name: program.name,
        price: Number(program.price || 0),
        weeks: Number(program.weeks || 12),
        popular: Boolean(program.popular),
      }))
    );
  } else {
    sourcePrograms.push(
      ...DEFAULT_LEGACY_PROGRAMS.filter(
        (program) => pricing[program.key] !== undefined
      ).map((program) => ({
        ...program,
        price: Number(pricing[program.key] || 0),
      }))
    );
  }

  let created = 0;

  for (const program of sourcePrograms) {
    const existing = await CatalogueItem.findOne({
      "legacySource.sourceType": "pricing_program",
      "legacySource.sourceKey": program.key,
    });

    if (!existing) {
      await CatalogueItem.create({
        name: program.name,
        slug: `program-${program.key}`,
        type: "program",
        price: program.price,
        currency: "NGN",
        billing: {
          type: "one_time",
          interval: null,
          intervalCount: 1,
          cycleDays: null,
        },
        durationWeeks: program.weeks,
        isActive: true,
        isPublic: false,
        isFeatured: program.popular,
        legacySource: {
          sourceType: "pricing_program",
          sourceKey: program.key,
          sourceId: pricing._id,
        },
      });
      created += 1;
    }
  }

  return { created };
}
