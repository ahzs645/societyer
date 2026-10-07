import { defineTable } from "convex/server";
import { v } from "convex/values";

/** AI-led intake staging (docs/intake-extraction-pipeline.md). A run turns a
 * folder of source files into extractions with field-level locators; reviewed
 * fields are promoted to native records, each written field leaving a
 * fieldProvenance row. These tables replace JSON-in-`documents` staging for
 * intake runs. All new tables; no existing table changes. */
const locator = v.object({
  fileId: v.optional(v.string()),
  kind: v.string(), // block | page_text | cell | email_header | filename | path
  blockIndex: v.optional(v.number()),
  page: v.optional(v.number()),
  sheet: v.optional(v.string()),
  cell: v.optional(v.string()),
  charStart: v.optional(v.number()),
  charEnd: v.optional(v.number()),
  quote: v.optional(v.string()),
});

export const intakeTables = {
  intakeRuns: defineTable({
    societyId: v.id("societies"),
    name: v.string(),
    sourceKind: v.string(), // local_folder | drive_inventory | upload
    sourceRoot: v.optional(v.string()),
    status: v.string(), // created | running | extracted | reviewing | completed | failed | cancelled
    engine: v.optional(v.any()), // { minutes, llm?: { provider, model } }
    settings: v.optional(v.any()), // budgetTokens, concurrency, redaction kinds, restricted handling
    stats: v.optional(v.any()),
    coverage: v.optional(v.any()), // native coverage report
    recordGaps: v.optional(v.array(v.any())),
    reconciliation: v.optional(v.any()), // meetings, links, action chains
    bundleDocumentId: v.optional(v.id("documents")),
    importSessionId: v.optional(v.id("documents")),
    createdByUserId: v.optional(v.id("users")),
    createdAtISO: v.string(),
    updatedAtISO: v.string(),
    completedAtISO: v.optional(v.string()),
  }).index("by_society", ["societyId"]),

  intakeFiles: defineTable({
    societyId: v.id("societies"),
    runId: v.id("intakeRuns"),
    fileKey: v.string(), // google-drive:<id>@<revision> | local:<relative path>
    name: v.string(),
    path: v.string(),
    driveId: v.optional(v.string()),
    revision: v.optional(v.string()),
    md5: v.optional(v.string()),
    sha256: v.optional(v.string()),
    mimeType: v.optional(v.string()),
    sizeBytes: v.optional(v.number()),
    modifiedTime: v.optional(v.string()),
    url: v.optional(v.string()),
    acquisitionStatus: v.string(), // listed | downloaded | local | failed | skipped
    disposition: v.string(), // pending | extract | catalogue | excluded | junk | duplicate | restricted
    dispositionReason: v.optional(v.string()),
    docClass: v.optional(v.string()),
    classification: v.optional(v.any()),
    sensitivity: v.optional(v.string()), // standard | personal | restricted
    clusterKey: v.optional(v.string()),
    documentId: v.optional(v.id("documents")),
    createdAtISO: v.string(),
    updatedAtISO: v.string(),
  })
    .index("by_society", ["societyId"])
    .index("by_run", ["runId"])
    .index("by_run_file_key", ["runId", "fileKey"]),

  intakeExtracts: defineTable({
    societyId: v.id("societies"),
    runId: v.id("intakeRuns"),
    fileId: v.id("intakeFiles"),
    method: v.string(), // docx-ooxml | pdfjs-text | xlsx-ooxml | msg-msgreader | libreoffice-docx | plain-text | unsupported
    methodVersion: v.string(),
    blocks: v.array(v.any()), // IntakeBlock[] with page/sheet/cell/charStart/charEnd
    text: v.optional(v.string()),
    textLength: v.number(),
    pageCount: v.optional(v.number()),
    sheetNames: v.optional(v.array(v.string())),
    emptyPages: v.optional(v.array(v.number())),
    ocr: v.optional(v.any()),
    warnings: v.array(v.string()),
    createdAtISO: v.string(),
  })
    .index("by_society", ["societyId"])
    .index("by_run", ["runId"])
    .index("by_file", ["fileId"]),

  intakeClusters: defineTable({
    societyId: v.id("societies"),
    runId: v.id("intakeRuns"),
    clusterKey: v.string(),
    canonicalFileKey: v.string(),
    canonicalFileId: v.optional(v.id("intakeFiles")),
    members: v.array(v.object({
      fileKey: v.string(),
      fileId: v.optional(v.id("intakeFiles")),
      relation: v.string(), // canonical | identical | format-copy | near-duplicate | draft-of | approved-of | version-of | package-embedded
      score: v.optional(v.number()),
      reason: v.string(),
    })),
    method: v.string(),
    createdAtISO: v.string(),
  })
    .index("by_society", ["societyId"])
    .index("by_run", ["runId"]),

  intakeExtractions: defineTable({
    societyId: v.id("societies"),
    runId: v.id("intakeRuns"),
    fileId: v.id("intakeFiles"),
    fileKey: v.string(),
    docClass: v.string(),
    schemaVersion: v.string(),
    engine: v.string(), // deterministic | llm | human
    model: v.optional(v.string()),
    record: v.any(), // FieldValue tree for the class schema
    unsupported: v.array(v.any()),
    references: v.array(v.any()),
    warnings: v.optional(v.array(v.string())),
    verification: v.optional(v.any()), // span re-verification summary
    status: v.string(), // pending_review | in_review | accepted | promoted | rejected
    createdAtISO: v.string(),
    updatedAtISO: v.string(),
  })
    .index("by_society", ["societyId"])
    .index("by_run", ["runId"])
    .index("by_file", ["fileId"]),

  intakeFieldReviews: defineTable({
    societyId: v.id("societies"),
    runId: v.id("intakeRuns"),
    extractionId: v.id("intakeExtractions"),
    fieldPath: v.string(), // e.g. motions[2].movedBy
    decision: v.string(), // accept | edit | reject | cant_represent
    originalValue: v.optional(v.any()),
    editedValue: v.optional(v.any()),
    locators: v.optional(v.array(locator)),
    note: v.optional(v.string()),
    gap: v.optional(v.any()), // representation-gap draft for cant_represent
    reviewerUserId: v.optional(v.id("users")),
    reviewedAtISO: v.string(),
  })
    .index("by_society", ["societyId"])
    .index("by_extraction", ["extractionId"]),

  fieldProvenance: defineTable({
    societyId: v.id("societies"),
    targetTable: v.string(),
    targetId: v.string(),
    fieldPath: v.string(),
    /** The reviewed extraction field this value came from, e.g. motions[2].movedBy (review deep link). */
    sourceFieldPath: v.optional(v.string()),
    runId: v.optional(v.id("intakeRuns")),
    extractionId: v.optional(v.id("intakeExtractions")),
    fileKey: v.optional(v.string()),
    locator: locator,
    value: v.optional(v.any()),
    decision: v.optional(v.string()),
    createdAtISO: v.string(),
  })
    .index("by_society", ["societyId"])
    .index("by_target", ["targetTable", "targetId"])
    .index("by_extraction", ["extractionId"]),

  intakeProcessingLog: defineTable({
    societyId: v.id("societies"),
    runId: v.id("intakeRuns"),
    atISO: v.string(),
    fileKey: v.optional(v.string()),
    stage: v.string(),
    provider: v.optional(v.string()),
    model: v.optional(v.string()),
    sentToProvider: v.boolean(),
    redactions: v.optional(v.any()),
    inputChars: v.optional(v.number()),
    inputTokens: v.optional(v.number()),
    outputTokens: v.optional(v.number()),
    note: v.optional(v.string()),
  })
    .index("by_society", ["societyId"])
    .index("by_run", ["runId"]),
};
