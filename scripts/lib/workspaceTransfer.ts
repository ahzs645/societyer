/**
 * Workspace transfer engine: plan (offline, from a Convex export ZIP), apply,
 * verify, bind, finalize and abort against a destination's internal
 * `workspaceTransfer:*` functions. The CLI is scripts/workspace-transfer.ts and
 * the operator runbook is docs/shared-workspaces/migration-and-cutover.md.
 *
 * Every pass recomputes from the export, never from what the destination holds,
 * so a resumed or repeated run writes the same documents.
 */
import { createHash } from "node:crypto";
import type { ValidatorJSON } from "convex/values";
import { ZipArchive, exportLayout, overriddenIds, type ExportStorageFile, type ZipEntry } from "./convexExportZip";
import { applyPolicy, QUARANTINE_FIELD, TRANSFER_TOTALS, transferPolicy, type TransferRow } from "../../shared/workspaceTransfer/policy";
import {
  idPaths, idTokens, normalizeSha256, rewriteIdTokens, schemaDigest, sha256Hex, societyField, tableValidators,
  transformValue, validateDocument, visitIds, visitStrings, type TableValidators,
} from "../../shared/workspaceTransfer/validators";

export type Severity = "blocking" | "warning" | "info";
export type Finding = { severity: Severity; code: string; table?: string; path?: string; count: number; samples: string[]; message: string };

type IndexEntry = { table: string; societyId?: string };
type SourceRow = { table: string; id: string; doc: TransferRow };
type Totals = Record<string, Record<string, Record<string, number>>>;

export type TransferPlanReport = {
  kind: "societyer.workspaceTransferPlan";
  version: 1;
  exportPath: string;
  exportDigest: string;
  schemaDigest: string;
  planDigest: string;
  sourceSocietyId: string;
  sourceSocietyName: string;
  ok: boolean;
  rows: number;
  files: { count: number; bytes: number };
  layers: number;
  tables: Record<string, { policy: string; copied: number; excluded: number; adopted: number }>;
  stringRewrites: Record<string, number>;
  externalFiles: Record<string, number>;
  totals: Totals;
  components: string[];
  findings: Finding[];
};

export type PlanState = {
  report: TransferPlanReport;
  archive: ZipArchive;
  validators: TableValidators;
  rows: Map<string, SourceRow>;
  files: Map<string, ExportStorageFile>;
  sourceSocietyId: string;
};

const MAX_SAMPLES = 10;

class Findings {
  private readonly byKey = new Map<string, Finding>();
  add(severity: Severity, code: string, message: string, detail: { table?: string; path?: string; sample?: string } = {}) {
    const key = `${severity}|${code}|${detail.table ?? ""}|${detail.path ?? ""}`;
    const found = this.byKey.get(key) ?? { severity, code, message, count: 0, samples: [], ...(detail.table ? { table: detail.table } : {}), ...(detail.path ? { path: detail.path } : {}) };
    found.count += 1;
    if (detail.sample && found.samples.length < MAX_SAMPLES) found.samples.push(detail.sample);
    this.byKey.set(key, found);
  }
  list(): Finding[] {
    const order: Record<Severity, number> = { blocking: 0, warning: 1, info: 2 };
    return [...this.byKey.values()].sort((a, b) => order[a.severity] - order[b.severity] || a.code.localeCompare(b.code) || (a.table ?? "").localeCompare(b.table ?? ""));
  }
}

function parseDocument(line: string, where: string): TransferRow {
  const value: unknown = JSON.parse(line);
  if (typeof value !== "object" || value === null || Array.isArray(value) || typeof (value as { _id?: unknown })._id !== "string") {
    throw new Error(`${where}: a line is not a document with an _id.`);
  }
  return value as TransferRow;
}

/** Loads the schema validators of this checkout (the destination must run the same release). */
export async function loadSchemaValidators(): Promise<TableValidators> {
  const schema = (await import("../../convex/schema")).default;
  return tableValidators(schema);
}

/** Builds the plan for one source society. Reads the export once; keeps only that society's rows in memory. */
export async function planTransfer(exportPath: string, sourceSocietyId: string, validators?: TableValidators): Promise<PlanState> {
  const schema = validators ?? await loadSchemaValidators();
  const archive = await ZipArchive.open(exportPath);
  const findings = new Findings();
  const layout = exportLayout(archive);
  for (const name of layout.unknown) findings.add("blocking", "UNKNOWN_EXPORT_ENTRY", "The export holds an entry outside the Convex export layout.", { sample: name });
  for (const name of layout.systemTables) findings.add("warning", "SYSTEM_TABLE_IGNORED", "A system table other than _storage is not transferred.", { table: name });
  for (const name of layout.components) findings.add("info", "COMPONENT_NOT_COPIED", "Component tables (Better Auth users, accounts, sessions) are not copied; people get destination logins.", { table: name });
  for (const table of schema.keys()) if (!transferPolicy(table)) findings.add("blocking", "UNCLASSIFIED_TABLE", "The table has no transfer policy; classify it in shared/workspaceTransfer/policy.ts.", { table });

  const index = new Map<string, IndexEntry>();
  const candidates = new Map<string, SourceRow>();
  const ownership = new Map<string, Set<string>>();
  // References into tables whose rows may lack societyId, from rows outside the source society.
  const outsideReferrers = new Map<string, string[]>();
  const nullableTables = new Set([...schema].filter(([, v]) => societyField(v) !== "required").map(([name]) => name));
  const overrides = new Map<string, Set<string>>();

  if (!layout.tables.has("societies")) findings.add("blocking", "NO_SOCIETIES_TABLE", "The export has no societies table.");
  for (const [table, entry] of layout.tables) {
    const validator = schema.get(table);
    if (!validator) {
      let rows = 0;
      for await (const _line of archive.lines(entry)) rows += 1;
      if (rows) findings.add("blocking", "EXPORT_TABLE_NOT_IN_SCHEMA", "The source has rows in a table this release doesn't define; export from the same release.", { table, sample: `${rows} rows` });
      continue;
    }
    overrides.set(table, await overriddenIds(archive, layout.generatedSchemas.get(table)));
    const policy = transferPolicy(table);
    // Rows without a workspace may be child rows or shared globals; other societies never are.
    const keepUnowned = table !== "societies" && policy !== null && policy.mode !== "skip" && societyField(validator) !== "required";
    for await (const line of archive.lines(entry)) {
      const doc = parseDocument(line, entry.name);
      const id = String(doc._id);
      const societyId = typeof doc.societyId === "string" ? doc.societyId : undefined;
      if (index.has(id)) throw new Error(`Document id ${id} appears twice in the export.`);
      index.set(id, { table, ...(societyId ? { societyId } : {}) });
      if (table === "storageOwnership" && typeof doc.storageId === "string" && societyId) {
        (ownership.get(doc.storageId) ?? ownership.set(doc.storageId, new Set()).get(doc.storageId)!).add(societyId);
      }
      const inSource = table === "societies" ? id === sourceSocietyId : societyId === sourceSocietyId;
      if (inSource || (keepUnowned && societyId === undefined)) candidates.set(id, { table, id, doc });
      if (!inSource) {
        visitIds(validator, doc, (target, ref) => {
          if (nullableTables.has(target)) (outsideReferrers.get(ref) ?? outsideReferrers.set(ref, []).get(ref)!).push(id);
        });
      }
    }
  }

  const files = new Map<string, ExportStorageFile>();
  if (layout.storageMetadata) {
    for await (const line of archive.lines(layout.storageMetadata)) {
      const doc = parseDocument(line, layout.storageMetadata.name);
      const id = String(doc._id);
      files.set(id, { id, sha256: normalizeSha256(doc.sha256), size: typeof doc.size === "number" ? doc.size : -1,
        ...(typeof doc.contentType === "string" ? { contentType: doc.contentType } : {}), ...(layout.storageBlobs.get(id) ? { entry: layout.storageBlobs.get(id) } : {}) });
      index.set(id, { table: "_storage" });
    }
  }

  const society = candidates.get(sourceSocietyId);
  if (!society || society.table !== "societies") {
    findings.add("blocking", "SOURCE_WORKSPACE_NOT_FOUND", "The export has no societies row with that id.", { sample: sourceSocietyId });
  } else if (typeof society.doc[QUARANTINE_FIELD] === "string") {
    findings.add("blocking", "SOURCE_QUARANTINED", "The source workspace is itself an unfinished transfer.", { table: "societies" });
  }

  // Selection: the society's own rows, then the closure of rows they reference
  // and child rows (no societyId) that reference them.
  const selected = new Map<string, SourceRow>();
  const adopted = new Set<string>();
  const selectedFiles = new Set<string>();
  const excludedCounts = new Map<string, number>();
  const pending: SourceRow[] = [];
  const select = (row: SourceRow) => {
    if (selected.has(row.id)) return;
    selected.set(row.id, row);
    if (row.doc.societyId === undefined && row.table !== "societies" && societyField(schema.get(row.table)!) !== "none") adopted.add(row.id);
    pending.push(row);
  };
  for (const row of candidates.values()) {
    if (row.table !== "societies" && row.doc.societyId !== sourceSocietyId) continue;
    if (transferPolicy(row.table)?.mode === "skip") { excludedCounts.set(row.table, (excludedCounts.get(row.table) ?? 0) + 1); continue; }
    if (!transferPolicy(row.table)) continue;
    select(row);
  }
  const requiredPaths = new Map<string, Set<string>>();
  for (const [table, validator] of schema) requiredPaths.set(table, new Set(idPaths(validator).filter((p) => p.required).map((p) => p.path)));
  const refIssue = (row: SourceRow, path: string, code: string, message: string, required: boolean) =>
    findings.add(required ? "blocking" : "warning", required ? code : `${code}_DROPPED`, required ? message : `${message} The optional reference is dropped.`, { table: row.table, path, sample: row.id });

  // References are followed on the row as it will be written: fields the policy strips don't count.
  const followRefs = (row: SourceRow) => {
    visitIds(schema.get(row.table)!, applyPolicy(row.table, row.doc), (target, ref, path) => {
      const required = requiredPaths.get(row.table)?.has(path) ?? false;
      const entry = index.get(ref);
      if (target === "_storage") {
        if (entry?.table === "_storage") selectedFiles.add(ref);
        else refIssue(row, path, "DANGLING_FILE_REF", "The referenced file is not in the export.", required);
        return;
      }
      if (!entry) return refIssue(row, path, "DANGLING_REF", "The referenced row doesn't exist in the source.", required);
      if (entry.table !== target) return refIssue(row, path, "REF_WRONG_TABLE", `The reference points into ${entry.table}, not ${target}.`, true);
      if (target === "societies") {
        if (ref !== sourceSocietyId) findings.add("blocking", "CROSS_WORKSPACE_REF", "A row references another workspace.", { table: row.table, path, sample: `${row.id} -> ${ref}` });
        return;
      }
      if (entry.societyId !== undefined && entry.societyId !== sourceSocietyId) {
        findings.add("blocking", "CROSS_WORKSPACE_REF", "A row references a row owned by another workspace.", { table: row.table, path, sample: `${row.id} -> ${target}:${ref}` });
        return;
      }
      if (transferPolicy(target)?.mode === "skip") return refIssue(row, path, "REF_TO_EXCLUDED", `The referenced ${target} row is not transferred (skip policy).`, required);
      const candidate = candidates.get(ref);
      if (candidate) select(candidate);
    });
  };
  const childRows = [...candidates.values()].filter((row) => row.doc.societyId === undefined && row.table !== "societies");
  for (;;) {
    while (pending.length) followRefs(pending.pop()!);
    let grew = false;
    for (const row of childRows) {
      if (selected.has(row.id)) continue;
      let pointsIn = false;
      visitIds(schema.get(row.table)!, applyPolicy(row.table, row.doc), (_target, ref) => { if (ref === sourceSocietyId || selected.has(ref)) pointsIn = true; });
      if (pointsIn) { select(row); grew = true; }
    }
    if (!grew) break;
  }

  // Rows without a society are copied only when nothing outside the workspace uses them.
  for (const row of selected.values()) {
    if (row.table === "societies" || row.doc.societyId !== undefined) continue;
    const outside = (outsideReferrers.get(row.id) ?? []).filter((referrer) => !selected.has(referrer));
    if (!outside.length) continue;
    if (adopted.has(row.id)) findings.add("warning", "SHARED_ROW_DUPLICATED", "A row without a workspace is also used elsewhere; the destination gets the workspace's own copy.", { table: row.table, sample: row.id });
    else findings.add("blocking", "SHARED_ROW", "A row without a workspace is also used outside it and can't be split.", { table: row.table, sample: `${row.id} <- ${outside[0]}` });
  }

  // Per-row checks: in-flight state, shape against this release, typed-value overrides.
  const sourceRowDoc = (row: SourceRow): TransferRow => adopted.has(row.id) ? { ...row.doc, societyId: sourceSocietyId } : row.doc;
  for (const row of selected.values()) {
    const policy = transferPolicy(row.table)!;
    const blocked = policy.blockIf?.(row.doc);
    if (blocked) findings.add("blocking", "IN_FLIGHT", blocked, { table: row.table, sample: row.id });
    if (overrides.get(row.table)?.has(row.id)) findings.add("blocking", "VALUE_NEEDS_TYPE_OVERRIDE", "The export marks a value plain JSON can't carry (int64, bytes or a special float).", { table: row.table, sample: row.id });
    for (const error of validateDocument(schema.get(row.table)!, applyPolicy(row.table, sourceRowDoc(row)))) {
      findings.add("blocking", "SCHEMA_MISMATCH", "The row doesn't match this release's schema; export from the same release.", { table: row.table, sample: `${row.id}: ${error}` });
    }
  }

  // String-held ids: rewritten when their row moves, reported when it doesn't.
  const stringRewrites: Record<string, number> = {};
  for (const row of selected.values()) {
    visitStrings(schema.get(row.table)!, applyPolicy(row.table, sourceRowDoc(row)), (value, path) => {
      for (const token of idTokens(value, (candidate) => index.has(candidate))) {
        const entry = index.get(token)!;
        if (entry.table === "_storage") selectedFiles.add(token);
        if (selected.has(token) || entry.table === "_storage") {
          stringRewrites[`${row.table}.${path}`] = (stringRewrites[`${row.table}.${path}`] ?? 0) + 1;
        } else {
          findings.add("warning", "UNMAPPED_ID_STRING", `A string holds the id of a ${entry.table} row that is not transferred; it is left unchanged.`, { table: row.table, path, sample: `${row.id}: ${token}` });
        }
      }
    });
  }

  let fileBytes = 0;
  for (const id of selectedFiles) {
    const file = files.get(id);
    const owners = ownership.get(id);
    if (owners && [...owners].some((owner) => owner !== sourceSocietyId)) findings.add("blocking", "FILE_OWNED_BY_OTHER_WORKSPACE", "A referenced file is claimed by another workspace.", { table: "_storage", sample: id });
    if (!file?.entry) findings.add("blocking", "FILE_BYTES_MISSING", "File bytes are missing; export with --include-file-storage.", { table: "_storage", sample: id });
    else if (!file.sha256 || file.size < 0) findings.add("blocking", "FILE_METADATA_INVALID", "File metadata has no usable sha256 or size.", { table: "_storage", sample: id });
    else fileBytes += file.size;
  }

  // Dependency layers: files and the society first, then rows whose required references resolve.
  const inserted = new Set<string>([sourceSocietyId, ...selectedFiles]);
  let remaining = [...selected.values()].filter((row) => row.id !== sourceSocietyId);
  let layers = selected.has(sourceSocietyId) ? 1 : 0;
  while (remaining.length) {
    const ready = remaining.filter((row) => transformValue(schema.get(row.table)!, applyPolicy(row.table, sourceRowDoc(row)), (_t, ref) => inserted.has(ref) ? ref : null, (s) => s).ok);
    if (!ready.length) {
      for (const row of remaining.slice(0, MAX_SAMPLES)) findings.add("blocking", "UNINSERTABLE_REQUIRED_CYCLE", "Required references form a cycle or point at rows that can't be inserted.", { table: row.table, sample: row.id });
      break;
    }
    for (const row of ready) inserted.add(row.id);
    const readyIds = new Set(ready.map((row) => row.id));
    remaining = remaining.filter((row) => !readyIds.has(row.id));
    layers += 1;
  }

  const tables: TransferPlanReport["tables"] = {};
  const tableEntry = (table: string) => (tables[table] ??= { policy: transferPolicy(table)?.mode ?? "unknown", copied: 0, excluded: 0, adopted: 0 });
  for (const row of selected.values()) tableEntry(row.table).copied += 1;
  for (const id of adopted) tableEntry(selected.get(id)!.table).adopted += 1;
  for (const [table, count] of excludedCounts) tableEntry(table).excluded = count;
  for (const [table, count] of excludedCounts) if (count) findings.add("info", "EXCLUDED_ROWS", transferPolicy(table)?.reason ?? "Not transferred.", { table, sample: `${count} rows` });
  const externalFiles: Record<string, number> = {};
  for (const row of selected.values()) {
    if (row.table === "documentVersions" && typeof row.doc.storageProvider === "string" && row.doc.storageProvider !== "convex") {
      externalFiles[row.doc.storageProvider] = (externalFiles[row.doc.storageProvider] ?? 0) + 1;
    }
  }
  for (const [provider, count] of Object.entries(externalFiles)) {
    findings.add("info", "EXTERNAL_FILES", `Document versions stored with ${provider} keep their locators; the destination must reach the same store.`, { table: "documentVersions", sample: `${count} versions` });
  }

  const finalFindings = findings.list();
  const digestOfSchema = await schemaDigest(schema);
  const selection = createHash("sha256");
  for (const id of [...selected.keys(), ...selectedFiles].sort()) selection.update(`${id}\n`);
  const planDigest = await sha256Hex(JSON.stringify({ exportDigest: archive.directoryDigest, schemaDigest: digestOfSchema, sourceSocietyId, selection: selection.digest("hex"), adopted: [...adopted].sort() }));
  const report: TransferPlanReport = {
    kind: "societyer.workspaceTransferPlan", version: 1, exportPath, exportDigest: archive.directoryDigest, schemaDigest: digestOfSchema, planDigest,
    sourceSocietyId, sourceSocietyName: typeof society?.doc.name === "string" ? society.doc.name : "",
    ok: !finalFindings.some((finding) => finding.severity === "blocking"),
    rows: selected.size, files: { count: selectedFiles.size, bytes: fileBytes }, layers, tables, stringRewrites, externalFiles,
    totals: computeTotals([...selected.values()].map((row) => ({ table: row.table, doc: row.doc }))),
    components: [...layout.components].sort(), findings: finalFindings,
  };
  const rows = new Map<string, SourceRow>();
  for (const row of selected.values()) rows.set(row.id, { ...row, doc: sourceRowDoc(row) });
  const planFiles = new Map<string, ExportStorageFile>();
  for (const id of selectedFiles) { const file = files.get(id); if (file) planFiles.set(id, file); }
  return { report, archive, validators: schema, rows, files: planFiles, sourceSocietyId };
}

export function computeTotals(rows: Iterable<{ table: string; doc: TransferRow | null }>): Totals {
  const totals: Totals = {};
  for (const { table, doc } of rows) {
    const spec = TRANSFER_TOTALS.find((candidate) => candidate.table === table);
    if (!spec || !doc) continue;
    const group = spec.groupBy ? String(doc[spec.groupBy] ?? "(none)") : "all";
    const bucket = ((totals[table] ??= {})[group] ??= {});
    for (const field of spec.sum) bucket[field] = (bucket[field] ?? 0) + (typeof doc[field] === "number" ? doc[field] : 0);
    bucket.rows = (bucket.rows ?? 0) + 1;
  }
  return totals;
}

// ---------------------------------------------------------------- destination

/** Calls the destination's internal functions by name, plus a raw file upload. */
export type TransferDestination = {
  query(name: string, args: Record<string, unknown>): Promise<unknown>;
  mutation(name: string, args: Record<string, unknown>): Promise<unknown>;
  uploadFile(runId: string, bytes: Uint8Array, contentType: string | undefined): Promise<string>;
};

type Mapping = { sourceTable: string; destId: string; rewritten: boolean };
type RunRow = {
  _id: string; label: string; status: string; destSocietyId?: string; plannedRows: number; plannedFiles: number;
  insertedRows: number; rewrittenRows: number; uploadedFiles: number; boundMemberships: number; planDigest: string;
  serverVerifiedAtISO?: string; clientVerifiedAtISO?: string; finishedAtISO?: string; createdAtISO: string;
};

function record(value: unknown, what: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`Unexpected ${what} from the destination.`);
  return value as Record<string, unknown>;
}

export async function findRun(dest: TransferDestination, label: string): Promise<RunRow | null> {
  const run = await dest.query("workspaceTransfer:status", { label });
  return run === null ? null : record(run, "run") as unknown as RunRow;
}

async function requireRun(dest: TransferDestination, label: string): Promise<RunRow> {
  const run = await findRun(dest, label);
  if (!run) throw new Error(`No transfer run labelled ${label} on the destination.`);
  return run;
}

async function loadIdMap(dest: TransferDestination, runId: string): Promise<Map<string, Mapping>> {
  const map = new Map<string, Mapping>();
  let cursor: string | null = null;
  for (;;) {
    const page = record(await dest.query("workspaceTransfer:idMapPage", { runId, cursor }), "id map page");
    for (const row of page.page as Array<{ sourceTable: string; sourceId: string; destId: string; rewritten: boolean }>) {
      map.set(row.sourceId, { sourceTable: row.sourceTable, destId: row.destId, rewritten: row.rewritten });
    }
    if (page.isDone) return map;
    cursor = String(page.continueCursor);
  }
}

/** Pass 1 document: references that resolve now are mapped, the rest omitted where the schema allows. */
function pass1Doc(state: PlanState, row: SourceRow, map: Map<string, Mapping>): TransferRow | null {
  const result = transformValue(state.validators.get(row.table)!, applyPolicy(row.table, row.doc), (_t, ref) => map.get(ref)?.destId ?? null, (s) => s);
  return result.ok ? result.value as TransferRow : null;
}

/** Final document: every typed reference mapped (excluded ones dropped) and string-held ids rewritten. */
export function finalDoc(state: PlanState, row: SourceRow, map: Map<string, Mapping>, rewrites?: Record<string, number>): TransferRow {
  const result = transformValue(state.validators.get(row.table)!, applyPolicy(row.table, row.doc), (target, ref, path) => {
    const mapped = map.get(ref);
    if (mapped) return mapped.destId;
    if (state.rows.has(ref) || state.files.has(ref)) throw new Error(`${row.table}.${path} of ${row.id} points at ${target} ${ref}, which is not written yet.`);
    return null;
  }, (value, path) => {
    const rewritten = rewriteIdTokens(value, (token) => map.get(token)?.destId);
    if (rewritten.count && rewrites) rewrites[`${row.table}.${path}`] = (rewrites[`${row.table}.${path}`] ?? 0) + rewritten.count;
    return rewritten.value;
  });
  if (!result.ok) throw new Error(`${row.table} ${row.id}: required reference ${result.path} can't be resolved.`);
  return result.value as TransferRow;
}

const MAX_BATCH_ROWS = 100;
const MAX_BATCH_BYTES = 512 * 1024;

function batches<T>(items: T[], size: (item: T) => number): T[][] {
  const out: T[][] = [];
  let current: T[] = [];
  let bytes = 0;
  for (const item of items) {
    const itemBytes = size(item);
    if (current.length && (current.length >= MAX_BATCH_ROWS || bytes + itemBytes > MAX_BATCH_BYTES)) { out.push(current); current = []; bytes = 0; }
    current.push(item);
    bytes += itemBytes;
  }
  if (current.length) out.push(current);
  return out;
}

export type ApplyOptions = {
  label: string;
  sourceDeployment: string;
  note?: string;
  log?: (line: string) => void;
  /** Test hook: throw after this many destination write batches. */
  failAfterWrites?: number;
};

export async function applyTransfer(state: PlanState, dest: TransferDestination, options: ApplyOptions): Promise<{ runId: string; inserted: number; files: number; rewritten: number }> {
  if (!state.report.ok) throw new Error("The plan has blocking findings; resolve them before apply.");
  const log = options.log ?? (() => undefined);
  let writes = 0;
  const wrote = () => {
    writes += 1;
    if (options.failAfterWrites !== undefined && writes >= options.failAfterWrites) throw new Error("Simulated interruption.");
  };
  const runId = String(await dest.mutation("workspaceTransfer:begin", {
    label: options.label, sourceDeployment: options.sourceDeployment, sourceSocietyId: state.sourceSocietyId,
    planDigest: state.report.planDigest, exportDigest: state.report.exportDigest, schemaDigest: state.report.schemaDigest,
    plannedRows: state.rows.size, plannedFiles: state.files.size, ...(options.note ? { note: options.note } : {}),
  }));
  const map = await loadIdMap(dest, runId);
  const before = { rows: [...map.values()].filter((m) => m.sourceTable !== "_storage").length, files: [...map.values()].filter((m) => m.sourceTable === "_storage").length };
  log(`run ${options.label} (${runId}): ${before.rows}/${state.rows.size} rows and ${before.files}/${state.files.size} files already written`);

  const insert = async (items: Array<{ table: string; sourceId: string; doc: TransferRow }>) => {
    const results = await dest.mutation("workspaceTransfer:insertBatch", { runId, items }) as Array<{ sourceId: string; destId: string }>;
    const tables = new Map(items.map((item) => [item.sourceId, item.table]));
    for (const result of results) map.set(result.sourceId, { sourceTable: tables.get(result.sourceId)!, destId: result.destId, rewritten: false });
    wrote();
  };

  const society = state.rows.get(state.sourceSocietyId)!;
  if (!map.has(society.id)) await insert([{ table: "societies", sourceId: society.id, doc: pass1Doc(state, society, map)! }]);

  for (const file of [...state.files.values()].sort((a, b) => a.id.localeCompare(b.id))) {
    if (map.has(file.id)) continue;
    const bytes = await state.archive.bytes(file.entry as ZipEntry);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    if (sha256 !== file.sha256 || bytes.length !== file.size) throw new Error(`File ${file.id} in the export doesn't match its metadata checksum.`);
    const destStorageId = await dest.uploadFile(runId, bytes, file.contentType);
    const recorded = record(await dest.mutation("workspaceTransfer:recordFile", { runId, sourceId: file.id, destStorageId, sha256, size: bytes.length }), "file record");
    map.set(file.id, { sourceTable: "_storage", destId: String(recorded.destId), rewritten: true });
    wrote();
  }
  log(`files: ${state.files.size} uploaded and verified`);

  // Pass 1 in dependency layers.
  for (let layer = 1; ; layer++) {
    const ready: Array<{ table: string; sourceId: string; doc: TransferRow }> = [];
    let waiting = 0;
    for (const row of state.rows.values()) {
      if (map.has(row.id)) continue;
      const doc = pass1Doc(state, row, map);
      if (doc) ready.push({ table: row.table, sourceId: row.id, doc });
      else waiting += 1;
    }
    if (!ready.length) {
      if (waiting) throw new Error(`${waiting} rows can't be inserted; their required references never resolve.`);
      break;
    }
    for (const batch of batches(ready, (item) => JSON.stringify(item).length)) await insert(batch);
    log(`pass 1 layer ${layer}: ${ready.length} rows`);
  }

  // Pass 2: final documents.
  let rewritten = 0;
  const pending = [...state.rows.values()].filter((row) => !map.get(row.id)?.rewritten).map((row) => ({ table: row.table, sourceId: row.id, doc: finalDoc(state, row, map) }));
  for (const batch of batches(pending, (item) => JSON.stringify(item).length)) {
    rewritten += Number(await dest.mutation("workspaceTransfer:rewriteBatch", { runId, items: batch }));
    for (const item of batch) map.get(item.sourceId)!.rewritten = true;
    wrote();
  }
  log(`pass 2: ${pending.length} rows rewritten`);
  await dest.mutation("workspaceTransfer:completeApply", { runId });
  return { runId, inserted: state.rows.size - before.rows, files: state.files.size - before.files, rewritten };
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export type VerifyReport = {
  ok: boolean;
  runId: string;
  serverIssues: string[];
  problems: string[];
  tables: Record<string, { planned: number; written: number; inWorkspace?: number }>;
  files: { planned: number; verified: number };
  totals: { source: Totals; destination: Totals };
  stringRewrites: Record<string, number>;
};

export async function verifyTransfer(state: PlanState, dest: TransferDestination, label: string, log: (line: string) => void = () => undefined): Promise<VerifyReport> {
  const run = await requireRun(dest, label);
  if (run.planDigest !== state.report.planDigest) throw new Error("This export and society don't match the run's plan.");
  const runId = run._id;
  const serverIssues: string[] = [];
  for (let restart = true; ; restart = false) {
    const page = record(await dest.mutation("workspaceTransfer:verifyPage", { runId, restart }), "verify page");
    serverIssues.push(...(page.issues as string[]).slice(0, Math.max(0, 50 - serverIssues.length)));
    if (page.isDone) break;
  }
  log(`server reference check: ${serverIssues.length ? `${serverIssues.length}+ issues` : "passed"}`);

  const map = await loadIdMap(dest, runId);
  const problems: string[] = [];
  const problem = (text: string) => { if (problems.length < 100) problems.push(text); };
  const tables: VerifyReport["tables"] = {};
  for (const row of state.rows.values()) (tables[row.table] ??= { planned: 0, written: 0 }).planned += 1;
  const destinationRows: Array<{ table: string; doc: TransferRow | null }> = [];
  const stringRewrites: Record<string, number> = {};
  let verifiedFiles = 0;
  let cursor: string | null = null;
  for (;;) {
    const page = record(await dest.query("workspaceTransfer:exportPage", { runId, cursor }), "export page");
    for (const item of page.page as Array<{ sourceTable: string; sourceId: string; destId: string; doc?: TransferRow | null; file?: { sha256: string | null; size: number } | null }>) {
      if (item.sourceTable === "_storage") {
        const expected = state.files.get(item.sourceId);
        if (!expected) problem(`File ${item.sourceId} was written but is not in the plan.`);
        else if (!item.file || item.file.sha256 !== expected.sha256 || item.file.size !== expected.size) problem(`File ${item.sourceId} differs from the export (sha256/size).`);
        else verifiedFiles += 1;
        continue;
      }
      const source = state.rows.get(item.sourceId);
      if (!source) { problem(`${item.sourceTable} ${item.sourceId} was written but is not in the plan.`); continue; }
      (tables[source.table] ??= { planned: 0, written: 0 }).written += 1;
      if (!item.doc) { problem(`${source.table} ${item.sourceId} is missing on the destination.`); continue; }
      destinationRows.push({ table: source.table, doc: item.doc });
      const expected: TransferRow = finalDoc(state, source, map, stringRewrites);
      const actual: TransferRow = { ...item.doc };
      delete actual._id;
      delete actual._creationTime;
      if (source.table === "societies") { delete expected.publicSlug; delete actual[QUARANTINE_FIELD]; }
      if (canonical(expected) !== canonical(actual)) {
        const fields = [...new Set([...Object.keys(expected), ...Object.keys(actual)])].filter((key) => canonical(expected[key]) !== canonical(actual[key]));
        problem(`${source.table} ${item.sourceId} differs from the export in ${fields.slice(0, 5).join(", ")}.`);
      }
    }
    if (page.isDone) break;
    cursor = String(page.continueCursor);
  }
  for (const [table, counts] of Object.entries(tables)) if (counts.planned !== counts.written) problem(`${table}: ${counts.written} rows written, ${counts.planned} planned.`);
  if (verifiedFiles !== state.files.size) problem(`${verifiedFiles}/${state.files.size} files verified.`);

  // Nothing else may carry the workspace's id (indexed tables only).
  const mappedPerTable = new Map<string, number>();
  for (const mapping of map.values()) mappedPerTable.set(mapping.sourceTable, (mappedPerTable.get(mapping.sourceTable) ?? 0) + 1);
  for (const table of state.validators.keys()) {
    if (table === "societies") continue;
    let count = 0;
    let indexed = false;
    let pageCursor: string | null = null;
    for (;;) {
      const page = record(await dest.query("workspaceTransfer:countSocietyRows", { runId, table, cursor: pageCursor }), "row count");
      indexed = Boolean(page.indexed);
      count += Number(page.count);
      if (page.isDone) break;
      pageCursor = String(page.continueCursor);
    }
    if (!indexed) continue;
    const expected = table === "storageOwnership" ? state.files.size : mappedPerTable.get(table) ?? 0;
    if (count) (tables[table] ??= { planned: 0, written: 0 }).inWorkspace = count;
    if (count !== expected) problem(`${table}: ${count} rows carry the workspace id, ${expected} expected.`);
  }

  const totals = { source: state.report.totals, destination: computeTotals(destinationRows) };
  if (canonical(totals.source) !== canonical(totals.destination)) problem("Financial totals differ between the export and the destination.");
  const ok = serverIssues.length === 0 && problems.length === 0;
  const report: VerifyReport = { ok, runId, serverIssues, problems, tables, files: { planned: state.files.size, verified: verifiedFiles }, totals, stringRewrites };
  await dest.mutation("workspaceTransfer:recordVerification", { runId, ok, summary: JSON.stringify({ ok, serverIssues: serverIssues.slice(0, 20), problems: problems.slice(0, 20), files: report.files }) });
  return report;
}

export type BindLine = { line: number; who: string; authIssuer: string; authSubject: string; reason?: string };

/** CSV: `sourceUserId-or-email,authIssuer,authSubject[,reason]`; a header line starting with `source` or `email` is skipped. */
export function parseBindCsv(text: string): BindLine[] {
  const lines: BindLine[] = [];
  text.split(/\r?\n/).forEach((raw, index) => {
    const line = raw.trim();
    if (!line || line.startsWith("#")) return;
    const cells = line.split(",").map((cell) => cell.trim());
    if (index === 0 && /^(source|email)/i.test(cells[0]) && /issuer/i.test(cells[1] ?? "")) return;
    if (cells.length < 3 || cells.length > 4 || cells.slice(0, 3).some((cell) => !cell)) throw new Error(`Line ${index + 1}: expected sourceUserId-or-email,authIssuer,authSubject[,reason].`);
    lines.push({ line: index + 1, who: cells[0], authIssuer: cells[1], authSubject: cells[2], ...(cells[3] ? { reason: cells[3] } : {}) });
  });
  return lines;
}

export async function bindMemberships(dest: TransferDestination, label: string, lines: BindLine[], defaultReason: string | undefined) {
  const run = await requireRun(dest, label);
  const results: Array<{ line: number; who: string; ok: boolean; message: string }> = [];
  for (const entry of lines) {
    const reason = entry.reason ?? defaultReason;
    try {
      if (!reason) throw new Error("No reason (4th column or --reason).");
      const lookup = record(await dest.query("workspaceTransfer:importedMembership", {
        runId: run._id, ...(entry.who.includes("@") ? { email: entry.who } : { sourceUserId: entry.who }),
      }), "membership lookup");
      if (lookup.status !== "found") throw new Error(lookup.status === "ambiguous" ? "Several imported memberships use that email; use the source user id." : "No imported membership matches.");
      const bound = record(await dest.mutation("workspaceTransfer:bindMembership", {
        runId: run._id, userId: lookup.userId, authIssuer: entry.authIssuer, authSubject: entry.authSubject, reason,
      }), "bind result");
      results.push({ line: entry.line, who: entry.who, ok: true, message: `bound ${String(bound.role)} (${String(bound.status)})` });
    } catch (error) {
      results.push({ line: entry.line, who: entry.who, ok: false, message: error instanceof Error ? error.message : String(error) });
    }
  }
  return results;
}

export async function finalizeTransfer(dest: TransferDestination, label: string, dropPublicSlug: boolean) {
  const run = await requireRun(dest, label);
  return record(await dest.mutation("workspaceTransfer:finalize", { runId: run._id, ...(dropPublicSlug ? { dropPublicSlug: true } : {}) }), "finalize result");
}

export async function abortTransfer(dest: TransferDestination, label: string, log: (line: string) => void = () => undefined): Promise<number> {
  const run = await requireRun(dest, label);
  let deleted = 0;
  for (;;) {
    const page = record(await dest.mutation("workspaceTransfer:abort", { runId: run._id }), "abort page");
    deleted += Number(page.deleted);
    log(`deleted ${deleted}`);
    if (page.done) return deleted;
  }
}

export async function transferStatus(dest: TransferDestination, label: string) {
  return requireRun(dest, label);
}

export type { ValidatorJSON };
