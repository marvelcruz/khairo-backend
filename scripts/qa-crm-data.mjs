import ExcelJS from "exceljs";

const API =
  process.env.FITLUNGE_CRM_QA_API ||
  "http://localhost:5001/api";

const PASSWORD =
  "FitLungeCRMQA2026";

const suffix =
  `${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 7)}`;

let adminToken;
let salesToken;

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function test(name, fn) {
  process.stdout.write(
    `${name}`.padEnd(54, ".")
  );

  try {
    const detail = await fn();

    console.log(
      ` PASS${detail ? `  ${detail}` : ""}`
    );
  } catch (error) {
    console.log(" FAIL");
    throw error;
  }
}

async function request(
  path,
  {
    method = "GET",
    token,
    body,
    form,
  } = {}
) {
  const headers = {
    Accept: "application/json",
  };

  let payload;

  if (form) {
    payload = form;
  } else if (body !== undefined) {
    headers["Content-Type"] =
      "application/json";

    payload =
      JSON.stringify(body);
  }

  if (token) {
    headers.Authorization =
      `Bearer ${token}`;
  }

  const response =
    await fetch(
      `${API}${path}`,
      {
        method,
        headers,
        body: payload,
      }
    );

  const type =
    response.headers.get(
      "content-type"
    ) || "";

  let data;

  if (
    type.includes(
      "application/json"
    )
  ) {
    data =
      await response.json();
  } else {
    data =
      await response.text();
  }

  return {
    status: response.status,
    data,
    headers: response.headers,
  };
}

async function download(
  path,
  token
) {
  const response =
    await fetch(
      `${API}${path}`,
      {
        headers: {
          Authorization:
            `Bearer ${token}`,
        },
      }
    );

  return {
    status: response.status,
    type:
      response.headers.get(
        "content-type"
      ) || "",
    disposition:
      response.headers.get(
        "content-disposition"
      ) || "",
    buffer:
      Buffer.from(
        await response.arrayBuffer()
      ),
  };
}

async function login(email) {
  const response =
    await request(
      "/auth/login",
      {
        method: "POST",
        body: {
          email,
          password: PASSWORD,
        },
      }
    );

  assert(
    response.status === 200,
    `Login ${email} returned ${response.status}`
  );

  assert(
    response.data?.token,
    `Login ${email} returned no token`
  );

  return response.data.token;
}

const headers = [
  "Full Name",
  "Email",
  "Phone",
  "Source",
  "Source Detail",
  "Preferred Contact",
  "Program Interest",
  "Stage",
  "Priority",
  "Estimated Value",
  "Next Follow-up",
  "Owner",
  "Tags",
];

function csvEscape(value) {
  const text =
    String(value ?? "");

  if (/[",\n\r]/.test(text)) {
    return (
      '"' +
      text.replace(/"/g, '""') +
      '"'
    );
  }

  return text;
}

function csvFile(rows) {
  return Buffer.from(
    [
      headers.join(","),
      ...rows.map(
        (row) =>
          headers
            .map(
              (header) =>
                csvEscape(
                  row[header] ?? ""
                )
            )
            .join(",")
      ),
    ].join("\n"),
    "utf8"
  );
}

async function xlsxFile(rows) {
  const workbook =
    new ExcelJS.Workbook();

  const sheet =
    workbook.addWorksheet(
      "CRM Import"
    );

  sheet.addRow(headers);

  for (const row of rows) {
    sheet.addRow(
      headers.map(
        (header) =>
          row[header] ?? ""
      )
    );
  }

  return Buffer.from(
    await workbook.xlsx.writeBuffer()
  );
}

function makeForm(
  filename,
  buffer,
  fields = {}
) {
  const form =
    new FormData();

  const xlsx =
    filename
      .toLowerCase()
      .endsWith(".xlsx");

  form.append(
    "file",
    new Blob(
      [buffer],
      {
        type: xlsx
          ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          : "text/csv",
      }
    ),
    filename
  );

  for (
    const [key, value]
    of Object.entries(fields)
  ) {
    form.append(
      key,
      typeof value === "string"
        ? value
        : JSON.stringify(value)
    );
  }

  return form;
}

async function preview(
  filename,
  buffer,
  token = adminToken
) {
  return request(
    "/crm/contacts/import/preview",
    {
      method: "POST",
      token,
      form:
        makeForm(
          filename,
          buffer
        ),
    }
  );
}

async function commit(
  filename,
  buffer,
  previewData,
  {
    token = adminToken,
    tagMappings = {},
    existingAction = "update",
    rowActions = {},
    tagMode = "merge",
  } = {}
) {
  return request(
    "/crm/contacts/import/commit",
    {
      method: "POST",
      token,
      form:
        makeForm(
          filename,
          buffer,
          {
            mapping:
              previewData.mapping,
            tagMappings,
            existingAction,
            rowActions,
            tagMode,
          }
        ),
    }
  );
}

async function findContact(
  email,
  token = adminToken
) {
  const search =
    await request(
      `/crm/contacts?search=${encodeURIComponent(email)}`,
      { token }
    );

  assert(
    search.status === 200,
    `CRM search returned ${search.status}`
  );

  const contact =
    (search.data?.contacts || [])
      .find(
        (item) =>
          String(item.email || "")
            .toLowerCase() ===
          email.toLowerCase()
      );

  if (!contact) {
    return null;
  }

  const detail =
    await request(
      `/crm/contacts/${contact._id}`,
      { token }
    );

  assert(
    detail.status === 200,
    `Contact detail returned ${detail.status}`
  );

  return detail.data;
}

function baseRow({
  name,
  email,
  phone,
  tags = "Instagram Lead",
} = {}) {
  return {
    "Full Name":
      name ||
      `QA Import ${suffix}`,
    Email: email || "",
    Phone: phone || "",
    Source: "",
    "Source Detail":
      "Initial campaign",
    "Preferred Contact":
      "WhatsApp",
    "Program Interest":
      "core",
    Stage:
      "New Lead",
    Priority:
      "high",
    "Estimated Value":
      "123.45",
    "Next Follow-up": "",
    Owner: "",
    Tags: tags,
  };
}

async function main() {
  console.log(
    "========================================"
  );
  console.log(
    "FITLUNGE CRM DATA AUTOMATED QA"
  );
  console.log(
    "ISOLATED QA DATABASE ONLY"
  );
  console.log(
    "========================================"
  );
  console.log(`API: ${API}`);
  console.log();

  await test(
    "00 Health",
    async () => {
      const r =
        await request("/health");

      assert(
        r.status === 200,
        `Health returned ${r.status}`
      );
    }
  );

  await test(
    "01 Admin + Sales login",
    async () => {
      adminToken =
        await login(
          "crm.qa.admin@fitlunge.local"
        );

      salesToken =
        await login(
          "crm.qa.sales@fitlunge.local"
        );
    }
  );

  await test(
    "02 Controlled tag baseline",
    async () => {
      const r =
        await request(
          "/crm/tags?includeInactive=true",
          { token: adminToken }
        );

      assert(
        r.status === 200,
        `Tags returned ${r.status}`
      );

      const active =
        (r.data.tags || [])
          .filter(
            (tag) => tag.active
          );

      assert(
        active.length === 21,
        `Expected 21 active tags, got ${active.length}`
      );

      return "21 active";
    }
  );

  await test(
    "03 CSV import template",
    async () => {
      const r =
        await download(
          "/crm/contacts/import/template?format=csv",
          adminToken
        );

      assert(
        r.status === 200,
        `CSV template ${r.status}`
      );

      const text =
        r.buffer
          .toString("utf8")
          .replace(/^\uFEFF/, "");

      assert(
        text.includes("Full Name") &&
        text.includes("Tags"),
        "CSV template headers missing"
      );

      assert(
        r.disposition.includes(
          ".csv"
        ),
        "CSV template filename missing"
      );
    }
  );

  await test(
    "04 XLSX import template",
    async () => {
      const r =
        await download(
          "/crm/contacts/import/template?format=xlsx",
          adminToken
        );

      assert(
        r.status === 200,
        `XLSX template ${r.status}`
      );

      const workbook =
        new ExcelJS.Workbook();

      await workbook.xlsx.load(
        r.buffer
      );

      assert(
        workbook
          .worksheets[0]
          ?.getCell(1, 1)
          .value === "Full Name",
        "XLSX template could not be parsed"
      );
    }
  );

  const baseEmail =
    `qa.import.${suffix}@example.com`;

  const basePhone =
    `+1555${String(Date.now()).slice(-7)}`;

  const baseBuffer =
    csvFile([
      baseRow({
        email: baseEmail,
        phone: basePhone,
      }),
    ]);

  let basePreview;

  await test(
    "05 CSV preview new contact",
    async () => {
      const r =
        await preview(
          "qa-new.csv",
          baseBuffer
        );

      assert(
        r.status === 200,
        `Preview ${r.status}: ${r.data?.message || ""}`
      );

      basePreview = r.data;

      assert(
        r.data.summary?.new === 1,
        `Expected 1 new, got ${r.data.summary?.new}`
      );

      assert(
        r.data.summary?.unknownTags === 0,
        "Known tag reported unknown"
      );
    }
  );

  await test(
    "06 CSV commit create",
    async () => {
      const r =
        await commit(
          "qa-new.csv",
          baseBuffer,
          basePreview
        );

      assert(
        r.status === 200,
        `Commit ${r.status}: ${r.data?.message || ""}`
      );

      assert(
        r.data.summary?.created === 1,
        `Expected created=1, got ${r.data.summary?.created}`
      );
    }
  );

  await test(
    "07 Imported field + tag integrity",
    async () => {
      const detail =
        await findContact(
          baseEmail
        );

      assert(
        detail?.contact,
        "Imported contact missing"
      );

      assert(
        detail.contact.tags?.includes(
          "instagram_lead"
        ),
        "Imported controlled tag missing"
      );

      assert(
        detail.contact.sourceDetail ===
          "Initial campaign",
        "Source Detail not preserved"
      );

      assert(
        detail.contact
          .preferredContactMethod ===
          "whatsapp",
        "Preferred contact mismatch"
      );

      assert(
        detail.opportunity?.stage ===
          "new",
        "Imported stage mismatch"
      );

      assert(
        detail.opportunity
          ?.leadPriority === "high",
        "Imported priority mismatch"
      );

      assert(
        Number(
          detail.opportunity
            ?.estimatedValue
        ) === 123.45,
        "Imported value mismatch"
      );
    }
  );

  const dupPhone =
    `+1666${String(Date.now()).slice(-7)}`;

  const duplicateBuffer =
    csvFile([
      baseRow({
        name: `QA Dup A ${suffix}`,
        email:
          `qa.dupa.${suffix}@example.com`,
        phone: dupPhone,
      }),
      baseRow({
        name: `QA Dup B ${suffix}`,
        email:
          `qa.dupb.${suffix}@example.com`,
        phone: dupPhone,
      }),
      baseRow({
        name: `QA Dup C ${suffix}`,
        email:
          `qa.dupa.${suffix}@example.com`,
        phone:
          `+1777${String(Date.now()).slice(-7)}`,
      }),
    ]);

  let duplicatePreview;

  await test(
    "08 Same-file email + phone duplicates",
    async () => {
      const r =
        await preview(
          "qa-duplicates.csv",
          duplicateBuffer
        );

      assert(
        r.status === 200,
        `Duplicate preview ${r.status}`
      );

      duplicatePreview =
        r.data;

      assert(
        r.data.summary?.duplicates === 2,
        `Expected 2 duplicates, got ${r.data.summary?.duplicates}`
      );

      assert(
        r.data.summary?.invalid === 2,
        `Expected 2 invalid rows, got ${r.data.summary?.invalid}`
      );
    }
  );

  await test(
    "09 Duplicate commit protection",
    async () => {
      const r =
        await commit(
          "qa-duplicates.csv",
          duplicateBuffer,
          duplicatePreview
        );

      assert(
        r.status === 200,
        `Duplicate commit ${r.status}`
      );

      assert(
        r.data.summary?.created === 1,
        `Expected 1 created, got ${r.data.summary?.created}`
      );

      assert(
        r.data.summary?.skipped === 2,
        `Expected 2 skipped, got ${r.data.summary?.skipped}`
      );

      assert(
        r.data.summary?.errors === 2,
        `Expected 2 errors, got ${r.data.summary?.errors}`
      );
    }
  );

  const conflictA =
    `qa.conflict.a.${suffix}@example.com`;

  const conflictB =
    `qa.conflict.b.${suffix}@example.com`;

  const conflictPhoneA =
    `+18881${String(Date.now()).slice(-6)}`;

  const conflictPhoneB =
    `+18882${String(Date.now()).slice(-6)}`;

  const conflictSeed =
    csvFile([
      baseRow({
        name:
          `QA Conflict A ${suffix}`,
        email: conflictA,
        phone: conflictPhoneA,
      }),
      baseRow({
        name:
          `QA Conflict B ${suffix}`,
        email: conflictB,
        phone: conflictPhoneB,
      }),
    ]);

  await test(
    "10 Seed split-identity records",
    async () => {
      const p =
        await preview(
          "qa-conflict-seed.csv",
          conflictSeed
        );

      assert(
        p.status === 200,
        `Conflict seed preview ${p.status}`
      );

      const r =
        await commit(
          "qa-conflict-seed.csv",
          conflictSeed,
          p.data
        );

      assert(
        r.status === 200,
        `Conflict seed commit ${r.status}`
      );

      assert(
        r.data.summary?.created === 2,
        "Did not create two conflict seed contacts"
      );
    }
  );

  await test(
    "11 Email/phone split-contact conflict",
    async () => {
      const buffer =
        csvFile([
          baseRow({
            name:
              `QA Conflict Mixed ${suffix}`,
            email: conflictA,
            phone: conflictPhoneB,
          }),
        ]);

      const r =
        await preview(
          "qa-conflict.csv",
          buffer
        );

      assert(
        r.status === 200,
        `Conflict preview ${r.status}`
      );

      assert(
        r.data.previewRows?.[0]
          ?.result === "invalid",
        "Identity conflict was not invalid"
      );

      assert(
        r.data.previewRows?.[0]
          ?.errors?.some(
            (error) =>
              error.includes(
                "Identity conflict"
              )
          ),
        "Identity conflict message missing"
      );
    }
  );

  await test(
    "12 Existing-contact Skip",
    async () => {
      const buffer =
        csvFile([
          baseRow({
            name:
              `SHOULD NOT SAVE ${suffix}`,
            email: baseEmail,
            phone: basePhone,
          }),
        ]);

      const p =
        await preview(
          "qa-skip.csv",
          buffer
        );

      assert(
        p.data.previewRows?.[0]
          ?.result === "update",
        "Existing contact not classified update"
      );

      const r =
        await commit(
          "qa-skip.csv",
          buffer,
          p.data,
          {
            existingAction:
              "skip",
          }
        );

      assert(
        r.status === 200,
        `Skip commit ${r.status}`
      );

      assert(
        r.data.summary
          ?.skippedByChoice === 1,
        "Skip not counted"
      );

      const detail =
        await findContact(
          baseEmail
        );

      assert(
        detail.contact.fullName !==
          `SHOULD NOT SAVE ${suffix}`,
        "Skipped row changed contact"
      );
    }
  );

  await test(
    "13 Update + blank preservation + merge",
    async () => {
      const row =
        baseRow({
          name:
            `QA Updated ${suffix}`,
          email: baseEmail,
          phone: basePhone,
          tags: "Website Lead",
        });

      row["Source Detail"] = "";
      row["Preferred Contact"] = "";
      row.Stage = "Qualified";
      row.Priority = "urgent";
      row["Estimated Value"] =
        "456";

      const buffer =
        csvFile([row]);

      const p =
        await preview(
          "qa-update.csv",
          buffer
        );

      const r =
        await commit(
          "qa-update.csv",
          buffer,
          p.data,
          {
            tagMode: "merge",
          }
        );

      assert(
        r.status === 200,
        `Update commit ${r.status}`
      );

      assert(
        r.data.summary?.updated === 1,
        "Existing contact not updated"
      );

      const detail =
        await findContact(
          baseEmail
        );

      assert(
        detail.contact.fullName ===
          `QA Updated ${suffix}`,
        "Updated name missing"
      );

      assert(
        detail.contact.sourceDetail ===
          "Initial campaign",
        "Blank Source Detail overwrote value"
      );

      assert(
        detail.contact
          .preferredContactMethod ===
          "whatsapp",
        "Blank preferred contact overwrote value"
      );

      assert(
        detail.contact.tags.includes(
          "instagram_lead"
        ) &&
        detail.contact.tags.includes(
          "website_lead"
        ),
        "Tag merge failed"
      );

      assert(
        detail.opportunity?.stage ===
          "qualified",
        "Stage update failed"
      );

      assert(
        detail.opportunity
          ?.leadPriority === "urgent",
        "Priority update failed"
      );

      assert(
        Number(
          detail.opportunity
            ?.estimatedValue
        ) === 456,
        "Value update failed"
      );
    }
  );

  await test(
    "14 Controlled tag replace",
    async () => {
      const row =
        baseRow({
          name:
            `QA Updated ${suffix}`,
          email: baseEmail,
          phone: basePhone,
          tags:
            "Needs Follow-up",
        });

      row.Stage = "";
      row["Source Detail"] = "";
      row["Preferred Contact"] = "";
      row.Priority = "";
      row["Estimated Value"] = "";

      const buffer =
        csvFile([row]);

      const p =
        await preview(
          "qa-replace.csv",
          buffer
        );

      const r =
        await commit(
          "qa-replace.csv",
          buffer,
          p.data,
          {
            tagMode: "replace",
          }
        );

      assert(
        r.status === 200,
        `Replace commit ${r.status}`
      );

      const detail =
        await findContact(
          baseEmail
        );

      assert(
        detail.contact.tags.length ===
          1 &&
        detail.contact.tags[0] ===
          "needs_follow_up",
        `Tag replace failed: ${JSON.stringify(detail.contact.tags)}`
      );
    }
  );

  await test(
    "15 Per-row Update overrides global Skip",
    async () => {
      const row =
        baseRow({
          name:
            `QA Row Override ${suffix}`,
          email: baseEmail,
          phone: basePhone,
          tags:
            "Needs Follow-up",
        });

      row.Stage = "";

      const buffer =
        csvFile([row]);

      const p =
        await preview(
          "qa-row-action.csv",
          buffer
        );

      const rowNumber =
        String(
          p.data.previewRows[0]
            .rowNumber
        );

      const r =
        await commit(
          "qa-row-action.csv",
          buffer,
          p.data,
          {
            existingAction:
              "skip",
            rowActions: {
              [rowNumber]:
                "update",
            },
          }
        );

      assert(
        r.status === 200,
        `Row action ${r.status}`
      );

      assert(
        r.data.summary?.updated === 1,
        "Per-row Update failed"
      );
    }
  );

  const unknownName =
    `QA Unknown ${suffix}`;

  const unknownEmail =
    `qa.unknown.${suffix}@example.com`;

  const unknownBuffer =
    csvFile([
      baseRow({
        name:
          `QA Unknown ${suffix}`,
        email: unknownEmail,
        phone:
          `+19991${String(Date.now()).slice(-6)}`,
        tags: unknownName,
      }),
    ]);

  let unknownPreview;

  await test(
    "16 Unknown tag detected",
    async () => {
      const r =
        await preview(
          "qa-unknown.csv",
          unknownBuffer
        );

      assert(
        r.status === 200,
        `Unknown preview ${r.status}`
      );

      unknownPreview =
        r.data;

      assert(
        r.data.summary
          ?.unknownTags === 1,
        "Unknown tag not detected"
      );
    }
  );

  await test(
    "17 Unresolved tag blocks commit",
    async () => {
      const r =
        await commit(
          "qa-unknown.csv",
          unknownBuffer,
          unknownPreview,
          {
            tagMappings: {},
          }
        );

      assert(
        r.status === 400,
        `Expected 400, got ${r.status}`
      );
    }
  );

  await test(
    "18 Invalid tag mapping rejected",
    async () => {
      const key =
        unknownPreview
          .unknownTags[0]
          .mappingKey;

      const r =
        await commit(
          "qa-unknown.csv",
          unknownBuffer,
          unknownPreview,
          {
            tagMappings: {
              [key]:
                "definitely_not_a_real_tag",
            },
          }
        );

      assert(
        r.status === 400,
        `Expected invalid mapping 400, got ${r.status}`
      );
    }
  );

  await test(
    "19 Sales may ignore unknown tag",
    async () => {
      const email =
        `qa.sales.ignore.${suffix}@example.com`;

      const buffer =
        csvFile([
          baseRow({
            name:
              `QA Sales Ignore ${suffix}`,
            email,
            phone:
              `+19992${String(Date.now()).slice(-6)}`,
            tags:
              `Unknown Ignore ${suffix}`,
          }),
        ]);

      const p =
        await preview(
          "qa-sales-ignore.csv",
          buffer,
          salesToken
        );

      const key =
        p.data.unknownTags[0]
          .mappingKey;

      const r =
        await commit(
          "qa-sales-ignore.csv",
          buffer,
          p.data,
          {
            token: salesToken,
            tagMappings: {
              [key]:
                "__ignore__",
            },
          }
        );

      assert(
        r.status === 200,
        `Sales ignore ${r.status}`
      );

      assert(
        r.data.summary?.created === 1,
        "Sales ignore import failed"
      );
    }
  );

  await test(
    "20 Sales maps unknown to approved tag",
    async () => {
      const email =
        `qa.sales.map.${suffix}@example.com`;

      const buffer =
        csvFile([
          baseRow({
            name:
              `QA Sales Map ${suffix}`,
            email,
            phone:
              `+19993${String(Date.now()).slice(-6)}`,
            tags:
              `Unknown Map ${suffix}`,
          }),
        ]);

      const p =
        await preview(
          "qa-sales-map.csv",
          buffer,
          salesToken
        );

      const key =
        p.data.unknownTags[0]
          .mappingKey;

      const r =
        await commit(
          "qa-sales-map.csv",
          buffer,
          p.data,
          {
            token: salesToken,
            tagMappings: {
              [key]:
                "website_lead",
            },
          }
        );

      assert(
        r.status === 200,
        `Sales mapping ${r.status}`
      );

      const detail =
        await findContact(
          email
        );

      assert(
        detail?.contact,
        "Sales import succeeded but persisted contact could not be verified by Admin"
      );

      assert(
        detail.contact.tags.includes(
          "website_lead"
        ),
        "Approved mapped tag missing"
      );
    }
  );

  await test(
    "21 Sales cannot create controlled tag",
    async () => {
      const email =
        `qa.sales.create.${suffix}@example.com`;

      const buffer =
        csvFile([
          baseRow({
            name:
              `QA Sales Create ${suffix}`,
            email,
            phone:
              `+19994${String(Date.now()).slice(-6)}`,
            tags:
              `Sales Cannot Create ${suffix}`,
          }),
        ]);

      const p =
        await preview(
          "qa-sales-create.csv",
          buffer,
          salesToken
        );

      const key =
        p.data.unknownTags[0]
          .mappingKey;

      const r =
        await commit(
          "qa-sales-create.csv",
          buffer,
          p.data,
          {
            token: salesToken,
            tagMappings: {
              [key]:
                "__create__",
            },
          }
        );

      assert(
        r.status === 403,
        `Expected Sales 403, got ${r.status}`
      );

      const detail =
        await findContact(
          email
        );

      assert(
        detail === null,
        "Forbidden Sales import still created a contact"
      );
    }
  );

  let createdTagId;
  let createdTagKey;
  let createdTagName;
  let createdTagContactEmail;

  await test(
    "22 Admin creates controlled tag",
    async () => {
      const email =
        `qa.admin.create.${suffix}@example.com`;

      const tagName =
        `QA Admin Tag ${suffix}`;

      const buffer =
        csvFile([
          baseRow({
            name:
              `QA Admin Create ${suffix}`,
            email,
            phone:
              `+19995${String(Date.now()).slice(-6)}`,
            tags: tagName,
          }),
        ]);

      const p =
        await preview(
          "qa-admin-create.csv",
          buffer
        );

      const key =
        p.data.unknownTags[0]
          .mappingKey;

      const r =
        await commit(
          "qa-admin-create.csv",
          buffer,
          p.data,
          {
            tagMappings: {
              [key]:
                "__create__",
            },
          }
        );

      assert(
        r.status === 200,
        `Admin tag create ${r.status}`
      );

      const tags =
        await request(
          "/crm/tags?includeInactive=true",
          {
            token: adminToken,
          }
        );

      const tag =
        tags.data.tags.find(
          (item) =>
            item.name === tagName
        );

      assert(
        tag?._id,
        "Admin-created tag missing"
      );

      createdTagId =
        tag._id;

      createdTagKey =
        tag.key;

      createdTagName =
        tagName;

      createdTagContactEmail =
        email;

      const detail =
        await findContact(
          email
        );

      assert(
        detail.contact.tags.includes(
          tag.key
        ),
        "Created tag not attached"
      );
    }
  );

  await test(
    "23 Archive temporary QA tag",
    async () => {
      const r =
        await request(
          `/crm/tags/${createdTagId}`,
          {
            method: "PATCH",
            token: adminToken,
            body: {
              active: false,
            },
          }
        );

      assert(
        r.status === 200,
        `Tag archive ${r.status}`
      );

      const tags =
        await request(
          "/crm/tags",
          {
            token: adminToken,
          }
        );

      assert(
        (tags.data.tags || [])
          .length === 21,
        `Expected 21 active tags, got ${(tags.data.tags || []).length}`
      );
    }
  );

  await test(
    "23A Archived tag blocked from new import",
    async () => {
      assert(
        createdTagKey &&
          createdTagName,
        "Archived-tag fixture missing"
      );

      const email =
        `qa.archived.tag.${suffix}@example.com`;

      const buffer =
        csvFile([
          baseRow({
            name:
              `QA Archived Tag ${suffix}`,
            email,
            phone:
              `+19998${String(Date.now()).slice(-6)}`,
            tags:
              createdTagName,
          }),
        ]);

      const p =
        await preview(
          "qa-archived-tag.csv",
          buffer
        );

      assert(
        p.status === 200,
        `Archived-tag preview ${p.status}`
      );

      assert(
        p.data.summary?.unknownTags ===
          1,
        "Archived tag was incorrectly treated as active during preview"
      );

      const mappingKey =
        p.data.unknownTags?.[0]
          ?.mappingKey;

      assert(
        mappingKey,
        "Archived tag did not produce an unknown-tag mapping key"
      );

      const mapped =
        await commit(
          "qa-archived-tag.csv",
          buffer,
          p.data,
          {
            tagMappings: {
              [mappingKey]:
                createdTagKey,
            },
          }
        );

      assert(
        mapped.status === 400,
        `Archived tag mapping should return 400, got ${mapped.status}`
      );

      const recreated =
        await commit(
          "qa-archived-tag.csv",
          buffer,
          p.data,
          {
            tagMappings: {
              [mappingKey]:
                "__create__",
            },
          }
        );

      assert(
        recreated.status === 400,
        `Archived tag recreation should return 400, got ${recreated.status}`
      );

      assert(
        String(
          recreated.data?.message ||
            ""
        )
          .toLowerCase()
          .includes("archived"),
        "Archived-tag recreation response did not explain the archived-tag conflict"
      );

      const detail =
        await findContact(
          email
        );

      assert(
        detail === null,
        "Rejected archived-tag import still created a CRM contact"
      );
    }
  );

  await test(
    "23B Historical export preserves archived tag",
    async () => {
      assert(
        createdTagKey &&
          createdTagName &&
          createdTagContactEmail,
        "Historical archived-tag fixture missing"
      );

      const r =
        await download(
          `/crm/contacts/export?format=csv&tags=${encodeURIComponent(
            createdTagKey
          )}`,
          adminToken
        );

      assert(
        r.status === 200,
        `Historical archived-tag export ${r.status}`
      );

      const text =
        r.buffer
          .toString("utf8")
          .replace(
            /^\uFEFF/,
            ""
          );

      assert(
        text.includes(
          createdTagContactEmail
        ),
        "Historical contact missing from archived-tag export"
      );

      assert(
        text.includes(
          createdTagName
        ),
        "Archived tag display name was not preserved in historical export"
      );
    }
  );

  const xlsxEmail =
    `qa.xlsx.${suffix}@example.com`;

  let xlsxBuffer;
  let xlsxPreview;

  await test(
    "24 XLSX preview",
    async () => {
      xlsxBuffer =
        await xlsxFile([
          baseRow({
            name:
              `QA XLSX ${suffix}`,
            email: xlsxEmail,
            phone:
              `+19996${String(Date.now()).slice(-6)}`,
            tags: "Hot Lead",
          }),
        ]);

      const r =
        await preview(
          "qa-import.xlsx",
          xlsxBuffer
        );

      assert(
        r.status === 200,
        `XLSX preview ${r.status}`
      );

      assert(
        r.data.summary?.new === 1,
        "XLSX preview did not classify new"
      );

      xlsxPreview =
        r.data;
    }
  );

  await test(
    "25 XLSX commit",
    async () => {
      const r =
        await commit(
          "qa-import.xlsx",
          xlsxBuffer,
          xlsxPreview
        );

      assert(
        r.status === 200,
        `XLSX commit ${r.status}`
      );

      assert(
        r.data.summary?.created === 1,
        "XLSX contact not created"
      );

      const detail =
        await findContact(
          xlsxEmail
        );

      assert(
        detail.contact.tags.includes(
          "hot_lead"
        ),
        "XLSX tag missing"
      );
    }
  );

  await test(
    "26 Filtered CSV export",
    async () => {
      const r =
        await download(
          "/crm/contacts/export?format=csv&tags=hot_lead",
          adminToken
        );

      assert(
        r.status === 200,
        `CSV export ${r.status}`
      );

      const text =
        r.buffer
          .toString("utf8")
          .replace(/^\uFEFF/, "");

      assert(
        text.includes(
          xlsxEmail
        ),
        "Filtered CSV missing contact"
      );

      assert(
        text.includes(
          "Hot Lead"
        ),
        "CSV tag display name missing"
      );
    }
  );

  await test(
    "27 Filtered XLSX export",
    async () => {
      const r =
        await download(
          "/crm/contacts/export?format=xlsx&tags=hot_lead",
          adminToken
        );

      assert(
        r.status === 200,
        `XLSX export ${r.status}`
      );

      const workbook =
        new ExcelJS.Workbook();

      await workbook.xlsx.load(
        r.buffer
      );

      const values = [];

      workbook
        .worksheets[0]
        .eachRow(
          (row) => {
            values.push(
              row.values
                .slice(1)
                .map(String)
                .join("|")
            );
          }
        );

      assert(
        values.some(
          (line) =>
            line.includes(
              xlsxEmail
            )
        ),
        "Filtered XLSX missing contact"
      );

      assert(
        values.some(
          (line) =>
            line.includes(
              "Hot Lead"
            )
        ),
        "XLSX tag name missing"
      );
    }
  );

  await test(
    "28 Invalid export stage rejected",
    async () => {
      const r =
        await request(
          "/crm/contacts/export?format=csv&stage=not_a_stage",
          {
            token: adminToken,
          }
        );

      assert(
        r.status === 400,
        `Invalid stage returned ${r.status}`
      );
    }
  );

  await test(
    "29 Legacy XLS import rejected",
    async () => {
      const form =
        makeForm(
          "legacy.xls",
          csvFile([
            baseRow({
              email:
                `qa.xls.${suffix}@example.com`,
            }),
          ])
        );

      const r =
        await request(
          "/crm/contacts/import/preview",
          {
            method: "POST",
            token: adminToken,
            form,
          }
        );

      assert(
        r.status === 400,
        `Legacy XLS returned ${r.status}`
      );
    }
  );

  await test(
    "30 Commit requires mapping",
    async () => {
      const buffer =
        csvFile([
          baseRow({
            email:
              `qa.nomapping.${suffix}@example.com`,
            phone:
              `+19997${String(Date.now()).slice(-6)}`,
          }),
        ]);

      const form =
        makeForm(
          "qa-no-mapping.csv",
          buffer,
          {
            mapping: {},
            tagMappings: {},
            existingAction:
              "update",
            rowActions: {},
            tagMode: "merge",
          }
        );

      const r =
        await request(
          "/crm/contacts/import/commit",
          {
            method: "POST",
            token: adminToken,
            form,
          }
        );

      assert(
        r.status === 400,
        `Missing mapping returned ${r.status}`
      );
    }
  );

  console.log();
  console.log(
    "========================================"
  );
  console.log(
    "FITLUNGE CRM DATA QA COMPLETE"
  );
  console.log(
    "========================================"
  );
  console.log("33/33 PASSED");
  console.log(
    `QA suffix: ${suffix}`
  );
  console.log();
  console.log(
    "No production API was contacted."
  );
  console.log(
    "QA records remain in the isolated QA database."
  );
}

main().catch((error) => {
  console.error();
  console.error(
    "========================================"
  );
  console.error(
    "FITLUNGE CRM DATA QA STOPPED"
  );
  console.error(
    "========================================"
  );
  console.error(error);
  console.error();
  console.error(
    "No production API was contacted."
  );
  console.error(
    "Failing QA records remain in the isolated QA database."
  );
  process.exit(1);
});
