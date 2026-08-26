import mongoose from "mongoose";
import dotenv from "dotenv";
import { connectDB } from "../config/db.js";
import CrmContact from "../models/CrmContact.js";
import CrmOpportunity from "../models/CrmOpportunity.js";
import Application from "../models/Application.js";
import Client from "../models/Client.js";
import Subscription from "../models/Subscription.js";
import Pricing from "../models/Pricing.js";

dotenv.config();
await connectDB();

const legacyMap = {
  core: "semaglutide",
  plus: "tirzepatide",
  vip: "liraglutide",
  not_sure: "not_sure",
};

const newPrograms = [
  { key: "semaglutide", name: "Semaglutide", price: 0, weeks: 12, popular: false },
  { key: "tirzepatide", name: "Tirzepatide", price: 0, weeks: 12, popular: false },
  { key: "liraglutide", name: "Liraglutide", price: 0, weeks: 12, popular: false },
  { key: "dulaglutide", name: "Dulaglutide", price: 0, weeks: 12, popular: false },
  { key: "exenatide", name: "Exenatide", price: 0, weeks: 12, popular: false },
  { key: "retatrutide", name: "Retatrutide", price: 0, weeks: 12, popular: false },
  { key: "phentermine", name: "Phentermine", price: 0, weeks: 12, popular: false },
  { key: "topiramate", name: "Topiramate", price: 0, weeks: 12, popular: false },
  { key: "naltrexone", name: "Naltrexone", price: 0, weeks: 12, popular: false },
  { key: "bupropion", name: "Bupropion", price: 0, weeks: 12, popular: false },
  { key: "orlistat", name: "Orlistat", price: 0, weeks: 12, popular: false },
  { key: "metformin", name: "Metformin", price: 0, weeks: 12, popular: false },
  { key: "acarbose", name: "Acarbose", price: 0, weeks: 12, popular: false },
  { key: "fiber_supplements", name: "Fiber supplements", price: 0, weeks: 12, popular: false },
  { key: "protein_nutrition", name: "Protein/nutrition products", price: 0, weeks: 12, popular: false },
];

async function run() {
  const targets = [
    { model: CrmContact, field: "programInterest" },
    { model: CrmOpportunity, field: "programInterest" },
    { model: Application, field: "programInterest" },
    { model: Application, field: "program" },
    { model: Client, field: "program" },
    { model: Subscription, field: "program" },
  ];

  for (const target of targets) {
    const docs = await target.model.find({
      [target.field]: { $in: Object.keys(legacyMap) },
    }).lean();

    for (const doc of docs) {
      const next = legacyMap[doc[target.field]] || doc[target.field];

      if (target.model === Subscription && next === "not_sure") continue;

      await target.model.updateOne(
        { _id: doc._id },
        { $set: { [target.field]: next } }
      );

      console.log(`${target.model.modelName} ${doc._id}: ${doc[target.field]} → ${next}`);
    }
  }

  const pricing = await Pricing.findOne();
  if (pricing) {
    pricing.programs = newPrograms;
    pricing.core = 0;
    pricing.plus = 0;
    pricing.vip = 0;
    await pricing.save();
    console.log(" Pricing programs reset to new product list.");
  }

  console.log(" Program options migration complete.");
  process.exit(0);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
