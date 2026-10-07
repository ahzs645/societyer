/** Portable intake staging functions (hosted Convex, browser-local, Electron).
 * A run stores files, text/layout extracts, clusters and field-level
 * extractions; reviewers accept/edit/reject fields or mark them as
 * "can't represent"; promotion leaves a fieldProvenance row per field.
 * Authorization: the action policy maps the `intake` domain to the settings
 * resource (as import sessions are); reading extracted content additionally
 * needs documents:read, and restricted files need settings:write. */
import type { PortableMutationCtx, PortableQueryCtx } from "../portable/ctx";
import { getOwned, principalUserId } from "./access";
import { requirePermissionPortable } from "./permissions";
import { validateExtraction } from "../intake/schemas";
import { isFieldValue, verifyRecord } from "../intake/verify";
import type { IntakeBlock } from "../intake/blocks";
import { hydrateProvenance, resolveFieldPath } from "../intake/provenance";

const now = () => new Date().toISOString();
const MAX_BLOCK_BYTES = 850_000;
const RUN_STATUSES = new Set(["created", "running", "extracted", "reviewing", "completed", "failed", "cancelled"]);
const DISPOSITIONS = new Set(["pending", "extract", "catalogue", "excluded", "junk", "duplicate", "restricted"]);
const DECISIONS = new Set(["accept", "edit", "reject", "cant_represent"]);
const PROVENANCE_TABLES = new Set(["meetings", "minutes", "motions", "tasks", "meetingAttendanceRecords", "agendas", "agendaItems", "policies", "filings", "directors", "members", "peopleDirectory", "committees", "committeeMembers", "documents", "grants", "insurancePolicies", "financials", "bylawAmendments", "boardRoleAssignments", "roleHolders", "deadlines"]);
function sanitizeLocator(locator: any) {
  const kinds = ["block", "page_text", "cell", "email_header", "filename", "path"];
  return compact({
    fileId: optionalText(locator?.fileId, 600), kind: kinds.includes(locator?.kind) ? locator.kind : "block", blockIndex: optionalNumber(locator?.blockIndex), page: optionalNumber(locator?.page),
    sheet: optionalText(locator?.sheet, 200), cell: optionalText(locator?.cell, 40), charStart: optionalNumber(locator?.charStart), charEnd: optionalNumber(locator?.charEnd), quote: optionalText(locator?.quote, 400),
  });
}
const EXTRACTION_STATUSES = new Set(["pending_review", "in_review", "accepted", "promoted", "rejected", "covered"]);

async function canRead(ctx: PortableQueryCtx, societyId: string) {
  await requirePermissionPortable(ctx, societyId, "settings:read");
}
async function canReadContent(ctx: PortableQueryCtx, societyId: string, sensitivity?: string) {
  await requirePermissionPortable(ctx, societyId, "documents:read");
  if (sensitivity === "restricted") await requirePermissionPortable(ctx, societyId, "settings:write");
}
async function canWrite(ctx: PortableQueryCtx, societyId: string) {
  await requirePermissionPortable(ctx, societyId, "settings:write");
}
async function ownedRun(ctx: PortableQueryCtx, societyId: string, runId: string) {
  return getOwned<any>(ctx, "intakeRuns", runId, societyId);
}
async function runRows(ctx: PortableQueryCtx, table: string, runId: string) {
  return ctx.db.query(table).withIndex("by_run", (q) => q.eq("runId", runId)).collect();
}
async function fileByKey(ctx: PortableQueryCtx, runId: string, fileKey: string) {
  return ctx.db.query("intakeFiles").withIndex("by_run_file_key", (q) => q.eq("runId", runId).eq("fileKey", fileKey)).first() as Promise<any>;
}
const text = (value: unknown, field: string, max = 2000): string => {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${field} is required.`);
  if (value.length > max) throw new Error(`${field} is too long.`);
  return value;
};
const optionalText = (value: unknown, max = 4000): string | undefined => (typeof value === "string" && value.trim() ? value.slice(0, max) : undefined);
const optionalNumber = (value: unknown): number | undefined => (typeof value === "number" && Number.isFinite(value) ? value : undefined);
const compact = <T extends Record<string, unknown>>(row: T): T => Object.fromEntries(Object.entries(row).filter(([, value]) => value !== undefined)) as T;

// ---------------------------------------------------------------- queries
export async function listRuns(ctx: PortableQueryCtx, { societyId }: { societyId: string }) {
  await canRead(ctx, societyId);
  const runs = await ctx.db.query("intakeRuns").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect();
  return runs
    .map((run: any) => ({ _id: run._id, name: run.name, sourceKind: run.sourceKind, status: run.status, engine: run.engine, stats: run.stats, coverage: run.coverage?.headline, recordGaps: run.recordGaps?.length ?? 0, createdAtISO: run.createdAtISO, updatedAtISO: run.updatedAtISO, completedAtISO: run.completedAtISO }))
    .sort((a: any, b: any) => b.createdAtISO.localeCompare(a.createdAtISO));
}

export async function getRun(ctx: PortableQueryCtx, { societyId, runId }: { societyId: string; runId: string }) {
  await canRead(ctx, societyId);
  const run = await ownedRun(ctx, societyId, runId);
  const [files, extractions, clusters] = await Promise.all([
    runRows(ctx, "intakeFiles", runId),
    // Counts only: the field trees stay unloaded.
    ctx.db.query("intakeExtractions").withIndex("by_run", (q) => q.eq("runId", runId)).omitFields("record", "unsupported", "references", "verification").collect(),
    runRows(ctx, "intakeClusters", runId),
  ]);
  const count = (rows: any[], key: string) => rows.reduce<Record<string, number>>((acc, row) => ({ ...acc, [row[key] ?? "unknown"]: (acc[row[key] ?? "unknown"] ?? 0) + 1 }), {});
  return {
    ...run,
    counts: {
      files: files.length,
      byDisposition: count(files, "disposition"),
      byClass: count(files, "docClass"),
      extractions: extractions.length,
      byExtractionStatus: count(extractions, "status"),
      clusters: clusters.length,
    },
  };
}

export async function listFiles(ctx: PortableQueryCtx, { societyId, runId }: { societyId: string; runId: string }) {
  await canRead(ctx, societyId);
  await ownedRun(ctx, societyId, runId);
  return (await runRows(ctx, "intakeFiles", runId)).sort((a: any, b: any) => a.path.localeCompare(b.path));
}

export async function listClusters(ctx: PortableQueryCtx, { societyId, runId }: { societyId: string; runId: string }) {
  await canRead(ctx, societyId);
  await ownedRun(ctx, societyId, runId);
  return runRows(ctx, "intakeClusters", runId);
}

/** Review queue: risk-ordered summaries (legal weight × (1 − confidence) × verification problems). */
export async function listExtractions(ctx: PortableQueryCtx, { societyId, runId }: { societyId: string; runId: string }) {
  await canRead(ctx, societyId);
  await ownedRun(ctx, societyId, runId);
  // Memoized per row revision locally: the queue never loads every extraction's field tree again.
  const rows = await ctx.db.query("intakeExtractions").withIndex("by_run", (q) => q.eq("runId", runId)).collectProjected("intake.queueItem/v1", queueItem);
  return rows.sort((a: any, b: any) => b.risk - a.risk);
}

/** One review-queue row (pure: memoized per extraction revision). */
function queueItem(row: any) {
  const record = row.record ?? {};
  const motions = record.motions?.length ?? 0;
  const verification = row.verification ?? {};
  const lowConfidence = countFields(record, (field) => field.confidence < 0.7);
  const risk = (motions * 3 + (record.attendance?.length ?? 0) * 0.2 + (record.actionItems?.length ?? 0)) * (1 + lowConfidence / 10) * (1 + (verification.mismatched ?? 0));
  return {
    _id: row._id, fileId: row.fileId, fileKey: row.fileKey, ...(row.parentFileKey ? { parentFileKey: row.parentFileKey } : {}), docClass: row.docClass, engine: row.engine, model: row.model, status: row.status,
    date: recordDate(record), body: record.bodyLabel?.value ?? record.body?.value, motions, attendance: record.attendance?.length ?? 0,
    actionItems: record.actionItems?.length ?? 0, unsupported: row.unsupported?.length ?? 0, verification, lowConfidenceFields: lowConfidence, risk: Number(risk.toFixed(2)),
    summary: recordSummary(row.docClass, record), ...(row.promotion ? { promotion: row.promotion } : {}),
  };
}

/** The date that identifies a record of any class (meeting, period end, term, filing, letter). */
function recordDate(record: any): string | undefined {
  for (const key of ["date", "meetingDate", "periodEnd", "termStart", "filedDate", "adoptedDate", "effectiveDate", "effective", "asOfDate"]) {
    const iso = record?.[key]?.value?.iso;
    if (typeof iso === "string" && iso) return iso;
  }
  return undefined;
}

const CLASS_NOUN: Record<string, string> = {
  meetingMinutes: "Minutes", agenda: "Agenda", meetingPackage: "Meeting package", agmMaterial: "AGM material", bylaws: "Bylaws", policy: "Policy", directorConsent: "Consent to act",
  proxy: "Proxy", roster: "Roster", financialStatement: "Financial statement", budget: "Budget", insurance: "Insurance", agreement: "Agreement", grant: "Grant",
  registryFiling: "Registry filing", correspondence: "Correspondence", invoice: "Invoice",
};

/** One line describing a non-minutes record in the review queue ("Policy · Delegation of Signing Authority"). */
function recordSummary(docClass: string, record: any): string | undefined {
  if (docClass === "meetingMinutes") return undefined;
  const value = (key: string) => record?.[key]?.value;
  const text = (input: unknown) => (typeof input === "string" ? input : input && typeof input === "object" ? String((input as any).text ?? (input as any).nameAsWritten ?? "") : "").trim();
  const count = (key: string, noun: string) => (Array.isArray(record?.[key]) && record[key].length ? `${record[key].length} ${noun}${record[key].length === 1 ? "" : "s"}` : "");
  const detail = {
    agenda: count("items", "item"), meetingPackage: count("items", "item"), agmMaterial: count("agendaItems", "item"),
    bylaws: text(value("title")), policy: text(value("title")), grant: text(value("title")), agreement: text(value("title")),
    directorConsent: text(record?.entries?.[0]?.person?.value), proxy: count("entries", "entry"), roster: count("entries", "person"),
    financialStatement: text(value("title")) || String(value("statementType") ?? "").replace(/_/g, " "), budget: text(value("title")) || count("lines", "line"),
    insurance: [text(value("insurer")), text(value("policyNumber"))].filter(Boolean).join(" · "), registryFiling: String(value("filingType") ?? "").replace(/_/g, " "),
    correspondence: text(value("subject")), invoice: [text(value("vendor")), text(value("amount"))].filter(Boolean).join(" · "),
  }[docClass as "agenda"];
  const noun = CLASS_NOUN[docClass] ?? docClass;
  return [noun, detail].filter(Boolean).join(" · ").slice(0, 140);
}

function countFields(record: unknown, predicate: (field: any) => boolean): number {
  let count = 0;
  const visit = (node: unknown) => {
    if (Array.isArray(node)) return node.forEach(visit);
    if (!node || typeof node !== "object") return;
    if (isFieldValue(node)) {
      if (predicate(node)) count++;
      return;
    }
    Object.values(node).forEach(visit);
  };
  visit(record);
  return count;
}

/** One extraction with its source blocks and reviews: the side-by-side review payload. */
export async function getExtraction(ctx: PortableQueryCtx, { societyId, extractionId }: { societyId: string; extractionId: string }) {
  await canRead(ctx, societyId);
  const extraction = await getOwned<any>(ctx, "intakeExtractions", extractionId, societyId);
  const file = await getOwned<any>(ctx, "intakeFiles", extraction.fileId, societyId);
  await canReadContent(ctx, societyId, file.sensitivity);
  const extract = await ctx.db.query("intakeExtracts").withIndex("by_file", (q) => q.eq("fileId", file._id)).first();
  const reviews = await ctx.db.query("intakeFieldReviews").withIndex("by_extraction", (q) => q.eq("extractionId", extractionId)).collect();
  return { extraction, file, extract, reviews };
}

export async function getExtractionInput(ctx: PortableQueryCtx, { societyId, runId, fileKey }: { societyId: string; runId: string; fileKey: string }) {
  await canWrite(ctx, societyId);
  await ownedRun(ctx, societyId, runId);
  const file = await fileByKey(ctx, runId, fileKey);
  if (!file || file.societyId !== societyId) throw new Error("Intake file not found.");
  await canReadContent(ctx, societyId, file.sensitivity);
  const extract = await ctx.db.query("intakeExtracts").withIndex("by_file", (q) => q.eq("fileId", file._id)).first();
  return { file, extract };
}

export async function processingLog(ctx: PortableQueryCtx, { societyId, runId }: { societyId: string; runId: string }) {
  await canRead(ctx, societyId);
  await ownedRun(ctx, societyId, runId);
  return (await runRows(ctx, "intakeProcessingLog", runId)).sort((a: any, b: any) => a.atISO.localeCompare(b.atISO));
}

export async function provenanceForRecord(ctx: PortableQueryCtx, { societyId, targetTable, targetId }: { societyId: string; targetTable: string; targetId: string }) {
  await canRead(ctx, societyId);
  const rows = await ctx.db.query("fieldProvenance").withIndex("by_target", (q) => q.eq("targetTable", targetTable).eq("targetId", targetId)).collect();
  return hydrateProvenance(ctx, rows.filter((row: any) => row.societyId === societyId));
}

// ---------------------------------------------------------------- mutations
export async function createRun(ctx: PortableMutationCtx, args: { societyId: string; name: string; sourceKind: string; sourceRoot?: string; settings?: unknown; engine?: unknown }) {
  await canWrite(ctx, args.societyId);
  if (!["local_folder", "drive_inventory", "upload"].includes(args.sourceKind)) throw new Error("Unsupported intake source kind.");
  const createdByUserId = await principalUserId(ctx, args.societyId).catch(() => undefined);
  return ctx.db.insert("intakeRuns", compact({
    societyId: args.societyId, name: text(args.name, "Run name", 200), sourceKind: args.sourceKind, sourceRoot: optionalText(args.sourceRoot, 1000),
    status: "created", settings: args.settings, engine: args.engine, createdByUserId, createdAtISO: now(), updatedAtISO: now(),
  }));
}

export async function updateRun(ctx: PortableMutationCtx, { societyId, runId, patch }: { societyId: string; runId: string; patch: Record<string, any> }) {
  await canWrite(ctx, societyId);
  await ownedRun(ctx, societyId, runId);
  const allowed = ["status", "stats", "coverage", "recordGaps", "reconciliation", "engine", "settings", "importSessionId", "bundleDocumentId", "name"];
  const unknown = Object.keys(patch ?? {}).filter((key) => !allowed.includes(key));
  if (unknown.length) throw new Error(`Unsupported run fields: ${unknown.join(", ")}.`);
  if (patch.status !== undefined && !RUN_STATUSES.has(patch.status)) throw new Error("Unsupported run status.");
  for (const key of ["importSessionId", "bundleDocumentId"]) if (patch[key]) await getOwned(ctx, "documents", patch[key], societyId);
  await ctx.db.patch(runId, compact({ ...patch, updatedAtISO: now(), ...(patch.status === "completed" ? { completedAtISO: now() } : {}) }));
  return runId;
}

type FileInput = { fileKey: string; name: string; path: string; driveId?: string; revision?: string; md5?: string; sha256?: string; mimeType?: string; sizeBytes?: number; modifiedTime?: string; url?: string; acquisitionStatus: string; disposition: string; dispositionReason?: string; classification?: any; sensitivity?: string; clusterKey?: string };

export async function recordFiles(ctx: PortableMutationCtx, { societyId, runId, files }: { societyId: string; runId: string; files: FileInput[] }) {
  await canWrite(ctx, societyId);
  await ownedRun(ctx, societyId, runId);
  if (!Array.isArray(files) || files.length > 250) throw new Error("Record at most 250 files per call.");
  const ids: string[] = [];
  for (const file of files) {
    if (!DISPOSITIONS.has(file.disposition)) throw new Error(`Unsupported disposition for ${file.fileKey}.`);
    const row = compact({
      societyId, runId, fileKey: text(file.fileKey, "fileKey", 600), name: text(file.name, "name", 500), path: text(file.path, "path", 2000),
      driveId: optionalText(file.driveId, 200), revision: optionalText(file.revision, 200), md5: optionalText(file.md5, 64), sha256: optionalText(file.sha256, 64),
      mimeType: optionalText(file.mimeType, 200), sizeBytes: optionalNumber(file.sizeBytes), modifiedTime: optionalText(file.modifiedTime, 64), url: optionalText(file.url, 1000),
      acquisitionStatus: text(file.acquisitionStatus, "acquisitionStatus", 40), disposition: file.disposition, dispositionReason: optionalText(file.dispositionReason, 1000),
      docClass: optionalText(file.classification?.docClass, 60), classification: file.classification, sensitivity: optionalText(file.sensitivity, 20), clusterKey: optionalText(file.clusterKey, 700),
      updatedAtISO: now(),
    });
    const existing = await fileByKey(ctx, runId, file.fileKey);
    if (existing) {
      await ctx.db.patch(existing._id, row);
      ids.push(existing._id);
    } else ids.push(await ctx.db.insert("intakeFiles", { ...row, createdAtISO: now() }));
  }
  await ctx.db.patch(runId, { updatedAtISO: now() });
  return ids;
}

export async function saveExtract(ctx: PortableMutationCtx, { societyId, runId, fileKey, extract }: { societyId: string; runId: string; fileKey: string; extract: { method: string; methodVersion: string; blocks: IntakeBlock[]; text?: string; pageCount?: number; sheetNames?: string[]; emptyPages?: number[]; warnings?: string[] } }) {
  await canWrite(ctx, societyId);
  await ownedRun(ctx, societyId, runId);
  const file = await fileByKey(ctx, runId, fileKey);
  if (!file) throw new Error("Record the intake file before its extract.");
  if (!Array.isArray(extract?.blocks)) throw new Error("Extract blocks are required.");
  const warnings = [...(extract.warnings ?? [])];
  let blocks = extract.blocks;
  let body = typeof extract.text === "string" ? extract.text : undefined;
  // Document rows are bounded: keep the leading blocks and say so (the CLI output keeps everything).
  if (JSON.stringify(blocks).length + (body?.length ?? 0) > MAX_BLOCK_BYTES) {
    let size = 0;
    blocks = blocks.filter((block) => (size += JSON.stringify(block).length * 2) < MAX_BLOCK_BYTES);
    body = body?.slice(0, blocks[blocks.length - 1]?.charEnd ?? 0);
    warnings.push(`Stored the first ${blocks.length} of ${extract.blocks.length} blocks; the full extract is in the run output.`);
  }
  const row = compact({ societyId, runId, fileId: file._id, method: text(extract.method, "method", 60), methodVersion: text(extract.methodVersion, "methodVersion", 120), blocks, text: body, textLength: body?.length ?? 0, pageCount: optionalNumber(extract.pageCount), sheetNames: extract.sheetNames, emptyPages: extract.emptyPages, warnings, createdAtISO: now() });
  const existing = await ctx.db.query("intakeExtracts").withIndex("by_file", (q) => q.eq("fileId", file._id)).first();
  if (existing) {
    await ctx.db.replace(existing._id, row);
    return existing._id;
  }
  return ctx.db.insert("intakeExtracts", row);
}

export async function saveClusters(ctx: PortableMutationCtx, { societyId, runId, clusters }: { societyId: string; runId: string; clusters: Array<{ clusterKey: string; canonicalId: string; members: Array<{ fileId: string; relation: string; score?: number; reason: string }>; method: string }> }) {
  await canWrite(ctx, societyId);
  await ownedRun(ctx, societyId, runId);
  if (!Array.isArray(clusters) || clusters.length > 500) throw new Error("Save at most 500 clusters per call.");
  const ids: string[] = [];
  for (const cluster of clusters) {
    const resolve = async (fileKey: string) => (await fileByKey(ctx, runId, fileKey))?._id;
    const members: Array<Record<string, unknown>> = [];
    for (const member of cluster.members) members.push(compact({ fileKey: member.fileId, fileId: await resolve(member.fileId), relation: member.relation, score: optionalNumber(member.score), reason: member.reason }));
    const existing = (await runRows(ctx, "intakeClusters", runId)).find((row: any) => row.clusterKey === cluster.clusterKey);
    const row = compact({ societyId, runId, clusterKey: cluster.clusterKey, canonicalFileKey: cluster.canonicalId, canonicalFileId: await resolve(cluster.canonicalId), members, method: cluster.method, createdAtISO: now() });
    if (existing) {
      await ctx.db.replace(existing._id, row);
      ids.push(existing._id);
    } else ids.push(await ctx.db.insert("intakeClusters", row));
  }
  return ids;
}

/** Stores an extraction after validating it against the class schema and
 * re-verifying every quoted locator against the stored extract (server-side). */
export async function saveExtraction(ctx: PortableMutationCtx, { societyId, runId, fileKey, extraction }: { societyId: string; runId: string; fileKey: string; extraction: any }) {
  await canWrite(ctx, societyId);
  await ownedRun(ctx, societyId, runId);
  const file = await fileByKey(ctx, runId, fileKey);
  if (!file) throw new Error("Record the intake file before its extraction.");
  const envelope = { ...extraction, fileId: fileKey };
  const validation = validateExtraction(envelope);
  if (!validation.ok) throw new Error(`Extraction does not match the intake schema: ${validation.issues.slice(0, 5).join("; ")}`);
  const extract = await ctx.db.query("intakeExtracts").withIndex("by_file", (q) => q.eq("fileId", file._id)).first() as any;
  const record = JSON.parse(JSON.stringify(envelope.record));
  const verification = extract?.text !== undefined ? verifyRecord(record, { blocks: extract.blocks, text: extract.text }) : extraction.verification ?? null;
  const row = compact({
    societyId, runId, fileId: file._id, fileKey, docClass: envelope.docClass, schemaVersion: envelope.schemaVersion, engine: envelope.engine, model: optionalText(envelope.model, 200),
    record, unsupported: envelope.unsupported, references: envelope.references, warnings: envelope.warnings, verification: verification ?? undefined, status: "pending_review", updatedAtISO: now(),
  });
  const existing = (await ctx.db.query("intakeExtractions").withIndex("by_file", (q) => q.eq("fileId", file._id)).collect()).find((candidate: any) => candidate.engine === envelope.engine);
  if (existing) {
    if ((existing as any).status === "promoted") throw new Error("A promoted extraction cannot be replaced; start a new run.");
    // Batch reviews read accepted values from the extraction itself: a reviewed record is never replaced underneath them.
    if (await ctx.db.query("intakeFieldReviews").withIndex("by_extraction", (q) => q.eq("extractionId", existing._id)).first()) throw new Error("This extraction has reviewed fields; start a new run to extract it again.");
    await ctx.db.patch(existing._id, row);
    return existing._id;
  }
  return ctx.db.insert("intakeExtractions", { ...row, createdAtISO: now() });
}

export async function setExtractionStatus(ctx: PortableMutationCtx, { societyId, extractionId, status }: { societyId: string; extractionId: string; status: string }) {
  await canWrite(ctx, societyId);
  const extraction = await getOwned<any>(ctx, "intakeExtractions", extractionId, societyId);
  if (!EXTRACTION_STATUSES.has(status)) throw new Error("Unsupported extraction status.");
  if (extraction.status === "promoted" && status !== "promoted") throw new Error("Promoted extractions are final.");
  await ctx.db.patch(extractionId, { status, updatedAtISO: now() });
  return extractionId;
}

export async function appendProcessingLog(ctx: PortableMutationCtx, { societyId, runId, entries }: { societyId: string; runId: string; entries: any[] }) {
  await canWrite(ctx, societyId);
  await ownedRun(ctx, societyId, runId);
  if (!Array.isArray(entries) || entries.length > 500) throw new Error("Append at most 500 log entries per call.");
  for (const entry of entries) {
    await ctx.db.insert("intakeProcessingLog", compact({
      societyId, runId, atISO: optionalText(entry.atISO, 40) ?? now(), fileKey: optionalText(entry.fileKey, 600), stage: text(entry.stage, "stage", 40),
      provider: optionalText(entry.provider, 60), model: optionalText(entry.model, 200), sentToProvider: entry.sentToProvider === true, redactions: entry.redactions,
      inputChars: optionalNumber(entry.inputChars), inputTokens: optionalNumber(entry.inputTokens), outputTokens: optionalNumber(entry.outputTokens), note: optionalText(entry.note, 1000),
    }));
  }
  return entries.length;
}

export { resolveFieldPath } from "../intake/provenance";

export async function reviewField(ctx: PortableMutationCtx, args: { societyId: string; extractionId: string; fieldPath: string; decision: string; editedValue?: unknown; note?: string; gap?: { infoType?: string; suggestedTarget?: string; description?: string } }) {
  await canWrite(ctx, args.societyId);
  const extraction = await getOwned<any>(ctx, "intakeExtractions", args.extractionId, args.societyId);
  if (extraction.status === "promoted") throw new Error("Promoted extractions are final; review the native record instead.");
  if (!DECISIONS.has(args.decision)) throw new Error("Decision must be accept, edit, reject or cant_represent.");
  const field = resolveFieldPath(extraction.record, args.fieldPath);
  if (args.decision === "edit" && args.editedValue === undefined) throw new Error("An edit needs the corrected value.");
  if (args.decision === "cant_represent" && !args.gap?.description?.trim()) throw new Error("Describe what the app cannot represent.");
  const reviewerUserId = await principalUserId(ctx, args.societyId).catch(() => undefined);
  const id = await ctx.db.insert("intakeFieldReviews", compact({
    societyId: args.societyId, runId: extraction.runId, extractionId: args.extractionId, fieldPath: text(args.fieldPath, "fieldPath", 300), decision: args.decision,
    originalValue: field.value, editedValue: args.decision === "edit" ? args.editedValue : undefined, locators: (field.locators ?? []).slice(0, 20).map(sanitizeLocator), note: optionalText(args.note, 2000),
    gap: args.decision === "cant_represent" ? { ...args.gap, sourceExternalId: extraction.fileKey, locators: field.locators } : undefined,
    reviewerUserId, reviewedAtISO: now(),
  }));
  if (extraction.status === "pending_review") await ctx.db.patch(args.extractionId, { status: "in_review", updatedAtISO: now() });
  return id;
}

export async function recordProvenance(ctx: PortableMutationCtx, { societyId, entries }: { societyId: string; entries: Array<{ targetTable: string; targetId: string; fieldPath: string; extractionId?: string; locator: any; value?: unknown; decision?: string }> }) {
  await canWrite(ctx, societyId);
  if (!Array.isArray(entries) || entries.length > 500) throw new Error("Record at most 500 provenance rows per call.");
  const ids: string[] = [];
  for (const entry of entries) {
    if (!PROVENANCE_TABLES.has(entry.targetTable)) throw new Error(`Provenance is not tracked for ${entry.targetTable}.`);
    await getOwned(ctx, entry.targetTable, entry.targetId, societyId);
    const extraction = entry.extractionId ? await getOwned<any>(ctx, "intakeExtractions", entry.extractionId, societyId) : undefined;
    if (!entry.locator || typeof entry.locator.kind !== "string") throw new Error("Each provenance row needs a source locator.");
    ids.push(await ctx.db.insert("fieldProvenance", compact({
      societyId, targetTable: text(entry.targetTable, "targetTable", 80), targetId: entry.targetId, fieldPath: text(entry.fieldPath, "fieldPath", 300),
      runId: extraction?.runId, extractionId: extraction?._id, fileKey: extraction?.fileKey, locator: sanitizeLocator(entry.locator), value: entry.value, decision: optionalText(entry.decision, 40), createdAtISO: now(),
    })));
  }
  return ids;
}
