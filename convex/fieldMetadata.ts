import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

/**
 * Field metadata — one row per field on an Object. `fieldType` drives cell
 * rendering via the FieldDisplay registry on the frontend. Type-specific
 * config (options, currency code, target object, etc.) lives in `configJson`.
 */

export const listForObject = query({
  args: { objectMetadataId: v.id("objectMetadata") },
  handler: async (ctx, { objectMetadataId }) => {
    const rows = await ctx.db
      .query("fieldMetadata")
      .withIndex("by_object", (q) => q.eq("objectMetadataId", objectMetadataId))
      .collect();
    rows.sort((a, b) => a.position - b.position);
    return rows;
  },
});

export const listForSociety = query({
  args: { societyId: v.id("societies") },
  handler: async (ctx, { societyId }) =>
    ctx.db
      .query("fieldMetadata")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect(),
});

export const get = query({
  args: { id: v.id("fieldMetadata") },
  handler: async (ctx, { id }) => ctx.db.get(id),
});

export const getByName = query({
  args: {
    objectMetadataId: v.id("objectMetadata"),
    name: v.string(),
  },
  handler: async (ctx, { objectMetadataId, name }) =>
    ctx.db
      .query("fieldMetadata")
      .withIndex("by_object_name", (q) =>
        q.eq("objectMetadataId", objectMetadataId).eq("name", name),
      )
      .unique(),
});

export const create = mutation({
  args: {
    societyId: v.id("societies"),
    objectMetadataId: v.id("objectMetadata"),
    name: v.string(),
    label: v.string(),
    description: v.optional(v.string()),
    icon: v.optional(v.string()),
    fieldType: v.string(),
    configJson: v.optional(v.string()),
    defaultValueJson: v.optional(v.string()),
    isSystem: v.optional(v.boolean()),
    isHidden: v.optional(v.boolean()),
    isNullable: v.optional(v.boolean()),
    position: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = new Date().toISOString();
    // Compute the next position if none provided.
    let position = args.position;
    if (position === undefined) {
      const existing = await ctx.db
        .query("fieldMetadata")
        .withIndex("by_object", (q) => q.eq("objectMetadataId", args.objectMetadataId))
        .collect();
      position = existing.length;
    }
    return ctx.db.insert("fieldMetadata", {
      societyId: args.societyId,
      objectMetadataId: args.objectMetadataId,
      name: args.name,
      label: args.label,
      description: args.description,
      icon: args.icon,
      fieldType: args.fieldType,
      configJson: args.configJson,
      defaultValueJson: args.defaultValueJson,
      isSystem: args.isSystem ?? false,
      isHidden: args.isHidden ?? false,
      isNullable: args.isNullable ?? true,
      position,
      createdAtISO: now,
      updatedAtISO: now,
    });
  },
});

export const update = mutation({
  args: {
    id: v.id("fieldMetadata"),
    patch: v.object({
      label: v.optional(v.string()),
      description: v.optional(v.string()),
      icon: v.optional(v.string()),
      fieldType: v.optional(v.string()),
      configJson: v.optional(v.string()),
      defaultValueJson: v.optional(v.string()),
      isHidden: v.optional(v.boolean()),
      isNullable: v.optional(v.boolean()),
      position: v.optional(v.number()),
    }),
  },
  handler: async (ctx, { id, patch }) => {
    const existing = await ctx.db.get(id);
    if (!existing) throw new Error("Field not found.");
    if (existing.isSystem && patch.fieldType && patch.fieldType !== existing.fieldType) {
      throw new Error("Cannot change the field type of a system field.");
    }
    await ctx.db.patch(id, { ...patch, updatedAtISO: new Date().toISOString() });
  },
});

export const remove = mutation({
  args: { id: v.id("fieldMetadata") },
  handler: async (ctx, { id }) => {
    const field = await ctx.db.get(id);
    if (!field) return;
    if (field.isSystem) {
      throw new Error("Cannot delete a system field.");
    }
    // Cascade: any viewFields referencing this field should be removed too.
    const vfs = await ctx.db
      .query("viewFields")
      .withIndex("by_field", (q) => q.eq("fieldMetadataId", id))
      .collect();
    for (const vf of vfs) await ctx.db.delete(vf._id);
    await ctx.db.delete(id);
  },
});
