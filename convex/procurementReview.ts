/**
 * Procurement review (hosted only): which SharePoint folder this workspace
 * reads its published Zoer snapshot from. The snapshot files themselves come
 * through convex/procurementReviewHttp.ts. The local and desktop runtimes have
 * no route to SharePoint, so these functions have no portable twin.
 * See zoer/docs/societyer-review-contract.md.
 */
import {
  procurementCandidateQuery,
  procurementSearchCorpus,
  procurementSearchMatches,
} from "../shared/procurementSearchText";
import { procurementPredicate } from "../shared/procurementBrowseFilters";
import { toNoticeRow } from "../shared/procurementNoticeRow";
import { v } from "convex/values";
import {
  paginationOptsValidator,
  paginationResultValidator,
} from "convex/server";
import type { QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import {
  procurementRecordFields,
  procurementDocumentFields,
} from "./tables/procurement";
import type { Doc } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import { authorizedMutation, authorizedQuery } from "./lib/authorizedServer";
import { requireEnabledModule } from "./lib/moduleSettings";
import { defaultIntegrationSettings } from "../shared/integrationSettings";
import { validateWorkspaceProcurementReviewFolder } from "../shared/procurementReview/paths";
import {
  deploymentCapabilities,
  PROCUREMENT_REVIEW_UNAVAILABLE_MESSAGE,
} from "../shared/deploymentCapabilities";

function requireDeploymentSupport() {
  if (!deploymentCapabilities(process.env).procurementReview)
    throw new Error(PROCUREMENT_REVIEW_UNAVAILABLE_MESSAGE);
}

/** The configured folder, for members who can read documents while the module is on. */
export const folder = authorizedQuery(
  "procurementReview:folder",
  query,
)({
  args: { societyId: v.id("societies") },
  returns: v.object({ folder: v.union(v.string(), v.null()) }),
  handler: async (ctx, { societyId }) => {
    requireDeploymentSupport();
    const society: Doc<"societies"> = await requireEnabledModule(
      ctx,
      societyId,
      "procurementReview",
    );
    const folder = society.integrationSettings?.procurementReviewFolder;
    return {
      folder: folder
        ? validateWorkspaceProcurementReviewFolder(societyId, folder)
        : null,
    };
  },
});

/** Point the workspace at its snapshot folder (or clear it with ""). Settings editors only; never stores credentials. */
export const setFolder = authorizedMutation(
  "procurementReview:setFolder",
  mutation,
)({
  args: { societyId: v.id("societies"), folder: v.string() },
  returns: v.null(),
  handler: async (ctx, { societyId, folder }) => {
    requireDeploymentSupport();
    const society: Doc<"societies"> = await requireEnabledModule(
      ctx,
      societyId,
      "procurementReview",
    );
    const procurementReviewFolder = folder.trim()
      ? validateWorkspaceProcurementReviewFolder(societyId, folder)
      : "";
    await ctx.db.patch(societyId, {
      integrationSettings: {
        ...defaultIntegrationSettings(),
        ...society.integrationSettings,
        procurementReviewFolder,
      },
      updatedAt: Date.now(),
    });
    return null;
  },
});

const {
  societyId: _scopeSociety,
  generation: _scopeGeneration,
  searchText: _searchText,
  ...summaryFields
} = procurementRecordFields;
function summaryFor({
  _id,
  _creationTime,
  societyId,
  generation,
  searchText,
  archived,
  ...row
}: Doc<"procurementRecords">) {
  return row;
}

/** Metadata is queried in Convex; SharePoint is contacted only to open a file. */
export async function activeCatalog(ctx: QueryCtx, societyId: Id<"societies">) {
  requireDeploymentSupport();
  const society = await requireEnabledModule(
    ctx,
    societyId,
    "procurementReview",
  );
  const folder = society.integrationSettings?.procurementReviewFolder;
  if (!folder) return null;
  validateWorkspaceProcurementReviewFolder(societyId, folder);
  const catalog = await ctx.db
    .query("procurementCatalogs")
    .withIndex("by_society", (q) => q.eq("societyId", societyId))
    .unique();
  return catalog && catalog.folder === folder && !catalog.syncRunId
    ? catalog
    : null;
}

export const catalog = authorizedQuery(
  "procurementReview:catalog",
  query,
)({
  args: { societyId: v.id("societies") },
  returns: v.union(
    v.null(),
    v.object({
      generation: v.string(),
      publishedAt: v.string(),
      counts: v.record(v.string(), v.number()),
    }),
  ),
  handler: async (ctx, { societyId }) => {
    const active = await activeCatalog(ctx, societyId);
    return active
      ? {
          generation: active.generation,
          publishedAt: active.publishedAt,
          counts: active.counts,
        }
      : null;
  },
});

/** The most rows one `list` page reads; a page also stops at LIST_PAGE_BYTES read. */
/** Compatibility for already-open paged-reader tabs during the compact rollout. */
export const records = authorizedQuery(
  "procurementReview:records",
  query,
)({
  // `from` (YYYY-MM-DD) lists dates on or after that day, soonest first; without it the newest dates come first.
  args: {
    societyId: v.id("societies"),
    generation: v.string(),
    kind: v.string(),
    search: v.optional(v.string()),
    status: v.optional(v.string()),
    from: v.optional(v.string()),
    paginationOpts: paginationOptsValidator,
  },
  returns: paginationResultValidator(v.object(summaryFields)),
  handler: async (ctx, args) => {
    const active = await activeCatalog(ctx, args.societyId);
    if (!active || active.generation !== args.generation)
      return { page: [], isDone: true, continueCursor: "" };
    const opts = {
      ...args.paginationOpts,
      numItems: Math.min(50, Math.max(1, args.paginationOpts.numItems)),
      maximumRowsRead: 200,
      maximumBytesRead: 1_000_000,
    };
    if ((args.search?.length ?? 0) > 200)
      throw new Error("Search is too long.");
    if (args.from !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(args.from))
      throw new Error("Use a YYYY-MM-DD day for upcoming dates.");
    const from = args.from;
    const base = ctx.db.query("procurementRecords");
    const query = args.search?.trim()
      ? base.withSearchIndex("search_records", (q) => {
          const search = q
            .search("searchText", args.search!.trim())
            .eq("societyId", args.societyId)
            .eq("generation", active.storageGeneration ?? active.generation)
            .eq("kind", args.kind);
          return args.status ? search.eq("status", args.status) : search;
        })
      : args.status
        ? base
            .withIndex("by_kind_status_date", (q) => {
              const scoped = q
                .eq("societyId", args.societyId)
                .eq("generation", active.storageGeneration ?? active.generation)
                .eq("kind", args.kind)
                .eq("status", args.status!);
              return from ? scoped.gte("date", from) : scoped;
            })
            .order(from ? "asc" : "desc")
        : base
            .withIndex("by_kind_date", (q) => {
              const scoped = q
                .eq("societyId", args.societyId)
                .eq("generation", active.storageGeneration ?? active.generation)
                .eq("kind", args.kind);
              return from ? scoped.gte("date", from) : scoped;
            })
            .order(from ? "asc" : "desc");
    const result = await query.paginate(opts);
    return {
      ...result,
      page: result.page.filter((row) => !row.archived).map(summaryFor),
    };
  },
});

const LIST_PAGE_ROWS = 1000;
/** Rows of older imports carry a search corpus of up to 16 KB, which counts toward the bytes read: 4 MB is at least ~240 of those, ~1,000 current rows. */
const LIST_PAGE_BYTES = 4_000_000;
export const listRowFields = {
  recordKey: v.string(),
  kind: v.string(),
  title: v.string(),
  organization: v.string(),
  issuedFor: v.string(),
  status: v.string(),
  date: v.string(),
  dateText: v.string(),
  reference: v.string(),
  documents: v.number(),
  listedDocuments: v.number(),
  supplier: v.string(),
  value: v.union(v.number(), v.null()),
  currency: v.string(),
  procurementType: v.string(),
};
/** `ListRow` in src/features/procurementReview/reader/source.ts. Columns an older import lacks read as empty. */
export function listRow(row: Doc<"procurementRecords">) {
  return {
    recordKey: row.recordKey,
    kind: row.kind,
    title: row.title,
    organization: row.organization,
    issuedFor: row.issuedFor ?? "",
    status: row.status,
    date: row.date,
    dateText: row.dateText ?? "",
    reference: row.reference ?? "",
    documents: row.documents ?? 0,
    listedDocuments: row.listedDocuments ?? 0,
    supplier: row.supplier ?? "",
    value: row.value ?? null,
    currency: row.currency ?? "",
    procurementType: row.procurementType ?? "",
  };
}

/**
 * Every record of a kind, in large bounded pages: the reader loads the whole
 * list (small rows: no notice bodies, no search corpus) and sorts, filters and
 * searches it in memory. A page can stop short of `numItems` when it reaches
 * its bytes bound; follow `continueCursor` until `isDone`.
 */
export const list = authorizedQuery(
  "procurementReview:list",
  query,
)({
  args: {
    societyId: v.id("societies"),
    generation: v.string(),
    kind: v.string(),
    paginationOpts: paginationOptsValidator,
  },
  returns: paginationResultValidator(v.object(listRowFields)),
  handler: async (ctx, args) => {
    const active = await activeCatalog(ctx, args.societyId);
    if (!active || active.generation !== args.generation)
      return { page: [], isDone: true, continueCursor: "" };
    const result = await ctx.db
      .query("procurementRecords")
      .withIndex("by_kind_date", (q) =>
        q
          .eq("societyId", args.societyId)
          .eq("generation", active.storageGeneration ?? active.generation)
          .eq("kind", args.kind),
      )
      .paginate({
        ...args.paginationOpts,
        numItems: Math.min(
          LIST_PAGE_ROWS,
          Math.max(1, args.paginationOpts.numItems),
        ),
        maximumRowsRead: LIST_PAGE_ROWS,
        maximumBytesRead: LIST_PAGE_BYTES,
      });
    return {
      ...result,
      page: result.page.filter((row) => !row.archived).map(listRow),
    };
  },
});

export const record = authorizedQuery(
  "procurementReview:record",
  query,
)({
  args: {
    societyId: v.id("societies"),
    generation: v.string(),
    recordKey: v.string(),
  },
  returns: v.union(
    v.null(),
    v.object({ summary: v.object(summaryFields), dataJson: v.string() }),
  ),
  handler: async (ctx, args) => {
    const active = await activeCatalog(ctx, args.societyId);
    if (!active || active.generation !== args.generation) return null;
    const summary = await ctx.db
      .query("procurementRecords")
      .withIndex("by_key", (q) =>
        q
          .eq("societyId", args.societyId)
          .eq("generation", active.storageGeneration ?? active.generation)
          .eq("recordKey", args.recordKey),
      )
      .unique();
    const detail = await ctx.db
      .query("procurementDetails")
      .withIndex("by_key", (q) =>
        q
          .eq("societyId", args.societyId)
          .eq("generation", active.storageGeneration ?? active.generation)
          .eq("recordKey", args.recordKey),
      )
      .unique();
    if (!summary || !detail) return null;
    return { summary: summaryFor(summary), dataJson: detail.dataJson };
  },
});

export const documents = authorizedQuery(
  "procurementReview:documents",
  query,
)({
  args: {
    societyId: v.id("societies"),
    generation: v.string(),
    recordKey: v.string(),
    paginationOpts: paginationOptsValidator,
  },
  returns: paginationResultValidator(v.object(procurementDocumentFields)),
  handler: async (ctx, args) => {
    const active = await activeCatalog(ctx, args.societyId);
    if (!active || active.generation !== args.generation)
      return { page: [], isDone: true, continueCursor: "" };
    const result = await ctx.db
      .query("procurementDocuments")
      .withIndex("by_record", (q) =>
        q
          .eq("societyId", args.societyId)
          .eq("generation", active.storageGeneration ?? active.generation)
          .eq("recordKey", args.recordKey),
      )
      .paginate({
        ...args.paginationOpts,
        numItems: Math.min(25, Math.max(1, args.paginationOpts.numItems)),
        maximumRowsRead: 50,
        maximumBytesRead: 200_000,
      });
    return {
      ...result,
      page: result.page
        .filter((row) => !row.archived)
        .map(({ _id, _creationTime, archived, ...row }) => row),
    };
  },
});

export const evidence = authorizedQuery(
  "procurementReview:evidence",
  query,
)({
  args: {
    societyId: v.id("societies"),
    generation: v.string(),
    recordKey: v.string(),
    source: v.string(),
    paginationOpts: paginationOptsValidator,
  },
  returns: paginationResultValidator(v.object({ dataJson: v.string() })),
  handler: async (ctx, args) => {
    const active = await activeCatalog(ctx, args.societyId);
    if (!active || active.generation !== args.generation)
      return { page: [], isDone: true, continueCursor: "" };
    const result = await ctx.db
      .query("procurementEvidence")
      .withIndex("by_record_source", (q) =>
        q
          .eq("societyId", args.societyId)
          .eq("generation", active.storageGeneration ?? active.generation)
          .eq("recordKey", args.recordKey)
          .eq("source", args.source),
      )
      .paginate({
        ...args.paginationOpts,
        numItems: Math.min(10, Math.max(1, args.paginationOpts.numItems)),
        maximumRowsRead: 20,
        maximumBytesRead: 1_000_000,
      });
    return {
      ...result,
      page: result.page
        .filter((row) => !row.archived)
        .map((row) => ({ dataJson: row.dataJson })),
    };
  },
});

/**
 * Every published review row for one record (decisions, AI suggestion and
 * summary, requirements, facts, tasks, changes), in one bounded read so the
 * notice page can lay them out together. `truncated` when there were more.
 */
export const review = authorizedQuery(
  "procurementReview:review",
  query,
)({
  args: {
    societyId: v.id("societies"),
    generation: v.string(),
    recordKey: v.string(),
  },
  returns: v.object({
    rows: v.array(v.object({ source: v.string(), dataJson: v.string() })),
    truncated: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const active = await activeCatalog(ctx, args.societyId);
    if (!active || active.generation !== args.generation)
      return { rows: [], truncated: false };
    const result = await ctx.db
      .query("procurementEvidence")
      .withIndex("by_record_source", (q) =>
        q
          .eq("societyId", args.societyId)
          .eq("generation", active.storageGeneration ?? active.generation)
          .eq("recordKey", args.recordKey),
      )
      .paginate({
        numItems: 120,
        cursor: null,
        maximumRowsRead: 120,
        maximumBytesRead: 2_000_000,
      });
    return {
      rows: result.page
        .filter((row) => !row.archived)
        .map((row) => ({ source: row.source, dataJson: row.dataJson })),
      truncated: !result.isDone,
    };
  },
});

/**
 * Every published review row in the catalog with the record it belongs to,
 * for the catalog-wide insights, in bounded pages (at most 500 rows or 4 MB
 * read each). The reader stops after a few thousand rows and says so.
 */
export const reviews = authorizedQuery(
  "procurementReview:reviews",
  query,
)({
  args: {
    societyId: v.id("societies"),
    generation: v.string(),
    paginationOpts: paginationOptsValidator,
  },
  returns: paginationResultValidator(
    v.object({
      recordKey: v.string(),
      source: v.string(),
      dataJson: v.string(),
    }),
  ),
  handler: async (ctx, args) => {
    const active = await activeCatalog(ctx, args.societyId);
    if (!active || active.generation !== args.generation)
      return { page: [], isDone: true, continueCursor: "" };
    const result = await ctx.db
      .query("procurementEvidence")
      .withIndex("by_record_source", (q) =>
        q
          .eq("societyId", args.societyId)
          .eq("generation", active.storageGeneration ?? active.generation),
      )
      .paginate({
        ...args.paginationOpts,
        numItems: Math.min(500, Math.max(1, args.paginationOpts.numItems)),
        maximumRowsRead: 500,
        maximumBytesRead: 4_000_000,
      });
    return {
      ...result,
      page: result.page
        .filter((row) => !row.archived)
        .map((row) => ({
          recordKey: row.recordKey,
          source: row.source,
          dataJson: row.dataJson,
        })),
    };
  },
});

/** Interactive browsing: one bounded page, never an automatic whole-catalog load. */
export const page = authorizedQuery(
  "procurementReview:records",
  query,
)({
  args: {
    societyId: v.id("societies"),
    generation: v.string(),
    kind: v.union(v.literal("opportunity"), v.literal("award")),
    request: v.string(),
    asOf: v.number(),
    paginationOpts: paginationOptsValidator,
  },
  returns: v.object({
    page: v.array(v.object(listRowFields)),
    isDone: v.boolean(),
    continueCursor: v.string(),
    scanned: v.number(),
    relevance: v.boolean(),
  }),
  handler: async (ctx, a) => {
    if (a.request.length > 60000 || !Number.isFinite(a.asOf))
      throw new Error("Browse request exceeds budget.");
    const active = await activeCatalog(ctx, a.societyId);
    if (!active || active.generation !== a.generation)
      return {
        page: [],
        isDone: true,
        continueCursor: "",
        scanned: 0,
        relevance: false,
      };
    const request = JSON.parse(a.request);
    const {
      columns = [],
      filters = [],
      filterGroups = [],
      sorts = [],
      searchTerm = "",
      dateContext,
    } = request;
    if (
      !Array.isArray(columns) ||
      columns.length > 30 ||
      !Array.isArray(filters) ||
      filters.length > 40 ||
      !Array.isArray(filterGroups) ||
      filterGroups.length > 20 ||
      !Array.isArray(sorts) ||
      sorts.length > 1 ||
      typeof searchTerm !== "string" ||
      searchTerm.length > 200
    )
      throw new Error("Invalid browse filters.");
    const sortName =
      columns.find(
        (c: any) =>
          c.fieldMetadataId === sorts[0]?.fieldMetadataId ||
          c.field?._id === sorts[0]?.fieldMetadataId,
      )?.field?.name ?? "when";
    const fields: Record<string, string> = {
      when: "date",
      title: "title",
      organization: "organization",
      issuedFor: "issuedFor",
      supplier: "supplier",
      value: "value",
      procurementType: "procurementType",
      documents: "documents",
      status: "status",
      source: "recordKey",
    };
    const field = fields[sortName];
    if (!field) throw new Error("Unsupported sort field.");
    const storage = active.storageGeneration ?? active.generation;
    const base = ctx.db.query("procurementRecords");
    const search = searchTerm.trim();
    const dateField = columns.find(
      (c: any) => c.field?.name === "when",
    )?.fieldMetadataId;
    // A conjunction can be safely narrowed by its date range even after
    // the column menu puts formerly flat conditions into an AND group.
    const conjunctive = (filter: any) => {
      let id = filter.viewFilterGroupId;
      const seen = new Set<string>();
      while (id) {
        if (seen.has(id)) return false;
        seen.add(id);
        const group = filterGroups.find((entry: any) => entry.id === id);
        if (!group || group.logicalOperator !== "and") return false;
        id = group.parentViewFilterGroupId;
      }
      return true;
    };
    const dateFilter = filters.find(
      (f: any) => conjunctive(f) && f.fieldMetadataId === dateField && f.operator === "between",
    );
    const from =
      typeof dateFilter?.value?.start === "string" &&
      /^\d{4}-\d{2}-\d{2}$/.test(dateFilter.value.start)
        ? dateFilter.value.start
        : null;
    const party = request.party;
    if (
      party &&
      (!["organization", "issuedFor"].includes(party.field) ||
        typeof party.name !== "string" ||
        party.name.length > 1000)
    )
      throw new Error("Invalid party filter.");
    const indexed = base
      .withIndex(
        (party && field === "date"
          ? party.field === "organization"
            ? "by_live_buyer_date"
            : "by_live_issued_date"
          : `by_live_kind_${field}`) as "by_live_kind_date",
        (q) => {
          let scoped: any = q
            .eq("societyId", a.societyId)
            .eq("generation", storage)
            .eq("archived", undefined)
            .eq("kind", a.kind);
          if (party && field === "date")
            scoped = scoped.eq(party.field, party.name);
          if (field === "date" && from) scoped = scoped.gte("date", from);
          return scoped;
        },
      )
      .order(sorts[0]?.direction === "asc" ? "asc" : "desc");
    const opts = {
      ...a.paginationOpts,
      numItems: Math.min(50, Math.max(1, a.paginationOpts.numItems)),
      maximumRowsRead: 100,
      maximumBytesRead: 750000,
    };
    let result: {
      page: Doc<"procurementRecords">[];
      isDone: boolean;
      continueCursor: string;
    };
    const candidateQuery = procurementCandidateQuery(search);
    // Explicit ordering must apply to the whole result set, including searches.
    // Search relevance is used only when no ordering was selected.
    if (search && candidateQuery && active.searchReady && sorts.length === 0) {
      const candidates = await ctx.db
        .query("procurementSearch")
        .withSearchIndex("by_grams", (q) =>
          q
            .search("grams", candidateQuery)
            .eq("societyId", a.societyId)
            .eq("generation", storage)
            .eq("kind", a.kind)
            .eq("active", true),
        )
        .paginate(opts);
      const records = await Promise.all(
        candidates.page.map((entry) =>
          ctx.db
            .query("procurementRecords")
            .withIndex("by_key", (q) =>
              q
                .eq("societyId", a.societyId)
                .eq("generation", storage)
                .eq("recordKey", entry.recordKey),
            )
            .unique(),
        ),
      );
      result = {
        ...candidates,
        page: records.filter((r): r is Doc<"procurementRecords"> => r !== null),
      };
    } else result = await indexed.paginate(opts);
    const visible = result.page
      .filter((r) => !r.archived)
      .map((r) => ({
        raw: listRow(r),
        drawn: toNoticeRow(listRow(r), a.asOf),
      }));
    const matches = procurementPredicate(
      columns,
      filters,
      filterGroups,
      dateContext ?? { today: new Date(a.asOf).toISOString().slice(0, 10) },
    );
    return {
      page: visible
        .filter(
          (r) =>
            matches(r.drawn) &&
            (!search ||
              procurementSearchMatches(
                procurementSearchCorpus(r.drawn),
                search,
              )),
        )
        .map((r) => r.raw),
      isDone: result.isDone,
      continueCursor: result.continueCursor,
      scanned: result.page.length,
      relevance: !!search && !!candidateQuery && !!active.searchReady && sorts.length === 0,
    };
  },
});
