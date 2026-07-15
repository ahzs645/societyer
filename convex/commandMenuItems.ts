import { mutation, query } from "./lib/untypedServer";
import { v } from "convex/values";
import {
  commandMenuItemsListForScope,
  commandMenuItemUpsert,
  commandMenuItemRemove,
} from "../shared/functions/commandMenuItems";
import { toPortableQueryCtx, toPortableMutationCtx } from "./lib/portable";

export const listForScope = query({
  args: {
    societyId: v.id("societies"),
    scopeType: v.optional(v.string()),
    objectMetadataId: v.optional(v.id("objectMetadata")),
    pagePath: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, args) => commandMenuItemsListForScope(await toPortableQueryCtx(ctx), args),
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
  handler: async (ctx, args) => commandMenuItemUpsert(await toPortableMutationCtx(ctx), args),
});

export const remove = mutation({
  args: { id: v.id("commandMenuItems") },
  returns: v.any(),
  handler: async (ctx, args) => commandMenuItemRemove(await toPortableMutationCtx(ctx), args),
});
