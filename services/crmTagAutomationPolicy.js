export const AUTOMATION_TAG_DEFINITIONS = {
  instagram_lead: {
    name: "Instagram Lead",
    category: "source",
    description: "Automatically applied when the CRM source indicates Instagram.",
    automationRule: "source:instagram",
  },
  whatsapp_lead: {
    name: "WhatsApp Lead",
    category: "source",
    description: "Automatically applied when the CRM source indicates WhatsApp.",
    automationRule: "source:whatsapp",
  },
  website_lead: {
    name: "Website Lead",
    category: "source",
    description: "Automatically applied when a lead enters through a Khairo Diet Clinic website or public form.",
    automationRule: "source:website",
  },
  referral_lead: {
    name: "Referral Lead",
    category: "source",
    description: "Automatically applied when the CRM source indicates a referral.",
    automationRule: "source:referral",
  },

  stage_new: {
    name: "Stage: New Lead",
    category: "operational",
    description: "System-managed current-stage tag while the opportunity is at New Lead.",
    automationRule: "current_stage:new",
  },
  stage_qualification: {
    name: "Stage: Qualification",
    category: "operational",
    description: "System-managed current-stage tag while the opportunity is in Qualification.",
    automationRule: "current_stage:qualification",
  },
  stage_qualified: {
    name: "Stage: Qualified",
    category: "operational",
    description: "System-managed current-stage tag while the opportunity is Qualified.",
    automationRule: "current_stage:qualified",
  },
  stage_consultation_booked: {
    name: "Stage: Consultation Booked",
    category: "operational",
    description: "System-managed current-stage tag while the consultation is booked.",
    automationRule: "current_stage:consultation_booked",
  },
  stage_consultation_completed: {
    name: "Stage: Consultation Completed",
    category: "operational",
    description: "System-managed current-stage tag after consultation completion.",
    automationRule: "current_stage:consultation_completed",
  },
  stage_medical_review: {
    name: "Stage: Medical Review",
    category: "operational",
    description: "System-managed current-stage tag while the opportunity is in Medical Review.",
    automationRule: "current_stage:medical_review",
  },
  stage_payment_pending: {
    name: "Stage: Payment Pending",
    category: "payment",
    description: "System-managed current-stage tag while the opportunity is waiting for payment.",
    automationRule: "current_stage:payment_pending",
  },
  stage_nurture: {
    name: "Stage: Nurture",
    category: "campaign",
    description: "System-managed current-stage tag while the contact is in Nurture.",
    automationRule: "current_stage:nurture",
  },
  stage_lost: {
    name: "Stage: Lost",
    category: "relationship",
    description: "System-managed current-stage tag while the opportunity is Lost.",
    automationRule: "current_stage:lost",
  },

  qualification_review_required: {
    name: "Qualification Review Required",
    category: "operational",
    description: "System-managed tag while the lead is waiting for a qualification decision.",
    automationRule: "stage:qualification",
  },
  doctor_review_required: {
    name: "Doctor Review Required",
    category: "operational",
    description: "System-managed tag while the opportunity is in Medical Review.",
    automationRule: "stage:medical_review",
  },
  payment_follow_up: {
    name: "Payment Follow-up",
    category: "payment",
    description: "System-managed tag while the opportunity is waiting for payment.",
    automationRule: "stage:payment_pending",
  },

  new_lead_milestone: {
    name: "New Lead Reached",
    category: "relationship",
    description: "Permanent audit milestone showing that this contact reached the New Lead stage.",
    automationRule: "milestone:new",
  },
  qualification_milestone: {
    name: "Qualification Reached",
    category: "relationship",
    description: "Permanent audit milestone showing that this contact reached Qualification.",
    automationRule: "milestone:qualification",
  },
  qualified_lead: {
    name: "Qualified Lead",
    category: "relationship",
    description: "Permanent audit milestone showing that this contact reached Qualified.",
    automationRule: "milestone:qualified",
  },
  consultation_booked_milestone: {
    name: "Consultation Booked Reached",
    category: "relationship",
    description: "Permanent audit milestone showing that this contact reached Consultation Booked.",
    automationRule: "milestone:consultation_booked",
  },
  consultation_completed_milestone: {
    name: "Consultation Completed Reached",
    category: "relationship",
    description: "Permanent audit milestone showing that this contact reached Consultation Completed.",
    automationRule: "milestone:consultation_completed",
  },
  medical_review_milestone: {
    name: "Medical Review Reached",
    category: "relationship",
    description: "Permanent audit milestone showing that this contact reached Medical Review.",
    automationRule: "milestone:medical_review",
  },
  payment_pending_milestone: {
    name: "Payment Pending Reached",
    category: "relationship",
    description: "Permanent audit milestone showing that this contact reached Payment Pending.",
    automationRule: "milestone:payment_pending",
  },
  nurture_milestone: {
    name: "Nurture Reached",
    category: "relationship",
    description: "Permanent audit milestone showing that this contact entered Nurture.",
    automationRule: "milestone:nurture",
  },
  lost_milestone: {
    name: "Lost Reached",
    category: "relationship",
    description: "Permanent audit milestone showing that this contact reached Lost.",
    automationRule: "milestone:lost",
  },

  payment_completed: {
    name: "Payment Completed",
    category: "payment",
    description: "Permanent milestone showing that a verified program payment was completed.",
    automationRule: "milestone:payment_completed",
  },
  client_activated: {
    name: "Client Activated",
    category: "relationship",
    description: "Permanent milestone showing that the contact became an activated client.",
    automationRule: "milestone:client_activated",
  },
  order_created: {
    name: "Order Created",
    category: "operational",
    description: "Permanent milestone showing that at least one subscription or purchase created an order.",
    automationRule: "milestone:order_created",
  },
  doctor_assigned: {
    name: "Doctor Assigned",
    category: "operational",
    description: "Permanent fact showing that a doctor has been assigned to this client.",
    automationRule: "milestone:doctor_assigned",
  },
  coach_assigned: {
    name: "Coach Assigned",
    category: "operational",
    description: "Permanent fact showing that a coach has been assigned to this client.",
    automationRule: "milestone:coach_assigned",
  },

  core_client: {
    name: "Core Client",
    category: "relationship",
    description: "System-managed current segment for a client whose active program is Core.",
    automationRule: "client_program:core",
  },
  plus_client: {
    name: "Plus Client",
    category: "relationship",
    description: "System-managed current segment for a client whose active program is Plus.",
    automationRule: "client_program:plus",
  },
  vip_client: {
    name: "VIP Client",
    category: "relationship",
    description: "System-managed current segment for a client whose active program is VIP.",
    automationRule: "client_program:vip",
  },

  active_client: {
    name: "Active Client",
    category: "relationship",
    description: "System-managed current-state tag while the client is active.",
    automationRule: "client_status:active",
  },
  paused_client: {
    name: "Paused Client",
    category: "relationship",
    description: "System-managed current-state tag while the client is paused.",
    automationRule: "client_status:paused",
  },
  completed_client: {
    name: "Completed Client",
    category: "relationship",
    description: "System-managed current-state tag when the client's program is completed.",
    automationRule: "client_status:completed",
  },
  cancelled_client: {
    name: "Cancelled Client",
    category: "relationship",
    description: "System-managed current-state tag when the client has cancelled.",
    automationRule: "client_status:cancelled",
  },

  onboarding_not_started: {
    name: "Onboarding Not Started",
    category: "onboarding",
    description: "System-managed current-state tag when no onboarding actions have been completed.",
    automationRule: "onboarding:not_started",
  },
  onboarding_in_progress: {
    name: "Onboarding In Progress",
    category: "onboarding",
    description: "System-managed current-state tag while onboarding is underway.",
    automationRule: "onboarding:in_progress",
  },
  onboarding_completed: {
    name: "Onboarding Completed",
    category: "onboarding",
    description: "System-managed current-state tag when all required onboarding actions are complete.",
    automationRule: "onboarding:completed",
  },
};

export const CRM_STAGE_MILESTONE_TAGS = {
  new: "new_lead_milestone",
  qualification: "qualification_milestone",
  qualified: "qualified_lead",
  consultation_booked: "consultation_booked_milestone",
  consultation_completed: "consultation_completed_milestone",
  medical_review: "medical_review_milestone",
  payment_pending: "payment_pending_milestone",
  nurture: "nurture_milestone",
  lost: "lost_milestone",
};

export const CRM_CURRENT_STAGE_TAGS = {
  new: "stage_new",
  qualification: "stage_qualification",
  qualified: "stage_qualified",
  consultation_booked: "stage_consultation_booked",
  consultation_completed: "stage_consultation_completed",
  medical_review: "stage_medical_review",
  payment_pending: "stage_payment_pending",
  nurture: "stage_nurture",
  lost: "stage_lost",
};

export const CLIENT_PROGRAM_TAG_KEYS = [
  "core_client",
  "plus_client",
  "vip_client",
];

export const CLIENT_STATUS_TAG_KEYS = [
  "active_client",
  "paused_client",
  "completed_client",
  "cancelled_client",
];

export const CLIENT_ONBOARDING_TAG_KEYS = [
  "onboarding_not_started",
  "onboarding_in_progress",
  "onboarding_completed",
];

export const CLIENT_LIFECYCLE_MILESTONE_TAG_KEYS = [
  "payment_completed",
  "client_activated",
  "order_created",
  "doctor_assigned",
  "coach_assigned",
];

const LEGACY_AUTOMATION_TAG_KEYS = {
  "instagram-lead": "instagram_lead",
  "whatsapp-lead": "whatsapp_lead",
  "website-lead": "website_lead",
  "referral-lead": "referral_lead",
  "qualification-review-required": "qualification_review_required",
  "qualified-lead": "qualified_lead",
  "doctor-review-required": "doctor_review_required",
  "payment-follow-up": "payment_follow_up",
};

export const STAGE_MANAGED_TAG_KEYS = [
  ...Object.values(CRM_CURRENT_STAGE_TAGS),
  "qualification_review_required",
  "doctor_review_required",
  "payment_follow_up",
  "qualification-review-required",
  "doctor-review-required",
  "payment-follow-up",
];

const PERMANENT_AUTOMATION_TAG_KEYS = new Set([
  "instagram_lead",
  "whatsapp_lead",
  "website_lead",
  "referral_lead",
  ...Object.values(CRM_STAGE_MILESTONE_TAGS),
  ...CLIENT_LIFECYCLE_MILESTONE_TAG_KEYS,
]);

const CURRENT_STATE_AUTOMATION_TAG_KEYS = new Set([
  ...Object.values(CRM_CURRENT_STAGE_TAGS),
  ...CLIENT_PROGRAM_TAG_KEYS,
  ...CLIENT_STATUS_TAG_KEYS,
  ...CLIENT_ONBOARDING_TAG_KEYS,
]);

const CONDITIONAL_AUTOMATION_TAG_KEYS = new Set([
  "qualification_review_required",
  "doctor_review_required",
  "payment_follow_up",
]);

export function automationTagLifecycleMode(key) {
  if (PERMANENT_AUTOMATION_TAG_KEYS.has(key)) return "permanent";
  if (CURRENT_STATE_AUTOMATION_TAG_KEYS.has(key)) return "current_state";
  if (CONDITIONAL_AUTOMATION_TAG_KEYS.has(key)) return "conditional";
  return "manual";
}

export function normalizeAutomationTagKeys(values = []) {
  return [...new Set(
    (Array.isArray(values) ? values : [])
      .map((value) => LEGACY_AUTOMATION_TAG_KEYS[value] || value)
      .filter(Boolean)
  )];
}

export function inferAutomaticSourceTag(source = "") {
  const value = String(source || "").trim().toLowerCase();
  if (!value || value === "manual" || value.startsWith("manual_")) return null;

  if (value.includes("instagram")) return "instagram_lead";
  if (value.includes("whatsapp")) return "whatsapp_lead";
  if (value.includes("referral")) return "referral_lead";

  if (
    value.includes("website") ||
    value.includes("public_form") ||
    value.includes("public-form") ||
    value.includes("form:") ||
    value.includes("qualification")
  ) {
    return "website_lead";
  }

  return null;
}

export function automaticStageTags(stage = "") {
  const tags = [];
  const currentStageTag = CRM_CURRENT_STAGE_TAGS[stage];
  if (currentStageTag) tags.push(currentStageTag);
  if (stage === "qualification") tags.push("qualification_review_required");
  if (stage === "medical_review") tags.push("doctor_review_required");
  if (stage === "payment_pending") tags.push("payment_follow_up");
  return tags;
}

export function automaticMilestoneTags(stage = "") {
  const tag = CRM_STAGE_MILESTONE_TAGS[stage];
  return tag ? [tag] : [];
}

export function automationTagDefinition(key) {
  return AUTOMATION_TAG_DEFINITIONS[key] || null;
}
