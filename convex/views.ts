import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

/**
 * Views — per-user or society-shared saved configurations of the RecordTable
 * for a given object (columns, filters, sort, density). A view owns
 * `viewFields` which are the actual columns.
 */

export const listForObject = query({
  args: { objectMetadataId: v.id("objectMetadata") },
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
  handler: async (ctx, { id }) => ctx.db.get(id),
});

/**
 * Returns the view plus its ordered viewFields with the underlying
 * fieldMetadata joined in — the exact shape the RecordTable consumes.
 */
export const getHydrated = query({
  args: { id: v.id("views") },
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
    filtersJson: v.optional(v.string()),
    sortsJson: v.optional(v.string()),
    searchTerm: v.optional(v.string()),
    density: v.optional(v.string()),
    isShared: v.optional(v.boolean()),
    isSystem: v.optional(v.boolean()),
    createdByUserId: v.optional(v.id("users")),
  },
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
      filtersJson: args.filtersJson,
      sortsJson: args.sortsJson,
      searchTerm: args.searchTerm,
      density: args.density ?? "compact",
      isShared: args.isShared ?? false,
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
      filtersJson: v.optional(v.string()),
      sortsJson: v.optional(v.string()),
      searchTerm: v.optional(v.string()),
      density: v.optional(v.string()),
      isShared: v.optional(v.boolean()),
      position: v.optional(v.number()),
    }),
  },
  handler: async (ctx, { id, patch }) => {
    await ctx.db.patch(id, { ...patch, updatedAtISO: new Date().toISOString() });
  },
});

export const remove = mutation({
  args: { id: v.id("views") },
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
  },
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
    }),
  },
  handler: async (ctx, { id, patch }) => {
    await ctx.db.patch(id, { ...patch, updatedAtISO: new Date().toISOString() });
  },
});

export const removeField = mutation({
  args: { id: v.id("viewFields") },
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
