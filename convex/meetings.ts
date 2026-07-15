import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import {
  listPortable,
  getPortable,
  createPortable,
  applyTemplatePortable,
  updatePortable,
  markSourceReviewPortable,
  setPackageReviewStatusPortable,
  removePortable,
  backfillQuorumSnapshotPortable,
} from "../shared/functions/meetings";
import { toPortableQueryCtx, toPortableMutationCtx } from "./lib/portable";

export const list = query({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: async (ctx, args) => listPortable(await toPortableQueryCtx(ctx), args),
});

export const get = query({
  args: { id: v.id("meetings") },
  returns: v.any(),
  handler: async (ctx, args) => getPortable(await toPortableQueryCtx(ctx), args),
});

export const create = mutation({
  args: {
    societyId: v.id("societies"),
    committeeId: v.optional(v.id("committees")),
    type: v.string(),
    title: v.string(),
    scheduledAt: v.string(),
    location: v.optional(v.string()),
    electronic: v.boolean(),
    remoteUrl: v.optional(v.string()),
    remoteMeetingId: v.optional(v.string()),
    remotePasscode: v.optional(v.string()),
    remoteInstructions: v.optional(v.string()),
    quorumRequired: v.optional(v.number()),
    bylawRuleSetId: v.optional(v.id("bylawRuleSets")),
    quorumRuleVersion: v.optional(v.number()),
    quorumRuleEffectiveFromISO: v.optional(v.string()),
    quorumSourceLabel: v.optional(v.string()),
    quorumComputedAtISO: v.optional(v.string()),
    status: v.string(),
    attendeeIds: v.array(v.string()),
    agendaJson: v.optional(v.string()),
    meetingTemplateId: v.optional(v.id("meetingTemplates")),
    sourceReviewStatus: v.optional(v.string()),
    sourceReviewNotes: v.optional(v.string()),
    sourceReviewedAtISO: v.optional(v.string()),
    sourceReviewedByUserId: v.optional(v.id("users")),
    packageReviewStatus: v.optional(v.string()),
    packageReviewNotes: v.optional(v.string()),
    packageReviewedAtISO: v.optional(v.string()),
    packageReviewedByUserId: v.optional(v.id("users")),
    notes: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, args) => createPortable(await toPortableMutationCtx(ctx), args),
});

// Apply (or re-apply) a meeting template's agenda + minutes scaffolding onto an
// EXISTING meeting. create() only materializes a template at creation time, so a
// meeting made without one — or one that needs a different template — could
// never get the standardized agenda/section scaffolding. Safe by default:
// refuses to overwrite existing agenda items unless `replace` is set, and only
// fills minutes sections/motions when they are still empty (never clobbers
// recorded minutes) unless `replace` is set.
export const applyTemplate = mutation({
  args: {
    meetingId: v.id("meetings"),
    meetingTemplateId: v.id("meetingTemplates"),
    replace: v.optional(v.boolean()),
  },
  returns: v.any(),
  handler: async (ctx, args) => applyTemplatePortable(await toPortableMutationCtx(ctx), args),
});

export const update = mutation({
  args: {
    id: v.id("meetings"),
    patch: v.object({
      type: v.optional(v.string()),
      committeeId: v.optional(v.id("committees")),
      title: v.optional(v.string()),
      scheduledAt: v.optional(v.string()),
      location: v.optional(v.string()),
      electronic: v.optional(v.boolean()),
      remoteUrl: v.optional(v.string()),
      remoteMeetingId: v.optional(v.string()),
      remotePasscode: v.optional(v.string()),
      remoteInstructions: v.optional(v.string()),
      noticeSentAt: v.optional(v.string()),
      quorumRequired: v.optional(v.number()),
      bylawRuleSetId: v.optional(v.id("bylawRuleSets")),
      quorumRuleVersion: v.optional(v.number()),
      quorumRuleEffectiveFromISO: v.optional(v.string()),
      quorumSourceLabel: v.optional(v.string()),
      quorumComputedAtISO: v.optional(v.string()),
      status: v.optional(v.string()),
      attendeeIds: v.optional(v.array(v.string())),
      meetingTemplateId: v.optional(v.id("meetingTemplates")),
      templateSnapshotJson: v.optional(v.string()),
      minutesId: v.optional(v.id("minutes")),
      sourceReviewStatus: v.optional(v.string()),
      sourceReviewNotes: v.optional(v.string()),
      sourceReviewedAtISO: v.optional(v.string()),
      sourceReviewedByUserId: v.optional(v.id("users")),
      packageReviewStatus: v.optional(v.string()),
      packageReviewNotes: v.optional(v.string()),
      packageReviewedAtISO: v.optional(v.string()),
      packageReviewedByUserId: v.optional(v.id("users")),
      notes: v.optional(v.string()),
      // Explicit clear signals — db.patch ignores undefined coming over the
      // wire, so the client can't unset a field by sending `field: undefined`.
      clearNoticeSent: v.optional(v.boolean()),
      clearCommitteeId: v.optional(v.boolean()),
    }),
  },
  returns: v.any(),
  handler: async (ctx, args) => updatePortable(await toPortableMutationCtx(ctx), args),
});

export const markSourceReview = mutation({
  args: {
    id: v.id("meetings"),
    status: v.string(),
    notes: v.optional(v.string()),
    actingUserId: v.optional(v.id("users")),
  },
  returns: v.any(),
  handler: async (ctx, args) => markSourceReviewPortable(await toPortableMutationCtx(ctx), args),
});

export const setPackageReviewStatus = mutation({
  args: {
    id: v.id("meetings"),
    status: v.string(),
    notes: v.optional(v.string()),
    actingUserId: v.optional(v.id("users")),
  },
  returns: v.any(),
  handler: async (ctx, args) => setPackageReviewStatusPortable(await toPortableMutationCtx(ctx), args),
});

export const backfillQuorumSnapshot = mutation({
  args: { id: v.id("meetings") },
  returns: v.any(),
  handler: async (ctx, args) => backfillQuorumSnapshotPortable(await toPortableMutationCtx(ctx), args),
});

export const remove = mutation({
  args: { id: v.id("meetings") },
  returns: v.any(),
  handler: async (ctx, args) => removePortable(await toPortableMutationCtx(ctx), args),
});
