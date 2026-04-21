import { query, mutation } from "./_generated/server";
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
  handler: async (ctx, { societyId }) =>
    ctx.db
      .query("objectMetadata")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect(),
});

export const get = query({
  args: { id: v.id("objectMetadata") },
  handler: async (ctx, { id }) => ctx.db.get(id),
});

export const getByNameSingular = query({
  args: {
    societyId: v.id("societies"),
    nameSingular: v.string(),
  },
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
  handler: async (ctx, { id, patch }) => {
    await ctx.db.patch(id, { ...patch, updatedAtISO: new Date().toISOString() });
  },
});

export const remove = mutation({
  args: { id: v.id("objectMetadata") },
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
