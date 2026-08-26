import { Readable } from "node:stream";
import path from "node:path";
import ExcelJS from "exceljs";

import CrmActivity from "../models/CrmActivity.js";
import CrmContact, {
  CRM_PREFERRED_CONTACT_METHOD_VALUES,
} from "../models/CrmContact.js";
import CrmOpportunity, {
  CRM_LEAD_PRIORITY_VALUES,
  CRM_STAGE_VALUES,
} from "../models/CrmOpportunity.js";
import CrmTag from "../models/CrmTag.js";
import User from "../models/User.js";

import {
  upsertCrmLead,
} from "../services/crmService.js";

import {
  makeUniqueCrmTagKey,
  normalizeCrmTagLookup,
} from "../services/crmTagService.js";
import { normalizeCrmSource } from "../utils/crmSourceTaxonomy.js";


const MAX_IMPORT_ROWS = 2000;

const FIELD_ALIASES = {
  fullName: [
    "full name",
    "name",
    "contact name",
  ],
  email: [
    "email",
    "email address",
  ],
  phone: [
    "phone",
    "phone number",
    "mobile",
    "mobile number",
  ],
  source: [
    "source",
    "lead source",
  ],
  sourceDetail: [
    "source detail",
    "campaign",
    "source detail campaign",
  ],
  preferredContactMethod: [
    "preferred contact",
    "preferred contact method",
    "contact method",
  ],
  programInterest: [
    "program",
    "programme",
    "program interest",
    "programme interest",
  ],
  stage: [
    "stage",
    "crm stage",
    "pipeline stage",
  ],
  leadPriority: [
    "priority",
    "lead priority",
  ],
  estimatedValue: [
    "estimated value",
    "value",
    "pipeline value",
  ],
  nextFollowUpAt: [
    "next follow up",
    "next follow-up",
    "follow up",
    "follow-up",
  ],
  owner: [
    "owner",
    "assigned to",
    "assignee",
  ],
  tags: [
    "tags",
    "tag",
  ],
};

const STAGE_LABELS = {
  new: "New Lead",
  qualification: "Qualification",
  qualified: "Qualified",
  consultation_booked:
    "Consultation Booked",
  consultation_completed:
    "Consultation Completed",
  medical_review: "Medical Review",
  payment_pending: "Payment Pending",
  nurture: "Nurture",
  lost: "Lost",
};

function normalizeHeader(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, " ");
}

function cellText(value) {
  if (
    value === null ||
    value === undefined
  ) {
    return "";
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (
    typeof value === "object"
  ) {
    if ("text" in value) {
      return String(value.text || "");
    }

    if ("result" in value) {
      return cellText(value.result);
    }

    if ("richText" in value) {
      return value.richText
        .map((item) => item.text || "")
        .join("");
    }

    if ("hyperlink" in value) {
      return String(
        value.text ||
        value.hyperlink ||
        ""
      );
    }
  }

  return String(value).trim();
}

async function readSpreadsheet(file) {
  if (!file?.buffer) {
    throw new Error(
      "Choose a CSV or Excel file."
    );
  }

  const extension =
    path.extname(
      file.originalname || ""
    ).toLowerCase();

  if (
    ![".csv", ".xlsx"].includes(
      extension
    )
  ) {
    throw new Error(
      "Only CSV and XLSX files are supported."
    );
  }

  const workbook =
    new ExcelJS.Workbook();

  if (extension === ".csv") {
    await workbook.csv.read(
      Readable.from([file.buffer])
    );
  } else {
    await workbook.xlsx.load(
      file.buffer
    );
  }

  const sheet =
    workbook.worksheets[0];

  if (!sheet) {
    throw new Error(
      "The spreadsheet has no worksheet."
    );
  }

  const headerRow =
    sheet.getRow(1);

  const headers = [];

  for (
    let col = 1;
    col <= headerRow.cellCount;
    col += 1
  ) {
    headers.push(
      cellText(
        headerRow.getCell(col).value
      ) || `Column ${col}`
    );
  }

  const rows = [];

  for (
    let rowNumber = 2;
    rowNumber <= sheet.rowCount;
    rowNumber += 1
  ) {
    const row =
      sheet.getRow(rowNumber);

    const record = {};
    let hasValue = false;

    headers.forEach(
      (header, index) => {
        const value =
          cellText(
            row.getCell(index + 1).value
          );

        if (value) hasValue = true;

        record[header] = value;
      }
    );

    if (hasValue) {
      rows.push({
        rowNumber,
        values: record,
      });
    }

    if (
      rows.length > MAX_IMPORT_ROWS
    ) {
      throw new Error(
        `Import up to ${MAX_IMPORT_ROWS} contacts at a time.`
      );
    }
  }

  return {
    headers,
    rows,
  };
}

function autoMapColumns(headers) {
  const normalizedHeaders =
    headers.map((header) => ({
      original: header,
      normalized:
        normalizeHeader(header),
    }));

  const mapping = {};

  for (
    const [field, aliases]
    of Object.entries(FIELD_ALIASES)
  ) {
    const match =
      normalizedHeaders.find(
        (header) =>
          aliases.includes(
            header.normalized
          )
      );

    if (match) {
      mapping[field] =
        match.original;
    }
  }

  return mapping;
}

function parseJsonValue(
  value,
  fallback = {}
) {
  if (!value) return fallback;

  if (
    typeof value === "object"
  ) {
    return value;
  }

  try {
    return JSON.parse(value);
  } catch {
    throw new Error(
      "Import configuration is invalid."
    );
  }
}

function mappedValue(
  row,
  mapping,
  key
) {
  const column =
    mapping[key];

  if (!column) return "";

  return String(
    row.values[column] || ""
  ).trim();
}

function splitTags(value) {
  return [
    ...new Set(
      String(value || "")
        .split(/[;,|]/)
        .map((item) =>
          item.trim()
        )
        .filter(Boolean)
    ),
  ];
}

function normalizePhone(value) {
  return String(value || "")
    .replace(/\D/g, "");
}

function normalizeEmail(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function normalizeChoice(
  value
) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
}

function normalizePreferredContact(
  value
) {
  if (!value) {
    return undefined;
  }

  const normalized =
    normalizeChoice(value);

  const aliases = {
    no_preference: "no_preference",
    none: "no_preference",
    whatsapp: "whatsapp",
    whats_app: "whatsapp",
    phone: "phone",
    call: "phone",
    telephone: "phone",
    email: "email",
  };

  return aliases[normalized] || null;
}

function normalizePriority(value) {
  if (!value) return undefined;

  const normalized =
    normalizeChoice(value);

  return CRM_LEAD_PRIORITY_VALUES.includes(
    normalized
  )
    ? normalized
    : null;
}

function normalizeProgram(value) {
  if (!value) return undefined;

  const normalized =
    normalizeChoice(value);

  const aliases = {
    core: "core",
    plus: "plus",
    vip: "vip",
    not_sure: "not_sure",
    unsure: "not_sure",
    unknown: "not_sure",
  };

  return aliases[normalized] || null;
}

function normalizeStage(value) {
  if (!value) return undefined;

  const normalized =
    normalizeChoice(value);

  const direct =
    CRM_STAGE_VALUES.includes(
      normalized
    )
      ? normalized
      : null;

  if (direct) return direct;

  for (
    const [key, label]
    of Object.entries(STAGE_LABELS)
  ) {
    if (
      normalizeChoice(label) ===
      normalized
    ) {
      return key;
    }
  }

  return null;
}

function normalizeDate(value) {
  if (!value) return undefined;

  const date =
    new Date(value);

  if (
    Number.isNaN(
      date.getTime()
    )
  ) {
    return null;
  }

  return date;
}

function buildNormalizedRow(
  row,
  mapping
) {
  const fullName =
    mappedValue(
      row,
      mapping,
      "fullName"
    );

  const email =
    normalizeEmail(
      mappedValue(
        row,
        mapping,
        "email"
      )
    );

  const phone =
    mappedValue(
      row,
      mapping,
      "phone"
    );

  const preferredRaw =
    mappedValue(
      row,
      mapping,
      "preferredContactMethod"
    );

  const programRaw =
    mappedValue(
      row,
      mapping,
      "programInterest"
    );

  const stageRaw =
    mappedValue(
      row,
      mapping,
      "stage"
    );

  const priorityRaw =
    mappedValue(
      row,
      mapping,
      "leadPriority"
    );

  const preferred =
    normalizePreferredContact(
      preferredRaw
    );

  const program =
    normalizeProgram(
      programRaw
    );

  const stage =
    normalizeStage(
      stageRaw
    );

  const priority =
    normalizePriority(
      priorityRaw
    );

  const dateValue =
    normalizeDate(
      mappedValue(
        row,
        mapping,
        "nextFollowUpAt"
      )
    );

  const valueText =
    mappedValue(
      row,
      mapping,
      "estimatedValue"
    );

  const estimatedValue =
    valueText === ""
      ? undefined
      : Number(
          valueText.replace(
            /[^\d.-]/g,
            ""
          )
        );

  const errors = [];

  if (!fullName) {
    errors.push(
      "Full Name is required."
    );
  }

  if (!email && !phone) {
    errors.push(
      "Email or Phone is required."
    );
  }

  if (
    preferredRaw &&
    !preferred
  ) {
    errors.push(
      "Preferred Contact is invalid."
    );
  }

  if (
    programRaw &&
    !program
  ) {
    errors.push(
      "Program Interest is invalid."
    );
  }

  if (
    stageRaw &&
    !stage
  ) {
    errors.push(
      "CRM Stage is invalid."
    );
  }

  if (
    priorityRaw &&
    !priority
  ) {
    errors.push(
      "Lead Priority is invalid."
    );
  }

  if (dateValue === null) {
    errors.push(
      "Next Follow-up is not a valid date."
    );
  }

  if (
    estimatedValue !== undefined &&
    (
      !Number.isFinite(
        estimatedValue
      ) ||
      estimatedValue < 0
    )
  ) {
    errors.push(
      "Estimated Value must be zero or greater."
    );
  }

  return {
    rowNumber: row.rowNumber,
    fullName,
    email,
    phone,
    phoneNormalized:
      normalizePhone(phone),
    source:
      normalizeCrmSource(
        mappedValue(
          row,
          mapping,
          "source"
        )
      ),
    sourceDetail:
      mappedValue(
        row,
        mapping,
        "sourceDetail"
      ),
    preferredContactMethod:
      preferred,
    programInterest:
      program,
    stage,
    leadPriority:
      priority,
    estimatedValue,
    nextFollowUpAt:
      dateValue || undefined,
    owner:
      mappedValue(
        row,
        mapping,
        "owner"
      ),
    tagTokens:
      splitTags(
        mappedValue(
          row,
          mapping,
          "tags"
        )
      ),
    errors,
  };
}

async function loadTagLookup() {
  // Imports may only assign active controlled tags.
  // Archived tag definitions remain available elsewhere
  // for historical display/export.
  const tags =
    await CrmTag.find({
      active: true,
    })
      .lean();

  const lookup =
    new Map();

  for (const tag of tags) {
    lookup.set(
      tag.key,
      tag
    );

    lookup.set(
      normalizeCrmTagLookup(
        tag.name
      ),
      tag
    );

    for (
      const alias
      of tag.aliases || []
    ) {
      lookup.set(
        normalizeCrmTagLookup(
          alias
        ),
        tag
      );
    }
  }

  return {
    tags,
    lookup,
  };
}

function resolveTagFromLookup(
  token,
  lookup
) {
  return (
    lookup.get(token) ||
    lookup.get(
      normalizeCrmTagLookup(
        token
      )
    )
  );
}

async function existingContactMap(
  rows
) {
  const emails = [
    ...new Set(
      rows
        .map((row) => row.email)
        .filter(Boolean)
    ),
  ];

  const phones = [
    ...new Set(
      rows
        .map(
          (row) =>
            row.phoneNormalized
        )
        .filter(Boolean)
    ),
  ];

  if (
    !emails.length &&
    !phones.length
  ) {
    return {
      emailMap: new Map(),
      phoneMap: new Map(),
    };
  }

  const clauses = [];

  if (emails.length) {
    clauses.push({
      email: { $in: emails },
    });
  }

  if (phones.length) {
    clauses.push({
      phoneNormalized: {
        $in: phones,
      },
    });
  }

  const contacts =
    await CrmContact.find({
      isArchived: false,
      $or: clauses,
    })
      .select("+phoneNormalized")
      .lean();

  return {
    emailMap:
      new Map(
        contacts
          .filter(
            (contact) =>
              contact.email
          )
          .map((contact) => [
            contact.email,
            contact,
          ])
      ),

    phoneMap:
      new Map(
        contacts
          .filter(
            (contact) =>
              contact.phoneNormalized
          )
          .map((contact) => [
            contact.phoneNormalized,
            contact,
          ])
      ),
  };
}

function matchExistingInMaps(
  row,
  maps
) {
  const emailMatch =
    row.email
      ? maps.emailMap.get(
          row.email
        ) || null
      : null;

  const phoneMatch =
    row.phoneNormalized
      ? maps.phoneMap.get(
          row.phoneNormalized
        ) || null
      : null;

  const conflict =
    Boolean(
      emailMatch &&
      phoneMatch &&
      String(emailMatch._id) !==
        String(phoneMatch._id)
    );

  return {
    emailMatch,
    phoneMatch,
    conflict,
    existing:
      conflict
        ? null
        : emailMatch ||
          phoneMatch ||
          null,
  };
}

async function buildOwnerLookup() {
  const users =
    await User.find({
      isActive: true,
    })
      .select("_id name email")
      .lean();

  const lookup =
    new Map();

  for (const user of users) {
    if (user.email) {
      lookup.set(
        normalizeEmail(
          user.email
        ),
        user
      );
    }

    if (user.name) {
      lookup.set(
        normalizeCrmTagLookup(
          user.name
        ),
        user
      );
    }
  }

  return lookup;
}

function ownerFromLookup(
  value,
  lookup
) {
  if (!value) return null;

  return (
    lookup.get(
      normalizeEmail(value)
    ) ||
    lookup.get(
      normalizeCrmTagLookup(
        value
      )
    ) ||
    null
  );
}

function importIdentityKeys(row) {
  const keys = [];

  if (row.email) {
    keys.push(
      `email:${row.email}`
    );
  }

  if (row.phoneNormalized) {
    keys.push(
      `phone:${row.phoneNormalized}`
    );
  }

  return keys;
}


export async function previewCrmImport(
  req,
  res,
  next
) {
  try {
    const spreadsheet =
      await readSpreadsheet(
        req.file
      );

    const suppliedMapping =
      parseJsonValue(
        req.body.mapping,
        {}
      );

    const mapping =
      Object.keys(
        suppliedMapping
      ).length
        ? suppliedMapping
        : autoMapColumns(
            spreadsheet.headers
          );

    const rows =
      spreadsheet.rows.map(
        (row) =>
          buildNormalizedRow(
            row,
            mapping
          )
      );

    const [
      maps,
      tagData,
      ownerLookup,
    ] =
      await Promise.all([
        existingContactMap(rows),
        loadTagLookup(),
        buildOwnerLookup(),
      ]);

    const unknown =
      new Map();

    const seen =
      new Set();

    let newCount = 0;
    let updateCount = 0;
    let invalidCount = 0;
    let duplicateCount = 0;

    const previewRows =
      rows.map((row) => {
        const errors =
          [...row.errors];

        const identities =
          importIdentityKeys(row);

        if (
          identities.some(
            (identity) =>
              seen.has(identity)
          )
        ) {
          errors.push(
            "Duplicate row in this import file."
          );
          duplicateCount += 1;
        }

        for (
          const identity
          of identities
        ) {
          seen.add(identity);
        }

        for (
          const token
          of row.tagTokens
        ) {
          if (
            !resolveTagFromLookup(
              token,
              tagData.lookup
            )
          ) {
            const mappingKey =
              normalizeCrmTagLookup(
                token
              );

            if (
              !unknown.has(
                mappingKey
              )
            ) {
              unknown.set(
                mappingKey,
                {
                  token,
                  mappingKey,
                }
              );
            }
          }
        }

        const match =
          matchExistingInMaps(
            row,
            maps
          );

        if (match.conflict) {
          errors.push(
            "Identity conflict: the email and phone belong to different existing CRM contacts."
          );
        }

        const existing =
          match.existing;

        if (errors.length) {
          invalidCount += 1;
        } else if (existing) {
          updateCount += 1;
        } else {
          newCount += 1;
        }

        const owner =
          ownerFromLookup(
            row.owner,
            ownerLookup
          );

        return {
          rowNumber:
            row.rowNumber,
          fullName:
            row.fullName,
          email:
            row.email,
          phone:
            row.phone,
          stage:
            row.stage,
          tags:
            row.tagTokens,
          result:
            errors.length
              ? "invalid"
              : existing
                ? "update"
                : "new",
          existingContactId:
            existing?._id || null,
          ownerMatched:
            !row.owner ||
            Boolean(owner),
          errors,
        };
      });

    res.status(200).json({
      success: true,
      filename:
        req.file.originalname,
      headers:
        spreadsheet.headers,
      mapping,
      summary: {
        rows: rows.length,
        new: newCount,
        updates: updateCount,
        invalid: invalidCount,
        duplicates:
          duplicateCount,
        unknownTags:
          unknown.size,
      },
      unknownTags:
        [...unknown.values()],
      previewRows:
        previewRows.slice(0, 100),
      truncated:
        previewRows.length > 100,
    });
  } catch (error) {
    if (
      /Choose a CSV|Only CSV|spreadsheet|Import up to|configuration/.test(
        error.message || ""
      )
    ) {
      return res.status(400).json({
        success: false,
        message: error.message,
      });
    }

    next(error);
  }
}


export async function commitCrmImport(
  req,
  res,
  next
) {
  try {
    const spreadsheet =
      await readSpreadsheet(
        req.file
      );

    const mapping =
      parseJsonValue(
        req.body.mapping,
        {}
      );

    if (
      !Object.keys(mapping).length
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Preview and confirm the column mapping before importing.",
      });
    }

    const tagMappings =
      parseJsonValue(
        req.body.tagMappings,
        {}
      );

    const tagMode =
      req.body.tagMode === "replace"
        ? "replace"
        : "merge";

    const existingAction =
      req.body.existingAction === "skip"
        ? "skip"
        : "update";

    const rowActions =
      parseJsonValue(
        req.body.rowActions,
        {}
      );

    const rows =
      spreadsheet.rows.map(
        (row) =>
          buildNormalizedRow(
            row,
            mapping
          )
      );

    let tagData =
      await loadTagLookup();

    const unresolved =
      new Map();

    for (const row of rows) {
      for (
        const token
        of row.tagTokens
      ) {
        if (
          resolveTagFromLookup(
            token,
            tagData.lookup
          )
        ) {
          continue;
        }

        const mappingKey =
          normalizeCrmTagLookup(
            token
          );

        if (
          !(mappingKey in tagMappings)
        ) {
          unresolved.set(
            mappingKey,
            token
          );
        }
      }
    }

    if (unresolved.size) {
      return res.status(400).json({
        success: false,
        message:
          "Resolve every unknown tag before importing.",
        unknownTags:
          [...unresolved].map(
            ([mappingKey, token]) => ({
              mappingKey,
              token,
            })
          ),
      });
    }

    const invalidTagMappings =
      new Map();

    for (const row of rows) {
      for (
        const token
        of row.tagTokens
      ) {
        if (
          resolveTagFromLookup(
            token,
            tagData.lookup
          )
        ) {
          continue;
        }

        const mappingKey =
          normalizeCrmTagLookup(
            token
          );

        const decision =
          tagMappings[
            mappingKey
          ];

        if (
          decision === "__ignore__" ||
          decision === "__create__"
        ) {
          continue;
        }

        const mappedTag =
          decision
            ? (
                tagData.lookup.get(
                  decision
                ) ||
                resolveTagFromLookup(
                  decision,
                  tagData.lookup
                )
              )
            : null;

        if (
          !mappedTag ||
          mappedTag.active === false
        ) {
          invalidTagMappings.set(
            mappingKey,
            {
              token,
              mappingKey,
              decision:
                decision || "",
            }
          );
        }
      }
    }

    if (
      invalidTagMappings.size
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Each unknown tag must be mapped to an active controlled CRM tag, ignored, or created by an administrator.",
        invalidTagMappings:
          [
            ...invalidTagMappings.values(),
          ],
      });
    }

    const userRoles =
      req.user?.roles ||
      (
        req.user?.role
          ? [req.user.role]
          : []
      );

    const requestsTagCreation =
      rows.some((row) =>
        row.tagTokens.some(
          (token) => {
            if (
              resolveTagFromLookup(
                token,
                tagData.lookup
              )
            ) {
              return false;
            }

            const mappingKey =
              normalizeCrmTagLookup(
                token
              );

            return (
              tagMappings[
                mappingKey
              ] === "__create__"
            );
          }
        )
      );

    if (
      requestsTagCreation &&
      !userRoles.includes("admin")
    ) {
      return res.status(403).json({
        success: false,
        message:
          "Only an administrator can create new controlled CRM tags during import.",
      });
    }

    /*
     * An archived tag is intentionally unavailable for
     * new assignments. Do not silently recreate the same
     * name or alias during an import. An administrator must
     * reactivate it explicitly in Tag Manager instead.
     */
    if (requestsTagCreation) {
      const createMappingKeys =
        new Set();

      for (const row of rows) {
        for (
          const token
          of row.tagTokens
        ) {
          if (
            resolveTagFromLookup(
              token,
              tagData.lookup
            )
          ) {
            continue;
          }

          const mappingKey =
            normalizeCrmTagLookup(
              token
            );

          if (
            tagMappings[
              mappingKey
            ] === "__create__"
          ) {
            createMappingKeys.add(
              mappingKey
            );
          }
        }
      }

      if (createMappingKeys.size) {
        const keys = [
          ...createMappingKeys,
        ];

        const archivedCollision =
          await CrmTag.findOne({
            active: false,
            $or: [
              {
                normalizedName: {
                  $in: keys,
                },
              },
              {
                aliases: {
                  $in: keys,
                },
              },
            ],
          }).lean();

        if (archivedCollision) {
          return res.status(400).json({
            success: false,
            message:
              `An archived CRM tag already uses this name or alias ("${archivedCollision.name}"). Reactivate it in Tag Manager, or map or ignore the import tag.`,
          });
        }
      }
    }

    for (
      const row of rows
    ) {
      for (
        const token
        of row.tagTokens
      ) {
        if (
          resolveTagFromLookup(
            token,
            tagData.lookup
          )
        ) {
          continue;
        }

        const mappingKey =
          normalizeCrmTagLookup(
            token
          );

        const decision =
          tagMappings[
            mappingKey
          ];

        if (
          decision !== "__create__"
        ) {
          continue;
        }

        const existing =
          await CrmTag.findOne({
            normalizedName:
              mappingKey,
          });

        if (!existing) {
          await CrmTag.create({
            key:
              await makeUniqueCrmTagKey(
                token
              ),
            name: token,
            normalizedName:
              mappingKey,
            category: "other",
            description:
              "Created during CRM contact import.",
            aliases: [],
            active: true,
            createdBy:
              req.user._id,
            updatedBy:
              req.user._id,
          });
        }
      }
    }

    tagData =
      await loadTagLookup();

    const [
      ownerLookup,
      existingMaps,
    ] =
      await Promise.all([
        buildOwnerLookup(),
        existingContactMap(rows),
      ]);

    const seen =
      new Set();

    const errors = [];
    const warnings = [];

    let created = 0;
    let updated = 0;
    let skipped = 0;
    let skippedByChoice = 0;

    for (const row of rows) {
      const identities =
        importIdentityKeys(row);

      if (
        identities.some(
          (identity) =>
            seen.has(identity)
        )
      ) {
        skipped += 1;

        errors.push({
          rowNumber:
            row.rowNumber,
          message:
            "Duplicate row in import file.",
        });

        continue;
      }

      for (
        const identity
        of identities
      ) {
        seen.add(identity);
      }

      if (row.errors.length) {
        skipped += 1;

        errors.push({
          rowNumber:
            row.rowNumber,
          message:
            row.errors.join(" "),
        });

        continue;
      }

      const match =
        matchExistingInMaps(
          row,
          existingMaps
        );

      if (match.conflict) {
        skipped += 1;

        errors.push({
          rowNumber:
            row.rowNumber,
          message:
            "Identity conflict: the email and phone belong to different existing CRM contacts.",
        });

        continue;
      }

      const existed =
        match.existing;

      if (
        existed &&
        ["client", "former_client"].includes(
          existed.lifecycleStage
        )
      ) {
        skipped += 1;

        errors.push({
          rowNumber:
            row.rowNumber,
          message:
            "This CRM record is already a client or former client and cannot be overwritten through lead import.",
        });

        continue;
      }

      const requestedAction =
        String(
          rowActions[
            String(row.rowNumber)
          ] ||
          (
            existed
              ? existingAction
              : "create"
          )
        )
          .trim()
          .toLowerCase();

      if (
        requestedAction === "skip"
      ) {
        skipped += 1;
        skippedByChoice += 1;
        continue;
      }

      if (
        existed &&
        requestedAction !== "update"
      ) {
        skipped += 1;

        errors.push({
          rowNumber:
            row.rowNumber,
          message:
            "This row matches an existing CRM contact. Choose Update or Skip.",
        });

        continue;
      }

      if (
        !existed &&
        requestedAction !== "create"
      ) {
        skipped += 1;

        errors.push({
          rowNumber:
            row.rowNumber,
          message:
            "This row does not match an existing CRM contact. Choose Create or Skip.",
        });

        continue;
      }

      const owner =
        ownerFromLookup(
          row.owner,
          ownerLookup
        );

      if (
        row.owner &&
        !owner
      ) {
        warnings.push({
          rowNumber:
            row.rowNumber,
          message:
            `Owner "${row.owner}" was not found. Contact left unassigned.`,
        });
      }

      try {
        const result =
          await upsertCrmLead(
            {
              fullName:
                row.fullName,
              email:
                row.email,
              phone:
                row.phone,
              source:
                row.source,
              sourceDetail:
                row.sourceDetail,
              preferredContactMethod:
                row.preferredContactMethod,
              programInterest:
                row.programInterest,
              assignedTo:
                owner?._id,
            },
            {
              createdBy:
                req.user._id,
              stage:
                row.stage || "new",
              reopen:
                existed
                  ? Boolean(
                      row.stage &&
                      row.stage !== "lost"
                    )
                  : undefined,
            }
          );

        const {
          contact,
          opportunity,
        } = result;

        contact.fullName =
          row.fullName;

        if (row.email) {
          contact.email =
            row.email;
        }

        if (row.phone) {
          contact.phone =
            row.phone;
        }

        if (row.source) {
          contact.source =
            normalizeCrmSource(row.source);
        }

        if (row.sourceDetail) {
          contact.sourceDetail =
            row.sourceDetail;
        }

        if (
          row.preferredContactMethod
        ) {
          contact.preferredContactMethod =
            row.preferredContactMethod;
        }

        if (owner?._id) {
          contact.assignedTo =
            owner._id;
        }

        const resolvedTags = [];

        for (
          const token
          of row.tagTokens
        ) {
          let tag =
            resolveTagFromLookup(
              token,
              tagData.lookup
            );

          if (!tag) {
            const mappingKey =
              normalizeCrmTagLookup(
                token
              );

            const decision =
              tagMappings[
                mappingKey
              ];

            if (
              decision ===
              "__ignore__"
            ) {
              continue;
            }

            if (
              decision ===
              "__create__"
            ) {
              tag =
                resolveTagFromLookup(
                  token,
                  tagData.lookup
                );
            } else if (
              decision
            ) {
              tag =
                tagData.lookup.get(
                  decision
                ) ||
                resolveTagFromLookup(
                  decision,
                  tagData.lookup
                );
            }
          }

          if (
            tag &&
            !resolvedTags.includes(
              tag.key
            )
          ) {
            resolvedTags.push(
              tag.key
            );
          }
        }

        if (
          tagMode === "replace"
        ) {
          contact.tags =
            resolvedTags;
        } else {
          contact.tags = [
            ...new Set([
              ...(contact.tags || []),
              ...resolvedTags,
            ]),
          ];
        }

        contact.updatedBy =
          req.user._id;

        await contact.save();

        if (
          row.stage &&
          opportunity.stage !==
            row.stage
        ) {
          opportunity.stage =
            row.stage;
          opportunity.stageEnteredAt =
            new Date();
        }

        if (row.leadPriority) {
          opportunity.leadPriority =
            row.leadPriority;
        }

        if (
          row.estimatedValue !==
          undefined
        ) {
          opportunity.estimatedValue =
            row.estimatedValue;
        }

        if (
          row.nextFollowUpAt
        ) {
          opportunity.nextFollowUpAt =
            row.nextFollowUpAt;
        }

        if (owner?._id) {
          opportunity.assignedTo =
            owner._id;
        }

        if (
          row.stage === "lost"
        ) {
          opportunity.status =
            "lost";
          opportunity.closedAt =
            opportunity.closedAt ||
            new Date();
        } else if (
          row.stage &&
          opportunity.status ===
            "lost"
        ) {
          opportunity.status =
            "open";
          opportunity.closedAt =
            undefined;
          opportunity.lostReason =
            "";
        }

        opportunity.updatedBy =
          req.user._id;

        await opportunity.save();

        await CrmActivity.create({
          contact:
            contact._id,
          opportunity:
            opportunity._id,
          type: "system",
          subject:
            "CRM contact imported",
          body:
            existed
              ? "CRM contact updated from an imported spreadsheet."
              : "CRM contact created from an imported spreadsheet.",
          createdBy:
            req.user._id,
          metadata: {
            event:
              "crm_contact_import",
            filename:
              req.file.originalname,
            rowNumber:
              row.rowNumber,
          },
        });

        if (existed) {
          updated += 1;
        } else {
          created += 1;
        }
      } catch (error) {
        skipped += 1;

        errors.push({
          rowNumber:
            row.rowNumber,
          message:
            error.message ||
            "Import failed for this row.",
        });
      }
    }

    res.status(200).json({
      success: true,
      summary: {
        rows: rows.length,
        created,
        updated,
        skipped,
        skippedByChoice,
        warnings:
          warnings.length,
        errors:
          errors.length,
      },
      warnings,
      errors,
    });
  } catch (error) {
    if (
      /Choose a CSV|Only CSV|spreadsheet|Import up to|configuration/.test(
        error.message || ""
      )
    ) {
      return res.status(400).json({
        success: false,
        message: error.message,
      });
    }

    next(error);
  }
}


function csvEscape(value) {
  const text =
    value === null ||
    value === undefined
      ? ""
      : String(value);

  if (
    /[",\r\n]/.test(text)
  ) {
    return `"${text.replace(
      /"/g,
      '""'
    )}"`;
  }

  return text;
}

function csvFromRows(rows) {
  if (!rows.length) {
    return "";
  }

  const headers =
    Object.keys(rows[0]);

  return [
    headers
      .map(csvEscape)
      .join(","),
    ...rows.map((row) =>
      headers
        .map((header) =>
          csvEscape(
            row[header]
          )
        )
        .join(",")
    ),
  ].join("\r\n");
}

async function workbookBuffer(
  rows,
  sheetName = "CRM Contacts"
) {
  const workbook =
    new ExcelJS.Workbook();

  const sheet =
    workbook.addWorksheet(
      sheetName
    );

  if (rows.length) {
    const headers =
      Object.keys(rows[0]);

    sheet.addRow(headers);

    for (const row of rows) {
      sheet.addRow(
        headers.map(
          (header) =>
            row[header]
        )
      );
    }

    sheet.getRow(1).font = {
      bold: true,
    };

    sheet.columns.forEach(
      (column) => {
        let width = 12;

        column.eachCell?.(
          { includeEmpty: true },
          (cell) => {
            width = Math.min(
              40,
              Math.max(
                width,
                String(
                  cell.value || ""
                ).length + 2
              )
            );
          }
        );

        column.width = width;
      }
    );
  }

  return workbook.xlsx.writeBuffer();
}


function escapeCrmExportRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export async function exportCrmContacts(
  req,
  res,
  next
) {
  try {
    const {
      format = "csv",
      stage,
      assignedTo,
      source,
      tags = "",
      search = "",
    } = req.query;

    const contactQuery = {
      isArchived: false,
    };

    if (assignedTo) {
      contactQuery.assignedTo =
        assignedTo;
    }

    if (source) {
      contactQuery.source =
        source;
    }

    const searchTerm = String(search || "").trim();
    if (searchTerm) {
      const safeSearch = escapeCrmExportRegex(searchTerm);
      const searchPattern = new RegExp(safeSearch, "i");
      contactQuery.$or = [
        { fullName: searchPattern },
        { email: searchPattern },
        { phone: searchPattern },
      ];
    }

    const tagKeys =
      String(tags || "")
        .split(",")
        .map((value) =>
          value.trim()
        )
        .filter(Boolean);

    if (tagKeys.length) {
      contactQuery.tags = {
        $all: tagKeys,
      };
    }

    let stageContactIds = null;

    if (stage) {
      if (
        !CRM_STAGE_VALUES.includes(
          stage
        )
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Invalid CRM stage.",
        });
      }

      const matching =
        await CrmOpportunity.find({
          stage,
        }).select("contact");

      stageContactIds =
        matching.map(
          (item) =>
            item.contact
        );

      contactQuery._id = {
        $in: stageContactIds,
      };
    }

    const contacts =
      await CrmContact.find(
        contactQuery
      )
        .populate(
          "assignedTo",
          "name email"
        )
        .sort({
          createdAt: -1,
        });

    if (contacts.length === 0) {
      return res.status(404).json({
        success: false,
        message:
          "No CRM contacts match the selected export filters.",
      });
    }

    const opportunities =
      contacts.length
        ? await CrmOpportunity.find({
            contact: {
              $in:
                contacts.map(
                  (contact) =>
                    contact._id
                ),
            },
          })
            .sort({
              updatedAt: -1,
            })
            .populate(
              "assignedTo",
              "name email"
            )
        : [];

    const opportunityMap =
      new Map();

    for (
      const opportunity
      of opportunities
    ) {
      const key =
        opportunity.contact.toString();

      if (
        !opportunityMap.has(key)
      ) {
        opportunityMap.set(
          key,
          opportunity
        );
      }
    }

    const tagDefinitions =
      await CrmTag.find({})
        .lean();

    const tagNameMap =
      new Map(
        tagDefinitions.map(
          (tag) => [
            tag.key,
            tag.name,
          ]
        )
      );

    const rows =
      contacts.map((contact) => {
        const opportunity =
          opportunityMap.get(
            contact._id.toString()
          );

        const owner =
          opportunity?.assignedTo ||
          contact.assignedTo;

        return {
          "Full Name":
            contact.fullName || "",
          Email:
            contact.email || "",
          Phone:
            contact.phone || "",
          Source:
            contact.source || "",
          "Source Detail":
            contact.sourceDetail || "",
          "Preferred Contact":
            contact.preferredContactMethod ||
            "no_preference",
          "Program Interest":
            opportunity?.programInterest ||
            contact.programInterest ||
            "not_sure",
          Stage:
            opportunity
              ? STAGE_LABELS[
                  opportunity.stage
                ] ||
                opportunity.stage
              : "",
          Priority:
            opportunity?.leadPriority ||
            "normal",
          "Estimated Value":
            opportunity?.estimatedValue ||
            0,
          "Next Follow-up":
            opportunity?.nextFollowUpAt
              ? opportunity.nextFollowUpAt.toISOString()
              : "",
          Owner:
            owner?.name || "",
          Tags:
            (contact.tags || [])
              .map(
                (key) =>
                  tagNameMap.get(
                    key
                  ) || key
              )
              .join("; "),
          "Lifecycle Stage":
            contact.lifecycleStage ||
            "",
          "Stage Entered At":
            opportunity?.stageEnteredAt
              ? opportunity.stageEnteredAt.toISOString()
              : "",
          "Created At":
            contact.createdAt
              ? contact.createdAt.toISOString()
              : "",
        };
      });

    const date =
      new Date()
        .toISOString()
        .slice(0, 10);

    if (
      String(format).toLowerCase() ===
      "xlsx"
    ) {
      const buffer =
        await workbookBuffer(
          rows
        );

      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      );

      res.setHeader(
        "Content-Disposition",
        `attachment; filename="khairo-crm-${date}.xlsx"`
      );

      return res.send(
        Buffer.from(buffer)
      );
    }

    res.setHeader(
      "Content-Type",
      "text/csv; charset=utf-8"
    );

    res.setHeader(
      "Content-Disposition",
      `attachment; filename="khairo-crm-${date}.csv"`
    );

    return res.send(
      "\uFEFF" +
      csvFromRows(rows)
    );
  } catch (error) {
    next(error);
  }
}


export async function downloadCrmImportTemplate(
  req,
  res,
  next
) {
  try {
    const rows = [{
      "Full Name":
        "Example Client",
      Email:
        "example@email.com",
      Phone:
        "+2348012345678",
      Source:
        "Instagram",
      "Source Detail":
        "August campaign",
      "Preferred Contact":
        "WhatsApp",
      "Program Interest":
        "core",
      Stage:
        "New Lead",
      Priority:
        "normal",
      "Estimated Value":
        0,
      "Next Follow-up":
        "",
      Owner:
        "",
      Tags:
        "Instagram Lead; Needs Follow-up",
    }];

    const format =
      String(
        req.query.format || "xlsx"
      ).toLowerCase();

    if (format === "csv") {
      res.setHeader(
        "Content-Type",
        "text/csv; charset=utf-8"
      );

      res.setHeader(
        "Content-Disposition",
        'attachment; filename="khairo-crm-import-template.csv"'
      );

      return res.send(
        "\uFEFF" +
        csvFromRows(rows)
      );
    }

    const buffer =
      await workbookBuffer(
        rows,
        "CRM Import"
      );

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );

    res.setHeader(
      "Content-Disposition",
      'attachment; filename="khairo-crm-import-template.xlsx"'
    );

    return res.send(
      Buffer.from(buffer)
    );
  } catch (error) {
    next(error);
  }
}
