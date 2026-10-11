import { authorizedMutation, authorizedQuery } from "./lib/authorizedServer";
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

export const list = authorizedQuery("conflicts:list", query)({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: async (ctx, args) => conflictsListPortable(await toPortableQueryCtx(ctx), args),
});

export const forMeeting = authorizedQuery("conflicts:forMeeting", query)({
  args: { meetingId: v.id("meetings") },
  returns: v.any(),
  handler: async (ctx, args) => conflictsForMeetingPortable(await toPortableQueryCtx(ctx), args),
});

export const create = authorizedMutation("conflicts:create", mutation)({
  args: {
    societyId: v.id("societies"),
    directorId: v.optional(v.id("directors")),
    personId: v.optional(v.id("peopleDirectory")),
    personName: v.optional(v.string()),
    declaredAt: v.string(),
    contractOrMatter: v.string(),
    natureOfInterest: v.string(),
    abstainedFromVote: v.boolean(),
    leftRoom: v.boolean(),
    notes: v.optional(v.string()),
    meetingId: v.optional(v.id("meetings")),
    motionIndex: v.optional(v.number()),
    motionText: v.optional(v.string()),
    motionId: v.optional(v.id("motions")),
  },
  returns: v.any(),
  handler: async (ctx, args) => conflictsCreatePortable(await toPortableMutationCtx(ctx), args),
});

export const resolve = authorizedMutation("conflicts:resolve", mutation)({
  args: { id: v.id("conflicts"), resolvedAt: v.string() },
  returns: v.any(),
  handler: async (ctx, args) => conflictsResolvePortable(await toPortableMutationCtx(ctx), args),
});

export const remove = authorizedMutation("conflicts:remove", mutation)({
  args: { id: v.id("conflicts") },
  returns: v.any(),
  handler: async (ctx, args) => conflictsRemovePortable(await toPortableMutationCtx(ctx), args),
});
