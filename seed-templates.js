import mongoose from "mongoose";
import dotenv from "dotenv";
import MessageTemplate from "./models/MessageTemplate.js";

dotenv.config();
await mongoose.connect(process.env.MONGODB_URI);

const defaults = [
  { key: "day1_activated", name: "Day 1 - Activated, Unpaid", dayOffset: 1, audience: "unpaid",
    body: "Hi {first}!  Your KhairoDietClinic account is ready. Complete your payment to unlock your meal plan: {payLink}" },
  { key: "day1_not_activated", name: "Day 1 - Not Activated", dayOffset: 1, audience: "unpaid",
    body: "Hi {first}!  Your KhairoDietClinic application is approved. Activate your account and pay here: {payLink}" },
  { key: "day3", name: "Day 3 - Gentle Nudge", dayOffset: 3, audience: "unpaid",
    body: "Hey {first}!  Just checking in — your spot is reserved for 48 more hours. Ready to start your transformation? {payLink}" },
  { key: "day7", name: "Day 7 - Final Reminder", dayOffset: 7, audience: "unpaid",
    body: "Hi {first}, last reminder — your application expires in 24 hours. Don't miss your chance to join KhairoDietClinic! {payLink}" },
  { key: "renewal_7d", name: "Renewal - 7 Days Before", dayOffset: -7, audience: "active",
    body: "Hi {first}! Your cycle ends in 7 days. Ready to renew and keep your momentum? {payLink}" },
  { key: "lapsed_30d", name: "Lapsed - 30 Days Win-back", dayOffset: 30, audience: "lapsed",
    body: "Hey {first}! We miss you at KhairoDietClinic. Come back and continue your transformation: {payLink}" },
];

for (const tpl of defaults) {
  const exists = await MessageTemplate.findOne({ key: tpl.key });
  if (!exists) await MessageTemplate.create(tpl);
}
console.log(" Templates seeded");
process.exit(0);
