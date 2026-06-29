import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { directorsList, directorCreate, directorUpdate, directorRemove } from "../shared/functions/directors";
import { toPortableQueryCtx, toPortableMutationCtx } from "./lib/portable";

export const list = query({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: (ctx, args) => directorsList(toPortableQueryCtx(ctx), args),
});

export const create = mutation({
  args: {
    societyId: v.id("societies"),
    memberId: v.optional(v.id("members")),
    firstName: v.string(),
    lastName: v.string(),
    email: v.optional(v.string()),
    aliases: v.optional(v.array(v.string())),
    position: v.string(),
    isBCResident: v.boolean(),
    termStart: v.string(),
    termEnd: v.optional(v.string()),
    consentOnFile: v.boolean(),
    status: v.string(),
    notes: v.optional(v.string()),
  },
  returns: v.any(),
  handler: (ctx, args) => directorCreate(toPortableMutationCtx(ctx), args),
});

export const update = mutation({
  args: {
    id: v.id("directors"),
    patch: v.object({
      firstName: v.optional(v.string()),
      lastName: v.optional(v.string()),
      memberId: v.optional(v.id("members")),
      email: v.optional(v.string()),
      aliases: v.optional(v.array(v.string())),
      position: v.optional(v.string()),
      isBCResident: v.optional(v.boolean()),
      termStart: v.optional(v.string()),
      termEnd: v.optional(v.string()),
      consentOnFile: v.optional(v.boolean()),
      resignedAt: v.optional(v.string()),
      status: v.optional(v.string()),
      notes: v.optional(v.string()),
    }),
  },
  returns: v.any(),
  handler: (ctx, args) => directorUpdate(toPortableMutationCtx(ctx), args),
});

export const remove = mutation({
  args: { id: v.id("directors") },
  returns: v.any(),
  handler: (ctx, args) => directorRemove(toPortableMutationCtx(ctx), args),
});
