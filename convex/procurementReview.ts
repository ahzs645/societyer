/**
 * Procurement review (hosted only): which SharePoint folder this workspace
 * reads its published Zoer snapshot from. The snapshot files themselves come
 * through convex/procurementReviewHttp.ts. The local and desktop runtimes have
 * no route to SharePoint, so these functions have no portable twin.
 * See zoer/docs/societyer-review-contract.md.
 */
import { v } from "convex/values";
import { paginationOptsValidator, paginationResultValidator } from "convex/server";
import type { QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { procurementRecordFields, procurementDocumentFields } from "./tables/procurement";
import type { Doc } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import { authorizedMutation, authorizedQuery } from "./lib/authorizedServer";
import { requireEnabledModule } from "./lib/moduleSettings";
import { defaultIntegrationSettings } from "../shared/integrationSettings";
import { validateWorkspaceProcurementReviewFolder } from "../shared/procurementReview/paths";
import { deploymentCapabilities, PROCUREMENT_REVIEW_UNAVAILABLE_MESSAGE } from "../shared/deploymentCapabilities";

function requireDeploymentSupport() {
  if (!deploymentCapabilities(process.env).procurementReview) throw new Error(PROCUREMENT_REVIEW_UNAVAILABLE_MESSAGE);
}

/** The configured folder, for members who can read documents while the module is on. */
export const folder = authorizedQuery("procurementReview:folder", query)({
  args: { societyId: v.id("societies") },
  returns: v.object({ folder: v.union(v.string(), v.null()) }),
  handler: async (ctx, { societyId }) => {
    requireDeploymentSupport();
    const society: Doc<"societies"> = await requireEnabledModule(ctx, societyId, "procurementReview");
    const folder = society.integrationSettings?.procurementReviewFolder;
    return { folder: folder ? validateWorkspaceProcurementReviewFolder(societyId, folder) : null };
  },
});

/** Point the workspace at its snapshot folder (or clear it with ""). Settings editors only; never stores credentials. */
export const setFolder = authorizedMutation("procurementReview:setFolder", mutation)({
  args: { societyId: v.id("societies"), folder: v.string() },
  returns: v.null(),
  handler: async (ctx, { societyId, folder }) => {
    requireDeploymentSupport();
    const society: Doc<"societies"> = await requireEnabledModule(ctx, societyId, "procurementReview");
    const procurementReviewFolder = folder.trim() ? validateWorkspaceProcurementReviewFolder(societyId, folder) : "";
    await ctx.db.patch(societyId, {
      integrationSettings: { ...defaultIntegrationSettings(), ...society.integrationSettings, procurementReviewFolder },
      updatedAt: Date.now(),
    });
    return null;
  },
});

const { societyId: _scopeSociety, generation: _scopeGeneration, searchText: _searchText, ...summaryFields } = procurementRecordFields;
function summaryFor({ _id, _creationTime, societyId, generation, searchText, ...row }: Doc<"procurementRecords">) { return row; }

/** Metadata is queried in Convex; SharePoint is contacted only to open a file. */
async function activeCatalog(ctx: QueryCtx, societyId: Id<"societies">) {
  requireDeploymentSupport();
  const society = await requireEnabledModule(ctx, societyId, "procurementReview");
  const folder = society.integrationSettings?.procurementReviewFolder;
  if (!folder) return null;
  validateWorkspaceProcurementReviewFolder(societyId, folder);
  const catalog = await ctx.db.query("procurementCatalogs").withIndex("by_society", q => q.eq("societyId", societyId)).unique();
  return catalog?.folder === folder ? catalog : null;
}

export const catalog = authorizedQuery("procurementReview:catalog", query)({
  args: { societyId: v.id("societies") },
  returns: v.union(v.null(), v.object({ generation: v.string(), publishedAt: v.string(), counts: v.record(v.string(), v.number()) })),
  handler: async (ctx, { societyId }) => {
    const active = await activeCatalog(ctx, societyId);
    return active ? { generation: active.generation, publishedAt: active.publishedAt, counts: active.counts } : null;
  },
});

/** The most rows one `list` page reads; a page also stops at LIST_PAGE_BYTES read. */
/** Compatibility for already-open paged-reader tabs during the compact rollout. */
export const records = authorizedQuery("procurementReview:records", query)({
  // `from` (YYYY-MM-DD) lists dates on or after that day, soonest first; without it the newest dates come first.
  args: { societyId: v.id("societies"), generation: v.string(), kind: v.string(), search: v.optional(v.string()), status: v.optional(v.string()), from: v.optional(v.string()), paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(v.object(summaryFields)),
  handler: async (ctx, args) => {
    const active = await activeCatalog(ctx, args.societyId);
    if (!active || active.generation !== args.generation) return { page: [], isDone: true, continueCursor: "" };
    const opts = { ...args.paginationOpts, numItems: Math.min(50, Math.max(1, args.paginationOpts.numItems)), maximumRowsRead: 200, maximumBytesRead: 1_000_000 };
    if ((args.search?.length ?? 0) > 200) throw new Error("Search is too long.");
    if (args.from !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(args.from)) throw new Error("Use a YYYY-MM-DD day for upcoming dates.");
    const from = args.from;
    const base = ctx.db.query("procurementRecords");
    const query = args.search?.trim()
      ? base.withSearchIndex("search_records", q => {
          const search = q.search("searchText", args.search!.trim()).eq("societyId", args.societyId).eq("generation", active.generation).eq("kind", args.kind);
          return args.status ? search.eq("status", args.status) : search;
        })
      : args.status
        ? base.withIndex("by_kind_status_date", q => { const scoped = q.eq("societyId", args.societyId).eq("generation", active.generation).eq("kind", args.kind).eq("status", args.status!); return from ? scoped.gte("date", from) : scoped; }).order(from ? "asc" : "desc")
        : base.withIndex("by_kind_date", q => { const scoped = q.eq("societyId", args.societyId).eq("generation", active.generation).eq("kind", args.kind); return from ? scoped.gte("date", from) : scoped; }).order(from ? "asc" : "desc");
    const result = await query.paginate(opts);
    return { ...result, page: result.page.map(summaryFor) };
  },
});

const LIST_PAGE_ROWS = 1000;
/** Rows of older imports carry a search corpus of up to 16 KB, which counts toward the bytes read: 4 MB is at least ~240 of those, ~1,000 current rows. */
const LIST_PAGE_BYTES = 4_000_000;
const listRowFields = {
  recordKey: v.string(), kind: v.string(), title: v.string(), organization: v.string(), issuedFor: v.string(), status: v.string(),
  date: v.string(), dateText: v.string(), reference: v.string(), documents: v.number(), listedDocuments: v.number(),
  supplier: v.string(), value: v.union(v.number(), v.null()), currency: v.string(), procurementType: v.string(),
};
/** `ListRow` in src/features/procurementReview/reader/source.ts. Columns an older import lacks read as empty. */
function listRow(row: Doc<"procurementRecords">) {
  return {
    recordKey: row.recordKey, kind: row.kind, title: row.title, organization: row.organization, issuedFor: row.issuedFor ?? "", status: row.status,
    date: row.date, dateText: row.dateText ?? "", reference: row.reference ?? "", documents: row.documents ?? 0, listedDocuments: row.listedDocuments ?? 0,
    supplier: row.supplier ?? "", value: row.value ?? null, currency: row.currency ?? "", procurementType: row.procurementType ?? "",
  };
}

/**
 * Every record of a kind, in large bounded pages: the reader loads the whole
 * list (small rows: no notice bodies, no search corpus) and sorts, filters and
 * searches it in memory. A page can stop short of `numItems` when it reaches
 * its bytes bound; follow `continueCursor` until `isDone`.
 */
export const list = authorizedQuery("procurementReview:list", query)({
  args: { societyId: v.id("societies"), generation: v.string(), kind: v.string(), paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(v.object(listRowFields)),
  handler: async (ctx, args) => {
    const active = await activeCatalog(ctx, args.societyId);
    if (!active || active.generation !== args.generation) return { page: [], isDone: true, continueCursor: "" };
    const result = await ctx.db.query("procurementRecords").withIndex("by_kind_date", q => q.eq("societyId", args.societyId).eq("generation", active.generation).eq("kind", args.kind))
      .paginate({ ...args.paginationOpts, numItems: Math.min(LIST_PAGE_ROWS, Math.max(1, args.paginationOpts.numItems)), maximumRowsRead: LIST_PAGE_ROWS, maximumBytesRead: LIST_PAGE_BYTES });
    return { ...result, page: result.page.map(listRow) };
  },
});

export const record = authorizedQuery("procurementReview:record", query)({
  args: { societyId: v.id("societies"), generation: v.string(), recordKey: v.string() },
  returns: v.union(v.null(), v.object({ summary: v.object(summaryFields), dataJson: v.string() })),
  handler: async (ctx, args) => {
    const active = await activeCatalog(ctx, args.societyId);
    if (!active || active.generation !== args.generation) return null;
    const summary = await ctx.db.query("procurementRecords").withIndex("by_key", q => q.eq("societyId", args.societyId).eq("generation", active.generation).eq("recordKey", args.recordKey)).unique();
    const detail = await ctx.db.query("procurementDetails").withIndex("by_key", q => q.eq("societyId", args.societyId).eq("generation", active.generation).eq("recordKey", args.recordKey)).unique();
    if (!summary || !detail) return null;
    return { summary: summaryFor(summary), dataJson: detail.dataJson };
  },
});

export const documents = authorizedQuery("procurementReview:documents", query)({
  args: { societyId: v.id("societies"), generation: v.string(), recordKey: v.string(), paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(v.object(procurementDocumentFields)),
  handler: async (ctx, args) => {
    const active = await activeCatalog(ctx, args.societyId);
    if (!active || active.generation !== args.generation) return { page: [], isDone: true, continueCursor: "" };
    const result = await ctx.db.query("procurementDocuments").withIndex("by_record", q => q.eq("societyId", args.societyId).eq("generation", active.generation).eq("recordKey", args.recordKey))
      .paginate({ ...args.paginationOpts, numItems: Math.min(25, Math.max(1, args.paginationOpts.numItems)), maximumRowsRead: 50, maximumBytesRead: 200_000 });
    return { ...result, page: result.page.map(({ _id, _creationTime, ...row }) => row) };
  },
});

export const evidence = authorizedQuery("procurementReview:evidence", query)({
  args: { societyId: v.id("societies"), generation: v.string(), recordKey: v.string(), source: v.string(), paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(v.object({ dataJson: v.string() })),
  handler: async (ctx, args) => {
    const active = await activeCatalog(ctx, args.societyId);
    if (!active || active.generation !== args.generation) return { page: [], isDone: true, continueCursor: "" };
    const result = await ctx.db.query("procurementEvidence").withIndex("by_record_source", q => q.eq("societyId", args.societyId).eq("generation", active.generation).eq("recordKey", args.recordKey).eq("source", args.source))
      .paginate({ ...args.paginationOpts, numItems: Math.min(10, Math.max(1, args.paginationOpts.numItems)), maximumRowsRead: 20, maximumBytesRead: 1_000_000 });
    return { ...result, page: result.page.map(row => ({ dataJson: row.dataJson })) };
  },
});

/**
 * Every published review row for one record (decisions, AI suggestion and
 * summary, requirements, facts, tasks, changes), in one bounded read so the
 * notice page can lay them out together. `truncated` when there were more.
 */
export const review = authorizedQuery("procurementReview:review", query)({
  args: { societyId: v.id("societies"), generation: v.string(), recordKey: v.string() },
  returns: v.object({ rows: v.array(v.object({ source: v.string(), dataJson: v.string() })), truncated: v.boolean() }),
  handler: async (ctx, args) => {
    const active = await activeCatalog(ctx, args.societyId);
    if (!active || active.generation !== args.generation) return { rows: [], truncated: false };
    const result = await ctx.db.query("procurementEvidence").withIndex("by_record_source", q => q.eq("societyId", args.societyId).eq("generation", active.generation).eq("recordKey", args.recordKey))
      .paginate({ numItems: 120, cursor: null, maximumRowsRead: 120, maximumBytesRead: 2_000_000 });
    return { rows: result.page.map(row => ({ source: row.source, dataJson: row.dataJson })), truncated: !result.isDone };
  },
});

/**
 * Every published review row in the catalog with the record it belongs to,
 * for the catalog-wide insights, in bounded pages (at most 500 rows or 4 MB
 * read each). The reader stops after a few thousand rows and says so.
 */
export const reviews = authorizedQuery("procurementReview:reviews", query)({
  args: { societyId: v.id("societies"), generation: v.string(), paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(v.object({ recordKey: v.string(), source: v.string(), dataJson: v.string() })),
  handler: async (ctx, args) => {
    const active = await activeCatalog(ctx, args.societyId);
    if (!active || active.generation !== args.generation) return { page: [], isDone: true, continueCursor: "" };
    const result = await ctx.db.query("procurementEvidence").withIndex("by_record_source", q => q.eq("societyId", args.societyId).eq("generation", active.generation))
      .paginate({ ...args.paginationOpts, numItems: Math.min(500, Math.max(1, args.paginationOpts.numItems)), maximumRowsRead: 500, maximumBytesRead: 4_000_000 });
    return { ...result, page: result.page.map(row => ({ recordKey: row.recordKey, source: row.source, dataJson: row.dataJson })) };
  },
});
