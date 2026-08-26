import mongoose from "mongoose";
import Sop, { SOP_CATEGORIES, SOP_STEP_TYPES } from "../models/Sop.js";
import WorkflowDefinition from "../models/WorkflowDefinition.js";
import { logAudit } from "../utils/auditLogger.js";

const STARTER_SOPS = [
  {
    starterKey: "new-lead-follow-up",
    title: "New Lead Follow-Up",
    category: "sales",
    purpose: "Make sure every new enquiry is acknowledged, recorded and moved toward a clear next step.",
    whenToUse: "Whenever a new lead enters Khairo Diet Clinic from the website, referral, campaign, phone or manual entry.",
    owner: "Staff",
    sortOrder: 10,
    tags: ["lead", "crm", "follow-up"],
    steps: [
      { title: "Capture the lead", instruction: "Confirm the contact record contains name, contact details, source and the service or program they are interested in.", type: "automated" },
      { title: "Acknowledge quickly", instruction: "Send the approved acknowledgement and provide the clearest next action, normally booking or completing required information.", type: "automated" },
      { title: "Review and follow up", instruction: "If the lead has not progressed, complete the assigned follow-up task and record the outcome in CRM.", type: "human" },
      { title: "Escalate exceptions", instruction: "If the enquiry is sensitive, unclear or requires professional judgment, route it to the appropriate team member rather than guessing.", type: "approval" },
    ],
    exceptionGuidance: "Do not send repeated automated messages when a person has opted out, complained, or asked for a specific human response.",
  },
  {
    starterKey: "new-client-onboarding",
    title: "New Client Onboarding",
    category: "onboarding",
    purpose: "Give every new client a consistent start and prevent missing forms, payments, appointments or responsibilities.",
    whenToUse: "When a lead completes the required enrollment step and becomes a client.",
    owner: "Staff",
    sortOrder: 20,
    tags: ["client", "onboarding"],
    steps: [
      { title: "Confirm activation", instruction: "Verify the client record, selected product or service, payment state and responsible team member.", type: "human" },
      { title: "Send the welcome sequence", instruction: "Deliver the approved welcome information, portal instructions and next-step guidance.", type: "automated" },
      { title: "Collect required information", instruction: "Track required forms or intake information and create an exception task when something remains incomplete.", type: "automated" },
      { title: "Confirm first milestone", instruction: "Make sure the first required appointment, session or service milestone is scheduled and visible to the client.", type: "human" },
    ],
    exceptionGuidance: "If payment, consent or required clinical information is unresolved, stop the affected downstream step and create a human review task.",
  },
  {
    starterKey: "appointment-reminders",
    title: "Appointment Reminder & Preparation",
    category: "appointments",
    purpose: "Reduce missed appointments and make sure clients arrive prepared.",
    whenToUse: "For scheduled appointments that require confirmation, reminders or preparation instructions.",
    owner: "Staff",
    sortOrder: 30,
    tags: ["appointment", "reminder"],
    steps: [
      { title: "Confirm appointment details", instruction: "Verify the date, time, appointment type and responsible team member are correct.", type: "human" },
      { title: "Send reminders", instruction: "Use the approved reminder timing and include only the preparation information relevant to that appointment.", type: "automated" },
      { title: "Watch for problems", instruction: "If delivery fails, the client asks to reschedule, or required preparation is incomplete, create a staff task.", type: "automated" },
    ],
    exceptionGuidance: "Do not place sensitive clinical information in ordinary reminder messages unless the approved communication process permits it.",
  },
  {
    starterKey: "missed-appointment",
    title: "Missed Appointment / No-Show",
    category: "appointments",
    purpose: "Recover missed appointments consistently without losing the client or relying on memory.",
    whenToUse: "When an appointment is marked missed or the client does not attend as expected.",
    owner: "Staff",
    sortOrder: 40,
    tags: ["appointment", "no-show", "retention"],
    steps: [
      { title: "Record the outcome", instruction: "Mark the appointment accurately so Khairo Diet Clinic has a reliable trigger and history.", type: "human" },
      { title: "Send the recovery message", instruction: "Send the approved rescheduling message and make the next action easy.", type: "automated" },
      { title: "Create follow-up when unresolved", instruction: "If the client does not reschedule within the approved window, create a human follow-up task.", type: "automated" },
      { title: "Review repeated misses", instruction: "Repeated missed appointments should be reviewed by staff before additional automated outreach continues.", type: "approval" },
    ],
    exceptionGuidance: "A complaint, health concern or unusual circumstance should leave the standard automation path and receive human review.",
  },
  {
    starterKey: "payment-failure",
    title: "Payment Failure / Overdue Balance",
    category: "payments",
    purpose: "Resolve payment problems promptly while keeping a clear record of what happened.",
    whenToUse: "When a payment fails, remains pending beyond the normal window or a balance becomes overdue.",
    owner: "Staff",
    sortOrder: 50,
    tags: ["payment", "overdue", "revenue"],
    steps: [
      { title: "Verify payment status", instruction: "Confirm the processor status before contacting the client so a delayed success is not treated as a failure.", type: "automated" },
      { title: "Notify the client", instruction: "Send the approved payment-recovery message with a safe way to retry or contact the team.", type: "automated" },
      { title: "Create an exception task", instruction: "If payment remains unresolved, assign a staff task with the relevant transaction and client context.", type: "automated" },
      { title: "Apply business rules", instruction: "Any service hold, refund, adjustment or exception that requires judgment must be approved by the responsible staff member.", type: "approval" },
    ],
    exceptionGuidance: "Never ask a client to send full card details through email, text, chat or notes.",
  },
  {
    starterKey: "membership-renewal",
    title: "Membership / Program Renewal",
    category: "memberships",
    purpose: "Start renewal early, reduce preventable lapses and make non-renewal visible before the end date.",
    whenToUse: "When a renewable membership, subscription or program approaches its renewal date.",
    owner: "Staff",
    sortOrder: 60,
    tags: ["renewal", "membership", "retention"],
    steps: [
      { title: "Identify upcoming renewals", instruction: "Place clients into the renewal sequence before expiry using the approved lead time.", type: "automated" },
      { title: "Send renewal communications", instruction: "Use staged reminders that clearly explain the next action without overwhelming the client.", type: "automated" },
      { title: "Create staff follow-up", instruction: "When renewal remains unresolved at the agreed escalation point, assign a human task with the communication history.", type: "automated" },
      { title: "Record the outcome", instruction: "Mark renewed, non-renewed or follow-up required so future campaigns use accurate status.", type: "human" },
    ],
    exceptionGuidance: "Do not continue renewal messages after a client has clearly declined or requested no further marketing communication.",
  },
  {
    starterKey: "inactive-client",
    title: "Inactive / At-Risk Client Follow-Up",
    category: "retention",
    purpose: "Find disengagement early and give staff a clear recovery path.",
    whenToUse: "When Khairo Diet Clinic identifies inactivity, declining engagement or another defined retention-risk signal.",
    owner: "Staff",
    sortOrder: 70,
    tags: ["retention", "inactive", "risk"],
    steps: [
      { title: "Confirm the signal", instruction: "Check that the inactivity or risk signal is based on current data and is not explained by an expected pause or completed service.", type: "automated" },
      { title: "Send the approved check-in", instruction: "Use a supportive re-engagement message with one clear next step.", type: "automated" },
      { title: "Route unresolved cases", instruction: "Create a staff task when there is no response, repeated disengagement or a reason that needs judgment.", type: "automated" },
      { title: "Update the client state", instruction: "Record the outcome so the client is not repeatedly treated as at-risk after the issue is resolved.", type: "human" },
    ],
    exceptionGuidance: "Clinical concerns, complaints and requests to stop contact should bypass routine retention messaging and receive appropriate human handling.",
  },
  {
    starterKey: "client-complaint",
    title: "Client Complaint / Escalation",
    category: "operations",
    purpose: "Make sure complaints receive accountable human ownership and are not handled by uncontrolled automation.",
    whenToUse: "Whenever a client expresses dissatisfaction, alleges an error, requests escalation or raises a sensitive concern.",
    owner: "Staff",
    sortOrder: 80,
    tags: ["complaint", "escalation", "service"],
    steps: [
      { title: "Acknowledge and capture", instruction: "Record the concern accurately, including the channel, date and requested outcome without editorializing.", type: "human" },
      { title: "Assign accountable ownership", instruction: "Create and assign an urgent task to the appropriate person rather than leaving the issue in a shared inbox.", type: "automated" },
      { title: "Review before responding", instruction: "A responsible human reviews the facts, relevant records and approved policy before the substantive response is sent.", type: "approval" },
      { title: "Close the loop", instruction: "Record the resolution, any follow-up commitment and whether a process correction is required.", type: "human" },
    ],
    exceptionGuidance: "Do not let AI or an automated campaign make the final decision on a complaint, refund dispute, safety concern or clinical concern.",
  },
  {
    starterKey: "review-referral",
    title: "Review & Referral Request",
    category: "marketing",
    purpose: "Ask satisfied clients for advocacy at an appropriate moment without creating pressure or spam.",
    whenToUse: "After an approved positive milestone or service outcome makes a review or referral request appropriate.",
    owner: "Staff",
    sortOrder: 90,
    tags: ["review", "referral", "marketing"],
    steps: [
      { title: "Confirm eligibility", instruction: "Use the approved business rule to identify a suitable moment and exclude clients with unresolved complaints or service issues.", type: "automated" },
      { title: "Send one clear request", instruction: "Send the approved review or referral request with a direct link or simple next step.", type: "automated" },
      { title: "Record the result", instruction: "Track the request and any resulting referral or review so performance can be measured.", type: "automated" },
    ],
    exceptionGuidance: "Respect consent, platform rules and any request not to receive further promotional communication.",
  },
  {
    starterKey: "social-content",
    title: "Social Media Content Approval & Publishing",
    category: "marketing",
    purpose: "Keep social content consistent, approved and measurable from draft through publication.",
    whenToUse: "Whenever Khairo Diet Clinic creates, schedules or publishes social media content.",
    owner: "Staff",
    sortOrder: 100,
    tags: ["social", "content", "marketing"],
    steps: [
      { title: "Prepare the content", instruction: "Create the caption, media, topic and intended platform with the correct call to action.", type: "ai_assisted" },
      { title: "Review before publishing", instruction: "Check accuracy, brand fit, claims, privacy and any required approvals before the post goes live.", type: "approval" },
      { title: "Schedule or publish", instruction: "Use the connected social account and approved publishing time rather than sharing passwords or tokens.", type: "automated" },
      { title: "Measure performance", instruction: "Collect available reach and engagement metrics and use them to guide the next content cycle.", type: "automated" },
    ],
    exceptionGuidance: "Content containing sensitive client information, unapproved claims or uncertain clinical statements must not be published until reviewed.",
  },
  {
    starterKey: "staff-onboarding",
    title: "New Staff Onboarding",
    category: "staff",
    purpose: "Give every new team member the access, training and operating expectations required for their role.",
    whenToUse: "When a new Staff or Doctor account is being introduced to Khairo Diet Clinic operations.",
    owner: "Staff",
    sortOrder: 110,
    tags: ["staff", "onboarding", "access"],
    steps: [
      { title: "Confirm role and start date", instruction: "Verify whether the person requires Staff or Doctor access and who owns their onboarding.", type: "human" },
      { title: "Create approved access", instruction: "Create only the Khairo Diet Clinic access required for the role and avoid sharing another person's credentials.", type: "human" },
      { title: "Assign onboarding tasks", instruction: "Give the new team member the required training, SOP reading and setup checklist with due dates.", type: "automated" },
      { title: "Verify completion", instruction: "Confirm required onboarding steps are complete before treating the person as fully operational.", type: "approval" },
    ],
    exceptionGuidance: "Remove or suspend unnecessary access promptly when a role changes or employment ends.",
  },
  {
    starterKey: "management-review",
    title: "Weekly Management Review",
    category: "management",
    purpose: "Turn Khairo Diet Clinic data into a short recurring operating review focused on exceptions and next actions.",
    whenToUse: "Once each week as the standard management control rhythm.",
    owner: "Staff",
    sortOrder: 120,
    tags: ["management", "kpi", "reporting"],
    steps: [
      { title: "Review the core numbers", instruction: "Review leads, bookings, active clients, payments, renewals, retention signals and unresolved work using the current Khairo Diet Clinic reports.", type: "automated" },
      { title: "Review exceptions", instruction: "Focus on overdue tasks, failed automations, payment problems, client complaints and other items that need decisions.", type: "human" },
      { title: "Assign next actions", instruction: "Turn each decision into a named task with an owner and due date rather than leaving it in meeting notes.", type: "human" },
      { title: "Capture process improvements", instruction: "If the same exception repeats, update the relevant SOP or automation instead of repeatedly solving it manually.", type: "human" },
    ],
    exceptionGuidance: "Keep the review focused on decisions and exceptions; detailed investigation should become assigned follow-up work.",
  },
];

export const PROCESS_MAP = [
  { key: "lead", stage: "Lead", outcome: "Every enquiry captured and acknowledged", sopKey: "new-lead-follow-up", automation: "Lead capture and follow-up" },
  { key: "book", stage: "Book", outcome: "Qualified prospects reach a clear booking step", sopKey: "new-lead-follow-up", automation: "Lead-to-booking sequence" },
  { key: "onboard", stage: "Onboard", outcome: "New clients start with complete information and next steps", sopKey: "new-client-onboarding", automation: "Client onboarding sequence" },
  { key: "deliver", stage: "Deliver", outcome: "Appointments and service milestones happen reliably", sopKey: "appointment-reminders", automation: "Reminders and exception tasks" },
  { key: "retain", stage: "Retain", outcome: "Risk and inactivity are identified early", sopKey: "inactive-client", automation: "Retention risk and re-engagement" },
  { key: "renew", stage: "Renew", outcome: "Renewals begin before expiry and unresolved cases are visible", sopKey: "membership-renewal", automation: "Renewal sequence" },
  { key: "advocate", stage: "Advocate", outcome: "Satisfied clients can review and refer", sopKey: "review-referral", automation: "Review and referral request" },
  { key: "reactivate", stage: "Reactivate", outcome: "Eligible former or inactive clients have a clear return path", sopKey: "inactive-client", automation: "Reactivation campaign" },
];

function clean(value = "") {
  return String(value ?? "").trim();
}

function normalizeSteps(value) {
  if (!Array.isArray(value)) return [];
  if (value.length > 40) throw new Error("An SOP can contain up to 40 steps.");
  return value.map((step, index) => {
    const title = clean(step?.title);
    const instruction = clean(step?.instruction);
    const type = clean(step?.type || "human");
    if (!title || !instruction) throw new Error(`Step ${index + 1} needs a title and instruction.`);
    if (!SOP_STEP_TYPES.includes(type)) throw new Error(`Step ${index + 1} has an invalid type.`);
    return { title, instruction, type };
  });
}

function normalizeInput(payload = {}, current = {}) {
  const title = clean(payload.title ?? current.title);
  const category = clean(payload.category ?? current.category);
  const purpose = clean(payload.purpose ?? current.purpose);
  const whenToUse = clean(payload.whenToUse ?? current.whenToUse);
  const owner = clean(payload.owner ?? current.owner ?? "Staff");
  const status = clean(payload.status ?? current.status ?? "draft");
  const exceptionGuidance = clean(payload.exceptionGuidance ?? current.exceptionGuidance);
  const tagsSource = payload.tags ?? current.tags ?? [];
  const tags = Array.isArray(tagsSource) ? [...new Set(tagsSource.map((tag) => clean(tag).toLowerCase()).filter(Boolean))].slice(0, 20) : [];
  const linkedSource = payload.linkedWorkflows ?? current.linkedWorkflows ?? [];
  const linkedWorkflows = Array.isArray(linkedSource) ? linkedSource.filter(Boolean).map(String) : [];
  const steps = payload.steps !== undefined ? normalizeSteps(payload.steps) : normalizeSteps(current.steps || []);

  if (!title) throw new Error("SOP title is required.");
  if (!SOP_CATEGORIES.includes(category)) throw new Error("Choose a valid SOP category.");
  if (!["draft", "active", "archived"].includes(status)) throw new Error("Choose a valid SOP status.");
  if (title.length > 180 || purpose.length > 1200 || whenToUse.length > 1200 || owner.length > 120 || exceptionGuidance.length > 3000) {
    throw new Error("One or more SOP fields are too long.");
  }
  for (const id of linkedWorkflows) {
    if (!mongoose.isValidObjectId(id)) throw new Error("A linked automation id is invalid.");
  }

  return { title, category, purpose, whenToUse, owner, status, steps, exceptionGuidance, tags, linkedWorkflows };
}

async function ensureStarterSops() {
  for (const starter of STARTER_SOPS) {
    await Sop.updateOne(
      { starterKey: starter.starterKey },
      {
        $setOnInsert: {
          ...starter,
          status: "active",
          version: 1,
          lastReviewedAt: new Date(),
        },
      },
      { upsert: true }
    );
  }
}

export async function listSops(req, res, next) {
  try {
    await ensureStarterSops();
    const query = { status: { $ne: "archived" } };
    if (req.query.category && SOP_CATEGORIES.includes(String(req.query.category))) query.category = String(req.query.category);
    if (req.query.status && ["draft", "active", "archived"].includes(String(req.query.status))) query.status = String(req.query.status);
    if (req.query.q) {
      const q = clean(req.query.q).slice(0, 120).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      query.$or = [{ title: { $regex: q, $options: "i" } }, { purpose: { $regex: q, $options: "i" } }, { tags: { $regex: q, $options: "i" } }];
    }
    const [sops, workflows] = await Promise.all([
      Sop.find(query).sort({ sortOrder: 1, category: 1, title: 1 }).populate("linkedWorkflows", "name status trigger.type").lean(),
      WorkflowDefinition.find({ status: { $ne: "paused" } }).select("name status trigger.type").sort({ name: 1 }).lean(),
    ]);
    res.json({ success: true, sops, categories: SOP_CATEGORIES, stepTypes: SOP_STEP_TYPES, workflows });
  } catch (error) {
    next(error);
  }
}

export async function getProcessMap(req, res, next) {
  try {
    await ensureStarterSops();
    const sops = await Sop.find({ starterKey: { $in: PROCESS_MAP.map((item) => item.sopKey) }, status: { $ne: "archived" } }).select("_id title starterKey category status").lean();
    const byKey = new Map(sops.map((sop) => [sop.starterKey, sop]));
    res.json({
      success: true,
      stages: PROCESS_MAP.map((item) => ({ ...item, sop: byKey.get(item.sopKey) || null })),
    });
  } catch (error) {
    next(error);
  }
}

export async function createSop(req, res, next) {
  try {
    const input = normalizeInput(req.body);
    const sop = await Sop.create({ ...input, createdBy: req.user._id, updatedBy: req.user._id, lastReviewedAt: new Date() });
    await logAudit(req, "Created SOP", "Sop", sop._id.toString(), sop.title);
    res.status(201).json({ success: true, sop });
  } catch (error) {
    if (error?.message && !String(error.message).includes("Mongo")) return res.status(400).json({ success: false, message: error.message });
    next(error);
  }
}

export async function updateSop(req, res, next) {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ success: false, message: "Invalid SOP id." });
    const sop = await Sop.findById(req.params.id);
    if (!sop) return res.status(404).json({ success: false, message: "SOP not found." });
    const input = normalizeInput(req.body, sop.toObject());
    Object.assign(sop, input, {
      updatedBy: req.user._id,
      version: req.body.incrementVersion ? Number(sop.version || 1) + 1 : sop.version,
      lastReviewedAt: req.body.markReviewed ? new Date() : sop.lastReviewedAt,
    });
    await sop.save();
    await logAudit(req, "Updated SOP", "Sop", sop._id.toString(), sop.title);
    res.json({ success: true, sop });
  } catch (error) {
    if (error?.message && !String(error.message).includes("Mongo")) return res.status(400).json({ success: false, message: error.message });
    next(error);
  }
}

export async function archiveSop(req, res, next) {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ success: false, message: "Invalid SOP id." });
    const sop = await Sop.findById(req.params.id);
    if (!sop) return res.status(404).json({ success: false, message: "SOP not found." });
    sop.status = "archived";
    sop.updatedBy = req.user._id;
    await sop.save();
    await logAudit(req, "Archived SOP", "Sop", sop._id.toString(), sop.title);
    res.json({ success: true, sop });
  } catch (error) {
    next(error);
  }
}
