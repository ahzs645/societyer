import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { membersList, memberGet, memberCreate, memberUpdate, memberRemove, memberMerge } from "../shared/functions/members";
import { toPortableQueryCtx, toPortableMutationCtx } from "./lib/portable";

export const list = query({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: (ctx, args) => membersList(toPortableQueryCtx(ctx), args),
});

export const get = query({
  args: { id: v.id("members") },
  returns: v.any(),
  handler: (ctx, args) => memberGet(toPortableQueryCtx(ctx), args),
});

export const create = mutation({
  args: {
    societyId: v.id("societies"),
    firstName: v.string(),
    lastName: v.string(),
    email: v.optional(v.string()),
    aliases: v.optional(v.array(v.string())),
    phone: v.optional(v.string()),
    address: v.optional(v.string()),
    membershipClass: v.string(),
    status: v.string(),
    joinedAt: v.string(),
    votingRights: v.boolean(),
    notes: v.optional(v.string()),
  },
  returns: v.any(),
  handler: (ctx, args) => memberCreate(toPortableMutationCtx(ctx), args),
});

export const update = mutation({
  args: {
    id: v.id("members"),
    patch: v.object({
      firstName: v.optional(v.string()),
      lastName: v.optional(v.string()),
      email: v.optional(v.string()),
      aliases: v.optional(v.array(v.string())),
      phone: v.optional(v.string()),
      address: v.optional(v.string()),
      membershipClass: v.optional(v.string()),
      status: v.optional(v.string()),
      joinedAt: v.optional(v.string()),
      leftAt: v.optional(v.string()),
      votingRights: v.optional(v.boolean()),
      notes: v.optional(v.string()),
    }),
  },
  returns: v.any(),
  handler: (ctx, args) => memberUpdate(toPortableMutationCtx(ctx), args),
});

export const remove = mutation({
  args: { id: v.id("members") },
  returns: v.any(),
  handler: (ctx, args) => memberRemove(toPortableMutationCtx(ctx), args),
});

// Member-id foreign-key rewiring (the MEMBER_FK_REFS table) and the merge logic
// now live in the portable shared module so live + offline runtimes share one
// implementation. Only top-level scalar FK columns are rewired: member ids
// embedded inside array-of-object snapshots (written resolution signatures,
// election-question options, minutes/motion movers) are intentionally NOT
// rewired — those are historical records of who acted at the time.
export const merge = mutation({
  args: {
    keepId: v.id("members"),
    dropIds: v.array(v.id("members")),
    patch: v.object({
      firstName: v.optional(v.string()),
      lastName: v.optional(v.string()),
      email: v.optional(v.string()),
      aliases: v.optional(v.array(v.string())),
      phone: v.optional(v.string()),
      address: v.optional(v.string()),
      membershipClass: v.optional(v.string()),
      status: v.optional(v.string()),
      joinedAt: v.optional(v.string()),
      votingRights: v.optional(v.boolean()),
      notes: v.optional(v.string()),
    }),
    actingUserId: v.optional(v.id("users")),
  },
  returns: v.any(),
  handler: (ctx, args) => memberMerge(toPortableMutationCtx(ctx), args),
});
