export const PROGRAM_VALUES = Object.freeze([
  "core",
  "plus",
  "vip",
  "not_sure",
]);

export const PROGRAM_LABELS = Object.freeze({
  core: "Core",
  plus: "Plus",
  vip: "VIP",
  not_sure: "Not sure",
});

export function normalizeProgramKey(value) {
  return String(value || "").trim().toLowerCase();
}

export function isProgramKey(value) {
  return PROGRAM_VALUES.includes(normalizeProgramKey(value));
}

export function programLabel(value) {
  const key = normalizeProgramKey(value);
  return PROGRAM_LABELS[key] || String(value || "Not sure");
}
