const LEGACY_PROGRAM_DEFAULTS = [
  { key: "core", name: "Core", weeks: 8, popular: false },
  { key: "plus", name: "Plus", weeks: 12, popular: true },
  { key: "vip", name: "VIP", weeks: 12, popular: false },
];

const DEFAULT_BY_KEY = new Map(
  LEGACY_PROGRAM_DEFAULTS.map((program) => [program.key, program])
);

function normalizeKey(value) {
  return String(value || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "") || "program";
}

function slugPart(value) {
  return String(value || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "program";
}

function finiteNonNegative(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function positiveWeeks(value, fallback = 12) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 1 ? n : fallback;
}

export function extractProgramsFromPricing(rawPricing) {
  if (!rawPricing) return { sourceMode: "none", programs: [] };

  if (Array.isArray(rawPricing.programs) && rawPricing.programs.length > 0) {
    const seen = new Set();
    const programs = [];

    for (const entry of rawPricing.programs) {
      const key = normalizeKey(entry?.key || entry?.name);
      if (seen.has(key)) continue;
      seen.add(key);

      const legacyDefault = DEFAULT_BY_KEY.get(key);
      const fallbackPrice = rawPricing[key] ?? 0;

      programs.push({
        key,
        name:
          String(
            entry?.name || legacyDefault?.name || entry?.key || "Program"
          ).trim() || "Program",
        price: finiteNonNegative(
          entry?.price,
          finiteNonNegative(fallbackPrice, 0)
        ),
        weeks: positiveWeeks(entry?.weeks, legacyDefault?.weeks || 12),
        popular: Boolean(entry?.popular),
      });
    }

    return { sourceMode: "programs_array", programs };
  }

  const programs = LEGACY_PROGRAM_DEFAULTS
    .filter(
      (program) =>
        rawPricing[program.key] !== undefined &&
        rawPricing[program.key] !== null
    )
    .map((program) => ({
      ...program,
      price: finiteNonNegative(rawPricing[program.key], 0),
    }));

  return { sourceMode: "legacy_scalars", programs };
}

export function buildNewCataloguePayload(program, pricingId, index = 0) {
  return {
    name: program.name,
    slug: `program-${slugPart(program.key)}`,
    type: "program",
    price: program.price,
    currency: "NGN",
    // Deliberately neutral during the bridge. Current pricing labels and
    // Subscription's 30-day renewal logic disagree on cadence.
    billing: {
      type: "one_time",
      interval: null,
      intervalCount: 1,
      cycleDays: null,
    },
    durationWeeks: program.weeks,
    inventory: {
      trackInventory: false,
      stock: 0,
      reorderThreshold: 0,
      costPerUnit: 0,
      unit: "units",
    },
    fulfillment: { requiresFulfillment: false },
    booking: { requiresBooking: false },
    isActive: true,
    isPublic: false,
    isFeatured: Boolean(program.popular),
    sortOrder: (index + 1) * 10,
    legacySource: {
      sourceType: "pricing_program",
      sourceKey: program.key,
      sourceId: pricingId,
    },
  };
}
