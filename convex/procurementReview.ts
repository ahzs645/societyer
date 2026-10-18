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

export const records = authorizedQuery("procurementReview:records", query)({
  args: { societyId: v.id("societies"), generation: v.string(), kind: v.string(), search: v.optional(v.string()), status: v.optional(v.string()), paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(v.object(summaryFields)),
  handler: async (ctx, args) => {
    const active = await activeCatalog(ctx, args.societyId);
    if (!active || active.generation !== args.generation) return { page: [], isDone: true, continueCursor: "" };
    const opts = { ...args.paginationOpts, numItems: Math.min(50, Math.max(1, args.paginationOpts.numItems)), maximumRowsRead: 200, maximumBytesRead: 1_000_000 };
    if ((args.search?.length ?? 0) > 200) throw new Error("Search is too long.");
    const base = ctx.db.query("procurementRecords");
    const query = args.search?.trim()
      ? base.withSearchIndex("search_records", q => {
          const search = q.search("searchText", args.search!.trim()).eq("societyId", args.societyId).eq("generation", active.generation).eq("kind", args.kind);
          return args.status ? search.eq("status", args.status) : search;
        })
      : args.status
        ? base.withIndex("by_kind_status_date", q => q.eq("societyId", args.societyId).eq("generation", active.generation).eq("kind", args.kind).eq("status", args.status!)).order("desc")
        : base.withIndex("by_kind_date", q => q.eq("societyId", args.societyId).eq("generation", active.generation).eq("kind", args.kind)).order("desc");
    const result = await query.paginate(opts);
    return { ...result, page: result.page.map(summaryFor) };
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
