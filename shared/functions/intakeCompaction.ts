/** "Compact this intake run": after review and promotion, fold or remove the
 * staging an archive-scale run leaves behind, keeping the originals, the field
 * provenance and the review audit.
 *
 * What a run holds after a full review, and what compaction does with it:
 *
 * - **Field reviews** written one row per field (bulk accepts before batch rows
 *   existed) are folded into one batch row per decision (same extraction,
 *   reviewer, time and note), listing the fields with index ranges. Every
 *   field keeps its decision, reviewer, time and note (`latestDecisions`).
 * - **Field provenance** rows stop copying the reviewed value and the source
 *   quote; both are read from the extraction (`hydrateProvenance`). An edited
 *   value stays on the row.
 * - **Promotion import sessions** (one per promoted document) lose the staged
 *   copies of their applied records (JSON payloads that carry the extracted
 *   text again); each session keeps a summary of what was applied and where.
 * - **Extracted text and layout** (`intakeExtracts`) of files no open review
 *   needs is removed: the promoted document keeps its text, the original stays
 *   saved, and the extraction keeps every value with its quoted span.
 *
 * Nothing is removed from extractions, files, clusters, the processing log,
 * native records, document versions or saved originals. The work is bounded
 * per call (`compactRun` returns a cursor) so a run of any size compacts in
 * steps on every runtime. */
import type { PortableMutationCtx, PortableQueryCtx } from "../portable/ctx";
import { getOwned } from "./access";
import { requirePermissionPortable } from "./permissions";
import { compactAppliedRecordsPortable } from "./importSessions";
import { planReviewCompaction } from "../intake/review";
import { slimProvenance } from "../intake/provenance";

const OPEN_STATUSES = new Set(["pending_review", "in_review", "accepted"]);
const PHASES = ["reviews", "provenance", "sessions", "extracts"] as const;
type Phase = (typeof PHASES)[number];

export type CompactionTotals = {
  reviewRowsFolded: number;
  reviewBatchRows: number;
  provenanceSlimmed: number;
  sessionRecordsRemoved: number;
  extractsRemoved: number;
  bytesFreed: number;
};
const zeroTotals = (): CompactionTotals => ({ reviewRowsFolded: 0, reviewBatchRows: 0, provenanceSlimmed: 0, sessionRecordsRemoved: 0, extractsRemoved: 0, bytesFreed: 0 });
const size = (value: unknown) => {
  try {
    return JSON.stringify(value)?.length ?? 0;
  } catch {
    return 0;
  }
};

async function canCompact(ctx: PortableQueryCtx, societyId: string) {
  await requirePermissionPortable(ctx, societyId, "settings:write");
  await requirePermissionPortable(ctx, societyId, "documents:write");
}

async function runExtractions(ctx: PortableQueryCtx, runId: string) {
  return (await ctx.db.query("intakeExtractions").withIndex("by_run", (q) => q.eq("runId", runId)).collect()) as any[];
}

/** Files whose extract an open review still needs: the file of every open extraction (a derived extraction's
 * package), and the other members of its version cluster (the viewer's version diff). */
async function neededExtractFiles(ctx: PortableQueryCtx, runId: string, extractions: any[]): Promise<Set<string>> {
  const open = extractions.filter((row) => OPEN_STATUSES.has(String(row.status)));
  const needed = new Set(open.map((row) => String(row.fileId)));
  if (!open.length) return needed;
  const files = (await ctx.db.query("intakeFiles").withIndex("by_run", (q) => q.eq("runId", runId)).collect()) as any[];
  const clusterOf = new Map(files.map((file) => [String(file._id), file.clusterKey as string | undefined]));
  const openClusters = new Set([...needed].map((id) => clusterOf.get(id)).filter(Boolean) as string[]);
  for (const file of files) if (file.clusterKey && openClusters.has(file.clusterKey)) needed.add(String(file._id));
  return needed;
}

function promotionSessionIds(run: any, extractions: any[]): string[] {
  const ids = new Set<string>();
  for (const row of extractions) if (row.status === "promoted" && row.promotion?.sessionId) ids.add(String(row.promotion.sessionId));
  if (run.importSessionId) ids.add(String(run.importSessionId));
  return [...ids].sort();
}

/** What compaction would fold or remove in a run (the confirmation names these counts). */
export async function compactionPlan(ctx: PortableQueryCtx, { societyId, runId }: { societyId: string; runId: string }) {
  await requirePermissionPortable(ctx, societyId, "settings:read");
  const run = await getOwned<any>(ctx, "intakeRuns", runId, societyId);
  const extractions = await runExtractions(ctx, runId);
  let reviewRows = 0, reviewRowsFolded = 0, reviewBatchRows = 0, reviewBytes = 0;
  let provenanceRows = 0, provenanceSlimmable = 0, provenanceBytes = 0;
  for (const extraction of extractions) {
    const reviews = (await ctx.db.query("intakeFieldReviews").withIndex("by_extraction", (q) => q.eq("extractionId", extraction._id)).collect()) as any[];
    reviewRows += reviews.length;
    for (const group of planReviewCompaction(reviews)) {
      reviewRowsFolded += group.replaces.length;
      reviewBatchRows += 1;
      reviewBytes += reviews.filter((row) => group.replaces.includes(row._id)).reduce((sum, row) => sum + size(row), 0) - size(group.row);
    }
    if (extraction.status !== "promoted") continue;
    const rows = (await ctx.db.query("fieldProvenance").withIndex("by_extraction", (q) => q.eq("extractionId", extraction._id)).collect()) as any[];
    provenanceRows += rows.length;
    for (const row of rows) {
      const slim = slimProvenance(row, extraction);
      if (slim !== row && size(slim) < size(row)) {
        provenanceSlimmable++;
        provenanceBytes += size(row) - size(slim);
      }
    }
  }
  let sessions = 0, sessionRecords = 0, sessionBytes = 0;
  for (const sessionId of promotionSessionIds(run, extractions)) {
    const docs = (await ctx.db.query("documents").withIndex("by_import_session", (q) => q.eq("importSessionId", sessionId)).collect()) as any[];
    let counted = false;
    for (const doc of docs) {
      let record: any;
      try { record = JSON.parse(String(doc.content ?? "{}")); } catch { continue; }
      if (record.status !== "Approved" || !record.importedTargets || !Object.values(record.importedTargets).some(Boolean)) continue;
      sessionRecords++;
      sessionBytes += String(doc.content ?? "").length;
      if (!counted) { sessions++; counted = true; }
    }
  }
  const needed = await neededExtractFiles(ctx, runId, extractions);
  let extracts = 0, extractsRemovable = 0, extractBytes = 0;
  for (const extract of (await ctx.db.query("intakeExtracts").withIndex("by_run", (q) => q.eq("runId", runId)).collect()) as any[]) {
    extracts++;
    if (needed.has(String(extract.fileId))) continue;
    extractsRemovable++;
    extractBytes += size(extract.blocks) + String(extract.text ?? "").length;
  }
  const openExtractions = extractions.filter((row) => OPEN_STATUSES.has(String(row.status))).length;
  return {
    runId, name: run.name, lastCompaction: run.compaction ?? null,
    extractions: extractions.length, openExtractions,
    reviews: { rows: reviewRows, folded: reviewRowsFolded, batchRows: reviewBatchRows, bytes: Math.max(0, reviewBytes) },
    provenance: { rows: provenanceRows, slimmable: provenanceSlimmable, bytes: provenanceBytes },
    sessions: { sessions, records: sessionRecords, bytes: sessionBytes },
    extracts: { total: extracts, removable: extractsRemovable, kept: extracts - extractsRemovable, bytes: extractBytes },
    rowsRemoved: reviewRowsFolded - reviewBatchRows + sessionRecords + extractsRemovable,
    bytesFreed: Math.max(0, reviewBytes) + provenanceBytes + sessionBytes + extractBytes,
    nothingToDo: !reviewRowsFolded && !provenanceSlimmable && !sessionRecords && !extractsRemovable,
  };
}

export type CompactionCursor = { phase: Phase; index: number; totals: CompactionTotals };

/** One bounded step of the compaction (about `budget` writes). Call again with the returned cursor until `done`. */
export async function compactRun(ctx: PortableMutationCtx, { societyId, runId, cursor, budget }: { societyId: string; runId: string; cursor?: CompactionCursor | null; budget?: number }) {
  await canCompact(ctx, societyId);
  const run = await getOwned<any>(ctx, "intakeRuns", runId, societyId);
  const limit = Math.max(50, Math.min(Number(budget) || 2000, 10_000));
  let phase: Phase = cursor && PHASES.includes(cursor.phase) ? cursor.phase : "reviews";
  let index = Math.max(0, Number(cursor?.index) || 0);
  const totals: CompactionTotals = { ...zeroTotals(), ...(cursor?.totals ?? {}) };
  let writes = 0;
  const extractions = (await runExtractions(ctx, runId)).sort((a, b) => String(a._id).localeCompare(String(b._id)));

  while (writes < limit) {
    if (phase === "reviews") {
      if (index >= extractions.length) { phase = "provenance"; index = 0; continue; }
      const extraction = extractions[index++];
      const reviews = (await ctx.db.query("intakeFieldReviews").withIndex("by_extraction", (q) => q.eq("extractionId", extraction._id)).collect()) as any[];
      for (const group of planReviewCompaction(reviews)) {
        const replaced = reviews.filter((row) => group.replaces.includes(row._id));
        await ctx.db.insert("intakeFieldReviews", group.row as any);
        for (const row of replaced) await ctx.db.delete(row._id);
        totals.reviewRowsFolded += replaced.length;
        totals.reviewBatchRows += 1;
        totals.bytesFreed += Math.max(0, replaced.reduce((sum, row) => sum + size(row), 0) - size(group.row));
        writes += replaced.length + 1;
      }
    } else if (phase === "provenance") {
      if (index >= extractions.length) { phase = "sessions"; index = 0; continue; }
      const extraction = extractions[index++];
      if (extraction.status !== "promoted") continue;
      const rows = (await ctx.db.query("fieldProvenance").withIndex("by_extraction", (q) => q.eq("extractionId", extraction._id)).collect()) as any[];
      for (const row of rows) {
        const slim: any = slimProvenance(row, extraction);
        if (slim === row || size(slim) >= size(row)) continue;
        const { _id, _creationTime, ...body } = slim;
        await ctx.db.replace(row._id, body);
        totals.provenanceSlimmed++;
        totals.bytesFreed += size(row) - size(slim);
        writes++;
      }
    } else if (phase === "sessions") {
      const sessions = promotionSessionIds(run, extractions);
      if (index >= sessions.length) { phase = "extracts"; index = 0; continue; }
      const before = await ctx.db.get<any>(sessions[index]);
      const result = await compactAppliedRecordsPortable(ctx, { sessionId: sessions[index], maxRecords: Math.max(50, limit - writes) });
      const after = await ctx.db.get<any>(sessions[index]);
      totals.sessionRecordsRemoved += result.removed;
      totals.bytesFreed += Math.max(0, result.removed ? size(before) - size(after) : 0);
      writes += result.removed + (result.removed ? 1 : 0);
      if (!result.remaining) index++;
      // Removed record bodies: estimated from the session's record count (their content is gone now).
    } else {
      const needed = await neededExtractFiles(ctx, runId, extractions);
      const extracts = ((await ctx.db.query("intakeExtracts").withIndex("by_run", (q) => q.eq("runId", runId)).collect()) as any[])
        .filter((extract) => !needed.has(String(extract.fileId)));
      if (!extracts.length) break;
      for (const extract of extracts.slice(0, limit - writes)) {
        totals.bytesFreed += size(extract.blocks) + String(extract.text ?? "").length;
        await ctx.db.delete(extract._id);
        totals.extractsRemoved++;
        writes++;
      }
      if (writes < limit) break;
    }
  }
  const done = phase === "extracts" && writes < limit;
  if (done) {
    await ctx.db.patch(runId, { compaction: { atISO: new Date().toISOString(), ...totals }, updatedAtISO: new Date().toISOString() });
    return { done: true as const, totals };
  }
  return { done: false as const, cursor: { phase, index, totals } as CompactionCursor, totals };
}
