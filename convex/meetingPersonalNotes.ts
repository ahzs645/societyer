/**
 * A person's own notes on a meeting, private until they share them.
 * Handlers: shared/functions/meetingPersonalNotes.ts.
 */
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { authorizedMutation, authorizedQuery } from "./lib/authorizedServer";
import { toPortableMutationCtx, toPortableQueryCtx } from "./lib/portable";
import { minePortable, removePortable, savePortable, setSharedPortable, sharedPortable } from "../shared/functions/meetingPersonalNotes";

export const mine = authorizedQuery("meetingPersonalNotes:mine", query)({
  args: { meetingId: v.id("meetings") },
  returns: v.any(),
  handler: async (ctx, args) => minePortable(await toPortableQueryCtx(ctx), args),
});

export const shared = authorizedQuery("meetingPersonalNotes:shared", query)({
  args: { meetingId: v.id("meetings") },
  returns: v.any(),
  handler: async (ctx, args) => sharedPortable(await toPortableQueryCtx(ctx), args),
});

export const save = authorizedMutation("meetingPersonalNotes:save", mutation)({
  args: { meetingId: v.id("meetings"), body: v.string(), expected: v.optional(v.union(v.string(), v.null())) },
  returns: v.any(),
  handler: async (ctx, args) => savePortable(await toPortableMutationCtx(ctx), args),
});

export const setShared = authorizedMutation("meetingPersonalNotes:setShared", mutation)({
  args: { meetingId: v.id("meetings"), shared: v.boolean() },
  returns: v.any(),
  handler: async (ctx, args) => setSharedPortable(await toPortableMutationCtx(ctx), args),
});

export const remove = authorizedMutation("meetingPersonalNotes:remove", mutation)({
  args: { meetingId: v.id("meetings") },
  returns: v.any(),
  handler: async (ctx, args) => removePortable(await toPortableMutationCtx(ctx), args),
});
