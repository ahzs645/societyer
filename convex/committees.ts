import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import {
  committeesListPortable,
  committeeGetPortable,
  committeeDetailPortable,
  committeeCreatePortable,
  committeeUpdatePortable,
  committeeRemovePortable,
  committeeAddMemberPortable,
  committeeRemoveMemberPortable,
} from "../shared/functions/committees";
import { toPortableQueryCtx, toPortableMutationCtx } from "./lib/portable";

export const list = query({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: async (ctx, args) => committeesListPortable(await toPortableQueryCtx(ctx), args),
});

export const get = query({
  args: { id: v.id("committees") },
  returns: v.any(),
  handler: async (ctx, args) => committeeGetPortable(await toPortableQueryCtx(ctx), args),
});

export const detail = query({
  args: { id: v.id("committees") },
  returns: v.any(),
  handler: async (ctx, args) => committeeDetailPortable(await toPortableQueryCtx(ctx), args),
});

export const create = mutation({
  args: {
    societyId: v.id("societies"),
    name: v.string(),
    description: v.optional(v.string()),
    mission: v.optional(v.string()),
    cadence: v.string(),
    cadenceNotes: v.optional(v.string()),
    chairDirectorId: v.optional(v.id("directors")),
    color: v.string(),
  },
  returns: v.any(),
  handler: async (ctx, args) => committeeCreatePortable(await toPortableMutationCtx(ctx), args),
});

export const update = mutation({
  args: {
    id: v.id("committees"),
    patch: v.object({
      name: v.optional(v.string()),
      description: v.optional(v.string()),
      mission: v.optional(v.string()),
      cadence: v.optional(v.string()),
      cadenceNotes: v.optional(v.string()),
      nextMeetingAt: v.optional(v.string()),
      chairDirectorId: v.optional(v.id("directors")),
      color: v.optional(v.string()),
      status: v.optional(v.string()),
    }),
  },
  returns: v.any(),
  handler: async (ctx, args) => committeeUpdatePortable(await toPortableMutationCtx(ctx), args),
});

export const remove = mutation({
  args: { id: v.id("committees") },
  returns: v.any(),
  handler: async (ctx, args) => committeeRemovePortable(await toPortableMutationCtx(ctx), args),
});

export const addMember = mutation({
  args: {
    committeeId: v.id("committees"),
    societyId: v.id("societies"),
    name: v.string(),
    email: v.optional(v.string()),
    role: v.string(),
    directorId: v.optional(v.id("directors")),
    memberId: v.optional(v.id("members")),
  },
  returns: v.any(),
  handler: async (ctx, args) => committeeAddMemberPortable(await toPortableMutationCtx(ctx), args),
});

export const removeMember = mutation({
  args: { id: v.id("committeeMembers") },
  returns: v.any(),
  handler: async (ctx, args) => committeeRemoveMemberPortable(await toPortableMutationCtx(ctx), args),
});
