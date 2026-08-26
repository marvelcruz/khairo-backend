import mongoose from "mongoose";
import dotenv from "dotenv";
import { connectDB } from "../config/db.js";
import WorkflowDefinition from "../models/WorkflowDefinition.js";

dotenv.config();
await connectDB();

const result = await WorkflowDefinition.updateMany(
  { isTemplate: true, status: "draft" },
  {
    $set: {
      status: "active",
      activatedAt: new Date(),
    },
  }
);

console.log(`Activated ${result.modifiedCount} workflow templates.`);
await mongoose.disconnect();
process.exit(0);
