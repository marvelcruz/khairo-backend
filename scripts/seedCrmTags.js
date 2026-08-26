import "dotenv/config";
import mongoose from "mongoose";

import { connectDB } from "../config/db.js";
import CrmTag from "../models/CrmTag.js";
import {
  normalizeCrmTagLookup,
  normalizeCrmTagKey,
} from "../services/crmTagService.js";

const TAGS = [
  ["Instagram Lead", "source"],
  ["WhatsApp Lead", "source"],
  ["Website Lead", "source"],
  ["Referral Lead", "source"],

  ["GLP Interest", "interest"],
  ["Non-GLP Interest", "interest"],

  ["Hot Lead", "behavior"],
  ["Needs Follow-up", "behavior"],
  ["No Response", "behavior"],
  ["Re-engagement", "behavior"],
  ["No-show", "behavior"],

  ["Payment Follow-up", "payment"],
  ["Payment Issue", "payment"],

  ["Missing Photos", "onboarding"],
  ["Missing Measurements", "onboarding"],
  ["Missing Documents", "onboarding"],
  ["Onboarding Incomplete", "onboarding"],

  ["Doctor Review Required", "operational"],
  ["At Risk", "operational"],

  ["Returning Client", "relationship"],
  ["Alumni", "relationship"],
];

const requestedDb =
  String(
    process.env.KHAIRO_CRM_QA_DB || ""
  ).trim();

try {
  if (
    requestedDb &&
    !requestedDb.startsWith(
      "khairo_crm_qa_"
    )
  ) {
    throw new Error(
      `Safety stop: invalid QA database override "${requestedDb}".`
    );
  }

  await connectDB();

  const actualDb =
    mongoose.connection.name;

  console.log(
    `Connected database: ${actualDb}`
  );

  /*
   * Critical safety check:
   * when a QA database is requested, the actual
   * Mongo connection must resolve to that exact DB
   * before any tag write can occur.
   */
  if (
    requestedDb &&
    actualDb !== requestedDb
  ) {
    throw new Error(
      `Safety stop: requested database "${requestedDb}" but connected to "${actualDb}".`
    );
  }

  if (requestedDb) {
    console.log(
      `QA database verified: ${actualDb}`
    );
  }

  let created = 0;
  let existing = 0;

  for (
    const [name, category]
    of TAGS
  ) {
    const normalizedName =
      normalizeCrmTagLookup(name);

    const found =
      await CrmTag.findOne({
        normalizedName,
      });

    if (found) {
      existing += 1;
      continue;
    }

    await CrmTag.create({
      key:
        normalizeCrmTagKey(name),
      name,
      normalizedName,
      category,
      active: true,
    });

    created += 1;
  }

  const total =
    await CrmTag.countDocuments({});

  console.log(
    `Created: ${created}`
  );

  console.log(
    `Already existed: ${existing}`
  );

  console.log(
    `Total approved tags: ${total}`
  );

  if (
    requestedDb &&
    total < TAGS.length
  ) {
    throw new Error(
      `QA tag library incomplete: expected at least ${TAGS.length}, found ${total}.`
    );
  }
} finally {
  await mongoose.disconnect();
}
