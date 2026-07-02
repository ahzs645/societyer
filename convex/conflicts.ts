import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import {
  conflictsListPortable,
  conflictsForMeetingPortable,
  conflictsCreatePortable,
  conflictsResolvePortable,
  conflictsRemovePortable,
} from "../shared/functions/conflicts";
import { toPortableQueryCtx, toPortableMutationCtx } from "./lib/portable";

export const list = query({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: (ctx, args) => conflictsListPortable(toPortableQueryCtx(ctx), args),
});

export const forMeeting = query({
  args: { meetingId: v.id("meetings") },
  returns: v.any(),
  handler: (ctx, args) => conflictsForMeetingPortable(toPortableQueryCtx(ctx), args),
});

export const create = mutation({
  args: {
    societyId: v.id("societies"),
    directorId: v.id("directors"),
    declaredAt: v.string(),
    contractOrMatter: v.string(),
    natureOfInterest: v.string(),
    abstainedFromVote: v.boolean(),
    leftRoom: v.boolean(),
    notes: v.optional(v.string()),
    meetingId: v.optional(v.id("meetings")),
    motionIndex: v.optional(v.number()),
    motionText: v.optional(v.string()),
  },
  returns: v.any(),
  handler: (ctx, args) => conflictsCreatePortable(toPortableMutationCtx(ctx), args),
});

export const resolve = mutation({
  args: { id: v.id("conflicts"), resolvedAt: v.string() },
  returns: v.any(),
  handler: (ctx, args) => conflictsResolvePortable(toPortableMutationCtx(ctx), args),
});

export const remove = mutation({
  args: { id: v.id("conflicts") },
  returns: v.any(),
  handler: (ctx, args) => conflictsRemovePortable(toPortableMutationCtx(ctx), args),
});
