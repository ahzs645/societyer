"use node";
/** Complete publication computation runs in Node; database reads and serving results remain bounded. */
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { buildAnalysis, normalizeAnalysisRequest, type AnalysisRequest, type AnalysisResult } from "../shared/procurementAnalytics";
import type { ListRow } from "../shared/procurementListRow";
import type { CatalogReviewRow } from "../src/features/procurementReview/reader/source";
const jobs = (internal as any).procurementAnalytics;
export const compute = internalAction({
  args: { id: v.id("procurementAnalytics") }, returns: v.null(),
  handler: async (ctx, a) => {
    const row: Doc<"procurementAnalytics"> | null = await ctx.runQuery(jobs.job, a);
    if (!row || row.state !== "preparing") return null;
    const started = Date.now();
    try {
      const r: AnalysisRequest = normalizeAnalysisRequest(row.request), records: ListRow[] = [], reviews: CatalogReviewRow[] = [];
      let inputBytes = 0, inputPages = 0;
      const tables = r.view === "decisions" ? ["award", "opportunity", "evidence"] : r.view === "party" ? ["award", "opportunity"] : [r.view === "opportunities" ? "opportunity" : "award"];
      for (const table of tables) {
        let cursor: string | null = null;
        for (;;) {
          const page: { page: any[]; isDone: boolean; continueCursor: string } = await ctx.runQuery(jobs.inputPage, { societyId: row.societyId, generation: row.generation, table, paginationOpts: { numItems: 500, cursor } });
          inputPages++; inputBytes += new TextEncoder().encode(JSON.stringify(page.page)).byteLength;
          if (inputBytes > 64_000_000) throw new Error("Publication exceeds the 64 MB analytical input budget. Prepare upstream metrics or use an analytical service.");
          if (table === "evidence") reviews.push(...page.page); else records.push(...page.page);
          if (page.isDone) break;
          if (cursor === page.continueCursor) throw new Error("Analytical input pagination did not advance.");
          cursor = page.continueCursor;
        }
      }
      const publication: { counts: Record<string, number>; evidenceCount: number | null; verified: boolean; sourceComplete: boolean } = await ctx.runQuery(jobs.publication, { societyId: row.societyId, generation: row.generation });
      for (const kind of tables.filter(table => table !== "evidence")) if (records.filter(record => record.kind === kind).length !== (publication.counts[kind] ?? 0)) throw new Error(`Incomplete ${kind} analytical input; publication count does not match.`);
      if (tables.includes("evidence") && publication.evidenceCount !== null && reviews.length !== publication.evidenceCount) throw new Error("Incomplete review evidence input; publication inventory does not match.");
      const result: AnalysisResult = buildAnalysis(records, reviews, r, row.asOf);
      if (result.type === "decisions") result.data.coverage.complete = publication.verified && publication.evidenceCount !== null;
      const resultJson = JSON.stringify(result);
      const boundary = result.type === "opportunities" || result.type === "decisions" ? result.data.nextBoundaryAt : result.type === "party" ? result.data.opportunities.nextBoundaryAt : null;
      await ctx.runMutation(jobs.finish, { id: a.id, startedAt: row.startedAt, resultJson, ...(boundary ? { validUntil: boundary } : {}), measurements: { inputRows: records.length + reviews.length, inputBytes, inputPages, resultBytes: new TextEncoder().encode(resultJson).byteLength, durationMs: Date.now() - started } });
    } catch (error) {
      await ctx.runMutation(jobs.finish, { id: a.id, startedAt: row.startedAt, error: error instanceof Error ? error.message : "Analytical preparation failed." });
    }
    return null;
  },
});
