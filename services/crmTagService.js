import CrmTag from "../models/CrmTag.js";

export function normalizeCrmTagLookup(value = "") {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");
}

export function normalizeCrmTagKey(value = "") {
  return normalizeCrmTagLookup(value)
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);
}

export async function makeUniqueCrmTagKey(name) {
  const base =
    normalizeCrmTagKey(name) || "tag";

  let key = base;
  let counter = 2;

  while (await CrmTag.exists({ key })) {
    const suffix = `_${counter}`;
    key =
      `${base.slice(0, 60 - suffix.length)}${suffix}`;
    counter += 1;
  }

  return key;
}

export async function findCrmTagByToken(
  value,
  { activeOnly = false } = {}
) {
  const raw = String(value || "").trim();

  if (!raw) return null;

  const key = normalizeCrmTagKey(raw);
  const normalized =
    normalizeCrmTagLookup(raw);

  return CrmTag.findOne({
    ...(activeOnly
      ? { active: true }
      : {}),
    $or: [
      { key },
      { normalizedName: normalized },
      { aliases: normalized },
    ],
  });
}

export async function resolveCrmTagKey(
  value,
  { activeOnly = true } = {}
) {
  const tag =
    await findCrmTagByToken(
      value,
      { activeOnly }
    );

  if (!tag) {
    throw new Error(
      `CRM tag "${String(value || "").trim()}" was not found in the approved tag library.`
    );
  }

  return tag.key;
}

export async function validateCrmTagKeys(
  values,
  { activeOnly = true } = {}
) {
  if (!Array.isArray(values)) {
    throw new Error(
      "CRM tags must be an array."
    );
  }

  const keys = [];

  for (const value of values) {
    const key =
      await resolveCrmTagKey(
        value,
        { activeOnly }
      );

    if (!keys.includes(key)) {
      keys.push(key);
    }
  }

  return keys;
}
