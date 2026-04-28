import { query, mutation } from "./lib/untypedServer";
import { v } from "convex/values";

/**
 * Views — per-user or society-shared saved configurations of the RecordTable
 * for a given object (columns, filters, sort, density). A view owns
 * `viewFields` which are the actual columns.
 */

export const listForObject = query({
  args: { objectMetadataId: v.id("objectMetadata") },
  returns: v.any(),
  handler: async (ctx, { objectMetadataId }) => {
    const rows = await ctx.db
      .query("views")
      .withIndex("by_object_position", (q) =>
        q.eq("objectMetadataId", objectMetadataId),
      )
      .collect();
    return rows;
  },
});

export const get = query({
  args: { id: v.id("views") },
  returns: v.any(),
  handler: async (ctx, { id }) => ctx.db.get(id),
});

/**
 * Returns the view plus its ordered viewFields with the underlying
 * fieldMetadata joined in — the exact shape the RecordTable consumes.
 */
export const getHydrated = query({
  args: { id: v.id("views") },
  returns: v.any(),
  handler: async (ctx, { id }) => {
    const view = await ctx.db.get(id);
    if (!view) return null;
    const viewFields = await ctx.db
      .query("viewFields")
      .withIndex("by_view_position", (q) => q.eq("viewId", id))
      .collect();
    viewFields.sort((a, b) => a.position - b.position);
    const fields = await Promise.all(
      viewFields.map(async (vf) => {
        const field = await ctx.db.get(vf.fieldMetadataId);
        return field ? { viewField: vf, field } : null;
      }),
    );
    return {
      view,
      columns: fields.filter((x): x is NonNullable<typeof x> => x !== null),
    };
  },
});

export const create = mutation({
  args: {
    societyId: v.id("societies"),
    objectMetadataId: v.id("objectMetadata"),
    name: v.string(),
    icon: v.optional(v.string()),
    type: v.optional(v.string()), // default "table"
    kanbanFieldMetadataId: v.optional(v.id("fieldMetadata")),
    kanbanAggregateOperation: v.optional(v.string()),
    kanbanAggregateOperationFieldMetadataId: v.optional(v.id("fieldMetadata")),
    calendarFieldMetadataId: v.optional(v.id("fieldMetadata")),
    calendarLayout: v.optional(v.string()),
    filtersJson: v.optional(v.string()),
    viewFilterGroupsJson: v.optional(v.string()),
    sortsJson: v.optional(v.string()),
    viewGroupsJson: v.optional(v.string()),
    viewFieldGroupsJson: v.optional(v.string()),
    searchTerm: v.optional(v.string()),
    anyFieldFilterValue: v.optional(v.string()),
    columnStateJson: v.optional(v.string()),
    density: v.optional(v.string()),
    visibility: v.optional(v.string()),
    openRecordIn: v.optional(v.string()),
    isShared: v.optional(v.boolean()),
    isSystem: v.optional(v.boolean()),
    createdByUserId: v.optional(v.id("users")),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const now = new Date().toISOString();
    const existing = await ctx.db
      .query("views")
      .withIndex("by_object", (q) => q.eq("objectMetadataId", args.objectMetadataId))
      .collect();
    return ctx.db.insert("views", {
      societyId: args.societyId,
      objectMetadataId: args.objectMetadataId,
      name: args.name,
      icon: args.icon,
      type: args.type ?? "table",
      kanbanFieldMetadataId: args.kanbanFieldMetadataId,
      kanbanAggregateOperation: args.kanbanAggregateOperation,
      kanbanAggregateOperationFieldMetadataId: args.kanbanAggregateOperationFieldMetadataId,
      calendarFieldMetadataId: args.calendarFieldMetadataId,
      calendarLayout: args.calendarLayout,
      filtersJson: args.filtersJson,
      viewFilterGroupsJson: args.viewFilterGroupsJson,
      sortsJson: args.sortsJson,
      viewGroupsJson: args.viewGroupsJson,
      viewFieldGroupsJson: args.viewFieldGroupsJson,
      searchTerm: args.searchTerm,
      anyFieldFilterValue: args.anyFieldFilterValue,
      columnStateJson: args.columnStateJson,
      density: args.density ?? "compact",
      isShared: args.visibility ? args.visibility !== "personal" : (args.isShared ?? false),
      visibility: args.visibility ?? (args.isSystem ? "system" : args.isShared ? "shared" : "personal"),
      openRecordIn: args.openRecordIn ?? "drawer",
      isSystem: args.isSystem ?? false,
      createdByUserId: args.createdByUserId,
      position: existing.length,
      createdAtISO: now,
      updatedAtISO: now,
    });
  },
});

export const update = mutation({
  args: {
    id: v.id("views"),
    patch: v.object({
      name: v.optional(v.string()),
      icon: v.optional(v.string()),
      type: v.optional(v.string()),
      kanbanFieldMetadataId: v.optional(v.id("fieldMetadata")),
      kanbanAggregateOperation: v.optional(v.string()),
      kanbanAggregateOperationFieldMetadataId: v.optional(v.id("fieldMetadata")),
      calendarFieldMetadataId: v.optional(v.id("fieldMetadata")),
      calendarLayout: v.optional(v.string()),
      filtersJson: v.optional(v.string()),
      viewFilterGroupsJson: v.optional(v.string()),
      sortsJson: v.optional(v.string()),
      viewGroupsJson: v.optional(v.string()),
      viewFieldGroupsJson: v.optional(v.string()),
      searchTerm: v.optional(v.string()),
      anyFieldFilterValue: v.optional(v.string()),
      columnStateJson: v.optional(v.string()),
      density: v.optional(v.string()),
      isShared: v.optional(v.boolean()),
      visibility: v.optional(v.string()),
      openRecordIn: v.optional(v.string()),
      position: v.optional(v.number()),
    }),
  },
  returns: v.any(),
  handler: async (ctx, { id, patch }) => {
    await ctx.db.patch(id, {
      ...patch,
      ...(patch.visibility ? { isShared: patch.visibility !== "personal" } : {}),
      updatedAtISO: new Date().toISOString(),
    });
  },
});

async function resolveObjectMetadata(
  ctx: any,
  args: {
    societyId: any;
    objectMetadataId?: any;
    nameSingular?: string;
  },
) {
  if (args.objectMetadataId) {
    const object = await ctx.db.get(args.objectMetadataId);
    if (!object || object.societyId !== args.societyId) return null;
    return object;
  }
  if (!args.nameSingular) return null;
  return ctx.db
    .query("objectMetadata")
    .withIndex("by_society_name", (q: any) =>
      q.eq("societyId", args.societyId).eq("nameSingular", args.nameSingular),
    )
    .unique();
}

export const listSharedForDataTable = query({
  args: {
    societyId: v.id("societies"),
    objectMetadataId: v.optional(v.id("objectMetadata")),
    nameSingular: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const object = await resolveObjectMetadata(ctx, args);
    if (!object) return [];
    const rows = await ctx.db
      .query("views")
      .withIndex("by_object_position", (q) => q.eq("objectMetadataId", object._id))
      .collect();
    return rows
      .filter((row) => row.isShared || row.isSystem)
      .sort((a, b) => a.position - b.position);
  },
});

export const createSharedDataTableView = mutation({
  args: {
    societyId: v.id("societies"),
    objectMetadataId: v.optional(v.id("objectMetadata")),
    nameSingular: v.optional(v.string()),
    name: v.string(),
    filtersJson: v.optional(v.string()),
    viewFilterGroupsJson: v.optional(v.string()),
    sortsJson: v.optional(v.string()),
    viewGroupsJson: v.optional(v.string()),
    viewFieldGroupsJson: v.optional(v.string()),
    searchTerm: v.optional(v.string()),
    anyFieldFilterValue: v.optional(v.string()),
    columnStateJson: v.optional(v.string()),
    density: v.optional(v.string()),
    openRecordIn: v.optional(v.string()),
    createdByUserId: v.optional(v.id("users")),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const object = await resolveObjectMetadata(ctx, args);
    if (!object) {
      throw new Error("Object metadata not found for shared saved view.");
    }
    const now = new Date().toISOString();
    const existing = await ctx.db
      .query("views")
      .withIndex("by_object", (q) => q.eq("objectMetadataId", object._id))
      .collect();
    return ctx.db.insert("views", {
      societyId: args.societyId,
      objectMetadataId: object._id,
      name: args.name,
      type: "table",
      filtersJson: args.filtersJson,
      viewFilterGroupsJson: args.viewFilterGroupsJson,
      sortsJson: args.sortsJson,
      viewGroupsJson: args.viewGroupsJson,
      viewFieldGroupsJson: args.viewFieldGroupsJson,
      searchTerm: args.searchTerm,
      anyFieldFilterValue: args.anyFieldFilterValue,
      columnStateJson: args.columnStateJson,
      density: args.density ?? "compact",
      isShared: true,
      visibility: "shared",
      openRecordIn: args.openRecordIn ?? "drawer",
      isSystem: false,
      createdByUserId: args.createdByUserId,
      position: existing.length,
      createdAtISO: now,
      updatedAtISO: now,
    });
  },
});

export const deleteSharedDataTableView = mutation({
  args: {
    societyId: v.id("societies"),
    id: v.id("views"),
  },
  returns: v.any(),
  handler: async (ctx, { societyId, id }) => {
    const view = await ctx.db.get(id);
    if (!view || view.societyId !== societyId) return;
    if (view.isSystem) {
      throw new Error("Cannot delete a system view.");
    }
    const vfs = await ctx.db
      .query("viewFields")
      .withIndex("by_view", (q) => q.eq("viewId", id))
      .collect();
    for (const vf of vfs) await ctx.db.delete(vf._id);
    await ctx.db.delete(id);
  },
});

const GOVERNANCE_VIEW_SEEDS = [
  {
    object: "task",
    name: "Open AGM tasks",
    filters: [
      { fieldId: "status", operator: "is_not", value: "Done" },
      { fieldId: "__any__", operator: "contains", value: "AGM" },
    ],
    sort: { columnId: "dueDate", dir: "asc" },
  },
  {
    object: "filing",
    name: "Missing filing evidence",
    filters: [
      { fieldId: "status", operator: "is_not", value: "Filed" },
      { fieldId: "__any__", operator: "contains", value: "evidence" },
    ],
    sort: { columnId: "dueDate", dir: "asc" },
  },
  {
    object: "directorAttestation",
    name: "Directors needing attestation",
    filters: [{ fieldId: "signed", operator: "is_not", value: "true" }],
    sort: { columnId: "name", dir: "asc" },
  },
  {
    object: "conflict",
    name: "Unresolved conflicts",
    filters: [{ fieldId: "status", operator: "is_not", value: "Resolved" }],
    sort: { columnId: "updatedAtISO", dir: "desc" },
  },
  {
    object: "grant",
    name: "Grant reports due",
    filters: [
      { fieldId: "reportStatus", operator: "is_not", value: "Submitted" },
      { fieldId: "__any__", operator: "contains", value: "report" },
    ],
    sort: { columnId: "reportDueDate", dir: "asc" },
  },
];

export const seedGovernanceDataTableViews = mutation({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: async (ctx, { societyId }) => {
    const now = new Date().toISOString();
    const created: string[] = [];
    const skipped: string[] = [];
    for (const seed of GOVERNANCE_VIEW_SEEDS) {
      const object = await resolveObjectMetadata(ctx, {
        societyId,
        nameSingular: seed.object,
      });
      if (!object) {
        skipped.push(seed.name);
        continue;
      }
      const existing = await ctx.db
        .query("views")
        .withIndex("by_object", (q) => q.eq("objectMetadataId", object._id))
        .collect();
      if (existing.some((view) => view.name === seed.name)) {
        skipped.push(seed.name);
        continue;
      }
      await ctx.db.insert("views", {
        societyId,
        objectMetadataId: object._id,
        name: seed.name,
        type: "table",
        filtersJson: JSON.stringify(seed.filters),
        viewFilterGroupsJson: JSON.stringify([]),
        sortsJson: JSON.stringify([seed.sort]),
        viewGroupsJson: JSON.stringify([]),
        viewFieldGroupsJson: JSON.stringify([]),
        columnStateJson: JSON.stringify({ hiddenColumns: [], columnWidths: {}, columnOrder: [] }),
        density: "compact",
        isShared: true,
        visibility: "system",
        openRecordIn: "drawer",
        isSystem: true,
        position: existing.length,
        createdAtISO: now,
        updatedAtISO: now,
      });
      created.push(seed.name);
    }
    return { created, skipped };
  },
});

export const remove = mutation({
  args: { id: v.id("views") },
  returns: v.any(),
  handler: async (ctx, { id }) => {
    const view = await ctx.db.get(id);
    if (!view) return;
    if (view.isSystem) {
      throw new Error("Cannot delete a system view.");
    }
    // Cascade viewFields.
    const vfs = await ctx.db
      .query("viewFields")
      .withIndex("by_view", (q) => q.eq("viewId", id))
      .collect();
    for (const vf of vfs) await ctx.db.delete(vf._id);
    await ctx.db.delete(id);
  },
});

/* ----------------------------- View fields ----------------------------- */

export const listFieldsForView = query({
  args: { viewId: v.id("views") },
  returns: v.any(),
  handler: async (ctx, { viewId }) => {
    const rows = await ctx.db
      .query("viewFields")
      .withIndex("by_view_position", (q) => q.eq("viewId", viewId))
      .collect();
    rows.sort((a, b) => a.position - b.position);
    return rows;
  },
});

export const addField = mutation({
  args: {
    societyId: v.id("societies"),
    viewId: v.id("views"),
    fieldMetadataId: v.id("fieldMetadata"),
    isVisible: v.optional(v.boolean()),
    position: v.optional(v.number()),
    size: v.optional(v.number()),
    aggregateOperation: v.optional(v.string()),
    viewFieldGroupId: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const now = new Date().toISOString();
    let position = args.position;
    if (position === undefined) {
      const existing = await ctx.db
        .query("viewFields")
        .withIndex("by_view", (q) => q.eq("viewId", args.viewId))
        .collect();
      position = existing.length;
    }
    return ctx.db.insert("viewFields", {
      societyId: args.societyId,
      viewId: args.viewId,
      fieldMetadataId: args.fieldMetadataId,
      isVisible: args.isVisible ?? true,
      position,
      size: args.size ?? 160,
      aggregateOperation: args.aggregateOperation,
      viewFieldGroupId: args.viewFieldGroupId,
      createdAtISO: now,
      updatedAtISO: now,
    });
  },
});

export const updateField = mutation({
  args: {
    id: v.id("viewFields"),
    patch: v.object({
      isVisible: v.optional(v.boolean()),
      position: v.optional(v.number()),
      size: v.optional(v.number()),
      aggregateOperation: v.optional(v.string()),
      viewFieldGroupId: v.optional(v.string()),
    }),
  },
  returns: v.any(),
  handler: async (ctx, { id, patch }) => {
    await ctx.db.patch(id, { ...patch, updatedAtISO: new Date().toISOString() });
  },
});

export const removeField = mutation({
  args: { id: v.id("viewFields") },
  returns: v.any(),
  handler: async (ctx, { id }) => {
    await ctx.db.delete(id);
  },
});

/**
 * Bulk-reorder columns. Accepts an array of viewField ids in their new
 * display order. Uses `patch` per row so we remain idempotent if some
 * viewFields are missing.
 */
export const reorderFields = mutation({
  args: {
    viewId: v.id("views"),
    orderedIds: v.array(v.id("viewFields")),
  },
  returns: v.any(),
  handler: async (ctx, { orderedIds }) => {
    const now = new Date().toISOString();
    for (let i = 0; i < orderedIds.length; i++) {
      const id = orderedIds[i];
      const row = await ctx.db.get(id);
      if (!row) continue;
      await ctx.db.patch(id, { position: i, updatedAtISO: now });
    }
  },
});
