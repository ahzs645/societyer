import { authorizedMutation, authorizedQuery } from "./lib/authorizedServer";
import { query, mutation } from "./lib/untypedServer";
import { v } from "convex/values";
import {
  workspacePortable,
  upsertGroupPortable,
  upsertTagPortable,
  setGroupArchivedPortable,
  setTagArchivedPortable,
} from "../shared/functions/financeTags";
import { toPortableQueryCtx, toPortableMutationCtx } from "./lib/portable";

// Tag groups and tags: workspace-defined reporting dimensions for the books.
export const workspace = authorizedQuery("financeTags:workspace", query)({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: async (ctx, args) => workspacePortable(await toPortableQueryCtx(ctx), args),
});

export const upsertGroup = authorizedMutation("financeTags:upsertGroup", mutation)({
  args: {
    id: v.optional(v.id("financeTagGroups")),
    societyId: v.id("societies"),
    name: v.string(),
    color: v.optional(v.union(v.string(), v.null())),
    actingUserId: v.optional(v.id("users")),
  },
  returns: v.any(),
  handler: async (ctx, args) => upsertGroupPortable(await toPortableMutationCtx(ctx), args),
});

export const upsertTag = authorizedMutation("financeTags:upsertTag", mutation)({
  args: {
    id: v.optional(v.id("financeTags")),
    societyId: v.id("societies"),
    groupId: v.id("financeTagGroups"),
    name: v.string(),
    color: v.optional(v.union(v.string(), v.null())),
    actingUserId: v.optional(v.id("users")),
  },
  returns: v.any(),
  handler: async (ctx, args) => upsertTagPortable(await toPortableMutationCtx(ctx), args),
});

export const setGroupArchived = authorizedMutation("financeTags:setGroupArchived", mutation)({
  args: { id: v.id("financeTagGroups"), archived: v.boolean(), actingUserId: v.optional(v.id("users")) },
  returns: v.any(),
  handler: async (ctx, args) => setGroupArchivedPortable(await toPortableMutationCtx(ctx), args),
});

export const setTagArchived = authorizedMutation("financeTags:setTagArchived", mutation)({
  args: { id: v.id("financeTags"), archived: v.boolean(), actingUserId: v.optional(v.id("users")) },
  returns: v.any(),
  handler: async (ctx, args) => setTagArchivedPortable(await toPortableMutationCtx(ctx), args),
});
