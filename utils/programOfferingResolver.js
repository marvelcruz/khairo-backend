import CatalogueItem from "../models/CatalogueItem.js";

export const LEGACY_PROGRAM_KEYS = Object.freeze([
  "core",
  "plus",
  "vip",
]);

export const NOT_SURE_PROGRAM_KEY = "not_sure";

const LEGACY_CYCLE_WEEKS = Object.freeze({
  core: 8,
  plus: 12,
  vip: 12,
});

export function normalizeLegacyProgramKey(value) {
  return String(value || "").trim().toLowerCase();
}

export function isLegacyProgramKey(value) {
  return LEGACY_PROGRAM_KEYS.includes(
    normalizeLegacyProgramKey(value)
  );
}

export async function resolveLegacyProgramOffering(
  value,
  { activeOnly = true } = {}
) {
  const key = normalizeLegacyProgramKey(value);

  if (!isLegacyProgramKey(key)) {
    return null;
  }

  const query = {
    type: "program",
    "legacySource.sourceType": "pricing_program",
    "legacySource.sourceKey": key,
  };

  if (activeOnly) {
    query.isActive = true;
  }

  return CatalogueItem.findOne(query);
}

export function normalizeProgramInterestKey(
  value,
  { defaultToNotSure = false } = {}
) {
  const key = normalizeLegacyProgramKey(value);

  if (!key) {
    return defaultToNotSure
      ? NOT_SURE_PROGRAM_KEY
      : "";
  }

  if (
    key === NOT_SURE_PROGRAM_KEY ||
    isLegacyProgramKey(key)
  ) {
    return key;
  }

  return null;
}

export async function resolveProgramInterestSelection(
  value,
  {
    defaultToNotSure = false,
    activeOnly = true,
  } = {}
) {
  const key = normalizeProgramInterestKey(
    value,
    { defaultToNotSure }
  );

  if (!key) {
    return {
      valid: false,
      reason: "invalid",
      key: null,
      offering: null,
    };
  }

  if (key === NOT_SURE_PROGRAM_KEY) {
    return {
      valid: true,
      reason: null,
      key,
      offering: null,
    };
  }

  const offering =
    await resolveLegacyProgramOffering(
      key,
      { activeOnly }
    );

  if (!offering) {
    return {
      valid: false,
      reason: "missing_offering",
      key,
      offering: null,
    };
  }

  return {
    valid: true,
    reason: null,
    key,
    offering,
  };
}

export function getLegacyCycleWeeks(offering, value) {
  const catalogueWeeks = Number(offering?.durationWeeks);

  if (
    Number.isFinite(catalogueWeeks) &&
    catalogueWeeks > 0
  ) {
    return catalogueWeeks;
  }

  const key = normalizeLegacyProgramKey(value);

  return LEGACY_CYCLE_WEEKS[key] || 12;
}
