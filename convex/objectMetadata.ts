import { query, mutation } from "./lib/untypedServer";
import { v } from "convex/values";

/**
 * Object metadata — one row per high-level "Object" the app knows about
 * (members, directors, filings, etc.). Drives the generic RecordTable:
 * columns are resolved by looking up an object's fieldMetadata rows.
 *
 * Mirrors Twenty's `ObjectMetadataEntity`. See convex/schema.ts for the
 * table definition.
 */

export const list = query({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: async (ctx, { societyId }) =>
    ctx.db
      .query("objectMetadata")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect(),
});

export const get = query({
  args: { id: v.id("objectMetadata") },
  returns: v.any(),
  handler: async (ctx, { id }) => ctx.db.get(id),
});

export const getByNameSingular = query({
  args: {
    societyId: v.id("societies"),
    nameSingular: v.string(),
  },
  returns: v.any(),
  handler: async (ctx, { societyId, nameSingular }) =>
    ctx.db
      .query("objectMetadata")
      .withIndex("by_society_name", (q) =>
        q.eq("societyId", societyId).eq("nameSingular", nameSingular),
      )
      .unique(),
});

export const getByNamePlural = query({
  args: {
    societyId: v.id("societies"),
    namePlural: v.string(),
  },
  returns: v.any(),
  handler: async (ctx, { societyId, namePlural }) =>
    ctx.db
      .query("objectMetadata")
      .withIndex("by_society_name_plural", (q) =>
        q.eq("societyId", societyId).eq("namePlural", namePlural),
      )
      .unique(),
});

/**
 * Returns the object metadata + every field defined on it, sorted by
 * field position. This is the shape the RecordTable wants.
 */
export const getWithFields = query({
  args: { objectMetadataId: v.id("objectMetadata") },
  returns: v.any(),
  handler: async (ctx, { objectMetadataId }) => {
    const object = await ctx.db.get(objectMetadataId);
    if (!object) return null;
    const fields = await ctx.db
      .query("fieldMetadata")
      .withIndex("by_object", (q) => q.eq("objectMetadataId", objectMetadataId))
      .collect();
    fields.sort((a, b) => a.position - b.position);
    return { object, fields };
  },
});

/**
 * Everything the RecordTable needs in a single round-trip:
 *   - the object + its fieldMetadata (or `null` if not seeded)
 *   - all views for the object (summary only)
 *   - the active view hydrated with its viewFields + joined fieldMetadata
 *
 * Mirrors Twenty's flat denormalized "load all metadata in parallel"
 * approach so we don't chain three sequential Convex queries on mount.
 * Returns `{ object: null, views: [], activeView: null }` when the
 * object hasn't been seeded — callers branch on `object` to show a
 * "metadata not seeded" empty state instead of spinning forever.
 */
export const getFullTableSetup = query({
  args: {
    societyId: v.id("societies"),
    nameSingular: v.string(),
    viewId: v.optional(v.id("views")),
  },
  returns: v.any(),
  handler: async (ctx, { societyId, nameSingular, viewId }) => {
    const object = await ctx.db
      .query("objectMetadata")
      .withIndex("by_society_name", (q) =>
        q.eq("societyId", societyId).eq("nameSingular", nameSingular),
      )
      .unique();
    if (!object) {
      return { object: null, views: [], activeView: null };
    }

    const [fields, views] = await Promise.all([
      ctx.db
        .query("fieldMetadata")
        .withIndex("by_object", (q) => q.eq("objectMetadataId", object._id))
        .collect(),
      ctx.db
        .query("views")
        .withIndex("by_object_position", (q) =>
          q.eq("objectMetadataId", object._id),
        )
        .collect(),
    ]);
    fields.sort((a, b) => a.position - b.position);
    views.sort((a, b) => a.position - b.position);

    // Resolve which view to hydrate — explicit pin first, else first by position.
    const targetViewId = viewId ?? views[0]?._id;
    let activeView: {
      view: (typeof views)[number];
      columns: { viewField: any; field: any }[];
    } | null = null;

    if (targetViewId) {
      const view = views.find((v) => v._id === targetViewId);
      if (view) {
        const viewFields = await ctx.db
          .query("viewFields")
          .withIndex("by_view_position", (q) => q.eq("viewId", view._id))
          .collect();
        viewFields.sort((a, b) => a.position - b.position);
        const fieldsById = new Map(fields.map((f) => [f._id, f]));
        const columns = viewFields
          .map((vf) => {
            const field = fieldsById.get(vf.fieldMetadataId);
            return field ? { viewField: vf, field } : null;
          })
          .filter((x): x is { viewField: any; field: any } => x !== null);
        activeView = { view, columns };
      }
    }

    return {
      object: { ...object, fields },
      views: views.map((v) => ({
        _id: v._id,
        name: v.name,
        position: v.position,
        isSystem: v.isSystem,
        isShared: v.isShared,
        density: v.density,
        filtersJson: v.filtersJson,
        sortsJson: v.sortsJson,
        searchTerm: v.searchTerm,
        columnStateJson: v.columnStateJson,
      })),
      activeView,
    };
  },
});

export const create = mutation({
  args: {
    societyId: v.id("societies"),
    nameSingular: v.string(),
    namePlural: v.string(),
    labelSingular: v.string(),
    labelPlural: v.string(),
    description: v.optional(v.string()),
    icon: v.optional(v.string()),
    iconColor: v.optional(v.string()),
    labelIdentifierFieldName: v.optional(v.string()),
    imageIdentifierFieldName: v.optional(v.string()),
    isSystem: v.optional(v.boolean()),
    isActive: v.optional(v.boolean()),
    routePath: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const now = new Date().toISOString();
    return ctx.db.insert("objectMetadata", {
      societyId: args.societyId,
      nameSingular: args.nameSingular,
      namePlural: args.namePlural,
      labelSingular: args.labelSingular,
      labelPlural: args.labelPlural,
      description: args.description,
      icon: args.icon,
      iconColor: args.iconColor,
      labelIdentifierFieldName: args.labelIdentifierFieldName,
      imageIdentifierFieldName: args.imageIdentifierFieldName,
      isSystem: args.isSystem ?? false,
      isActive: args.isActive ?? true,
      routePath: args.routePath,
      createdAtISO: now,
      updatedAtISO: now,
    });
  },
});

export const update = mutation({
  args: {
    id: v.id("objectMetadata"),
    patch: v.object({
      labelSingular: v.optional(v.string()),
      labelPlural: v.optional(v.string()),
      description: v.optional(v.string()),
      icon: v.optional(v.string()),
      iconColor: v.optional(v.string()),
      labelIdentifierFieldName: v.optional(v.string()),
      imageIdentifierFieldName: v.optional(v.string()),
      isActive: v.optional(v.boolean()),
      routePath: v.optional(v.string()),
    }),
  },
  returns: v.any(),
  handler: async (ctx, { id, patch }) => {
    await ctx.db.patch(id, { ...patch, updatedAtISO: new Date().toISOString() });
  },
});

export const remove = mutation({
  args: { id: v.id("objectMetadata") },
  returns: v.any(),
  handler: async (ctx, { id }) => {
    const object = await ctx.db.get(id);
    if (!object) return;
    if (object.isSystem) {
      throw new Error("Cannot delete a system object.");
    }
    // Cascade: remove all fields, views, viewFields.
    const fields = await ctx.db
      .query("fieldMetadata")
      .withIndex("by_object", (q) => q.eq("objectMetadataId", id))
      .collect();
    for (const f of fields) await ctx.db.delete(f._id);

    const views = await ctx.db
      .query("views")
      .withIndex("by_object", (q) => q.eq("objectMetadataId", id))
      .collect();
    for (const view of views) {
      const vfs = await ctx.db
        .query("viewFields")
        .withIndex("by_view", (q) => q.eq("viewId", view._id))
        .collect();
      for (const vf of vfs) await ctx.db.delete(vf._id);
      await ctx.db.delete(view._id);
    }
    await ctx.db.delete(id);
  },
});
