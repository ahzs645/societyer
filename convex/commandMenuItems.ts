import { mutation, query } from "./lib/untypedServer";
import { v } from "convex/values";

export const listForScope = query({
  args: {
    societyId: v.id("societies"),
    scopeType: v.optional(v.string()),
    objectMetadataId: v.optional(v.id("objectMetadata")),
    pagePath: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    let rows: any[] = [];
    try {
      rows = await ctx.db
        .query("commandMenuItems")
        .withIndex("by_society", (q) => q.eq("societyId", args.societyId))
        .collect();
    } catch (error: any) {
      const message = String(error?.message ?? error ?? "");
      if (
        message.includes("commandMenuItems") ||
        message.includes("by_society") ||
        message.includes("does not exist")
      ) {
        return [];
      }
      throw error;
    }
    return rows
      .filter((row) => {
        if (row.scopeType === "global") return true;
        if (args.scopeType && row.scopeType !== args.scopeType) return false;
        if (row.objectMetadataId && args.objectMetadataId && row.objectMetadataId !== args.objectMetadataId) return false;
        if (row.pagePath && args.pagePath && row.pagePath !== args.pagePath) return false;
        return true;
      })
      .sort((a, b) => a.position - b.position);
  },
});

export const upsert = mutation({
  args: {
    societyId: v.id("societies"),
    id: v.optional(v.id("commandMenuItems")),
    label: v.string(),
    category: v.optional(v.string()),
    iconName: v.optional(v.string()),
    commandKey: v.string(),
    scopeType: v.optional(v.string()),
    pagePath: v.optional(v.string()),
    objectMetadataId: v.optional(v.id("objectMetadata")),
    requiredSelection: v.optional(v.string()),
    payloadJson: v.optional(v.string()),
    isPinned: v.optional(v.boolean()),
    isSystem: v.optional(v.boolean()),
    position: v.optional(v.number()),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const now = new Date().toISOString();
    if (args.id) {
      await ctx.db.patch(args.id, {
        label: args.label,
        category: args.category ?? "Actions",
        iconName: args.iconName,
        commandKey: args.commandKey,
        scopeType: args.scopeType ?? "global",
        pagePath: args.pagePath,
        objectMetadataId: args.objectMetadataId,
        requiredSelection: args.requiredSelection,
        payloadJson: args.payloadJson,
        isPinned: args.isPinned ?? false,
        isSystem: args.isSystem ?? false,
        position: args.position ?? 0,
        updatedAtISO: now,
      });
      return args.id;
    }
    const existing = await ctx.db
      .query("commandMenuItems")
      .withIndex("by_society", (q) => q.eq("societyId", args.societyId))
      .collect();
    return ctx.db.insert("commandMenuItems", {
      societyId: args.societyId,
      label: args.label,
      category: args.category ?? "Actions",
      iconName: args.iconName,
      commandKey: args.commandKey,
      scopeType: args.scopeType ?? "global",
      pagePath: args.pagePath,
      objectMetadataId: args.objectMetadataId,
      requiredSelection: args.requiredSelection,
      payloadJson: args.payloadJson,
      isPinned: args.isPinned ?? false,
      isSystem: args.isSystem ?? false,
      position: args.position ?? existing.length,
      createdAtISO: now,
      updatedAtISO: now,
    });
  },
});

export const remove = mutation({
  args: { id: v.id("commandMenuItems") },
  returns: v.any(),
  handler: async (ctx, { id }) => {
    const row = await ctx.db.get(id);
    if (!row) return;
    if (row.isSystem) throw new Error("Cannot delete a system command.");
    await ctx.db.delete(id);
  },
});
