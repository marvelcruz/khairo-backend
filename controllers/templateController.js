import MessageTemplate from "../models/MessageTemplate.js";

const DEFAULT_TEMPLATES = [
  { key: "day1_activated", name: "Day 1 - Activated, Unpaid", dayOffset: 1, audience: "unpaid",
    body: "Hi {first}!  Your Khairo Diet Clinic account is ready. Complete your payment to unlock your meal plan: {payLink}" },
  { key: "day1_not_activated", name: "Day 1 - Not Activated", dayOffset: 1, audience: "unpaid",
    body: "Hi {first}!  Your Khairo Diet Clinic application is approved. Activate your account and pay here: {payLink}" },
  { key: "day3", name: "Day 3 - Gentle Nudge", dayOffset: 3, audience: "unpaid",
    body: "Hey {first}!  Just checking in — your spot is reserved for 48 more hours. Ready to start your transformation? {payLink}" },
  { key: "day7", name: "Day 7 - Final Reminder", dayOffset: 7, audience: "unpaid",
    body: "Hi {first}, last reminder — your application expires in 24 hours. Don't miss your chance to join Khairo Diet Clinic! {payLink}" },
  { key: "renewal_7d", name: "Renewal - 7 Days Before", dayOffset: -7, audience: "active",
    body: "Hi {first}! Your cycle ends in 7 days. Ready to renew and keep your momentum? {payLink}" },
  { key: "lapsed_30d", name: "Lapsed - 30 Days Win-back", dayOffset: 30, audience: "lapsed",
    body: "Hey {first}! We miss you at Khairo Diet Clinic. Come back and continue your transformation: {payLink}" },
];

export const getTemplates = async (req, res, next) => {
  try {
    let templates = await MessageTemplate.find({}).sort({ dayOffset: 1, name: 1 });
    if (templates.length === 0) {
      // Auto-seed the first time anyone visits the page
      await MessageTemplate.insertMany(DEFAULT_TEMPLATES);
      templates = await MessageTemplate.find({}).sort({ dayOffset: 1, name: 1 });
    }
    res.json({ success: true, templates });
  } catch (err) { next(err); }
};

export const updateTemplate = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { name, body, dayOffset, audience, active } = req.body;
    const tpl = await MessageTemplate.findByIdAndUpdate(
      id,
      { name, body, dayOffset, audience, active, updatedAt: new Date() },
      { new: true }
    );
    if (!tpl) return res.status(404).json({ success: false, message: "Template not found" });
    res.json({ success: true, template: tpl });
  } catch (err) { next(err); }
};
