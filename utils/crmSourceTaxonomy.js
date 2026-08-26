export const CRM_SOURCE_VALUES = [
  "manual",
  "website",
  "instagram",
  "instagram_dm",
  "whatsapp",
  "whatsapp_inbound",
  "referral",
  "crm",
  "application",
  "client",
  "google",
  "facebook",
  "linkedin",
  "tiktok",
  "other",
];

const SOURCE_ALIASES = {
  manual: "manual",
  website: "website",
  website_contact: "website",
  website_application: "application",
  instagram: "instagram",
  instagram_dm: "instagram",
  ig: "instagram",
  whatsapp: "whatsapp",
  whatsapp_inbound: "whatsapp",
  wa: "whatsapp",
  referral: "referral",
  crm: "crm",
  application: "application",
  manual_application: "application",
  client: "client",
  google: "google",
  google_business: "google",
  gbp: "google",
  facebook: "facebook",
  fb: "facebook",
  linkedin: "linkedin",
  tiktok: "tiktok",
  tok: "tiktok",
  other: "other",
};

export function normalizeCrmSource(value) {
  const cleaned = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");

  if (!cleaned) return "manual";

  if (SOURCE_ALIASES[cleaned]) {
    return SOURCE_ALIASES[cleaned];
  }

  return CRM_SOURCE_VALUES.includes(cleaned)
    ? cleaned
    : "other";
}
