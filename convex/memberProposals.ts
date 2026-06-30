import { query, mutation } from "./lib/untypedServer";
import { v } from "convex/values";
import {
  memberProposalsList,
  memberProposalCreate,
  memberProposalUpdate,
  memberProposalRemove,
} from "../shared/functions/memberProposals";
import { toPortableQueryCtx, toPortableMutationCtx } from "./lib/portable";

export const list = query({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: (ctx, args) => memberProposalsList(toPortableQueryCtx(ctx), args),
});

export const create = mutation({
  args: {
    societyId: v.id("societies"),
    meetingId: v.optional(v.id("meetings")),
    title: v.string(),
    text: v.string(),
    submittedByName: v.string(),
    submittedAtISO: v.string(),
    signatureCount: v.number(),
    thresholdPercent: v.optional(v.number()),
    eligibleVotersAtSubmission: v.optional(v.number()),
    notes: v.optional(v.string()),
  },
  returns: v.any(),
  handler: (ctx, args) => memberProposalCreate(toPortableMutationCtx(ctx), args),
});

export const update = mutation({
  args: {
    id: v.id("memberProposals"),
    patch: v.object({
      title: v.optional(v.string()),
      text: v.optional(v.string()),
      signatureCount: v.optional(v.number()),
      eligibleVotersAtSubmission: v.optional(v.number()),
      meetingId: v.optional(v.id("meetings")),
      includedInAgenda: v.optional(v.boolean()),
      status: v.optional(v.string()),
      receivedAtISO: v.optional(v.string()),
      notes: v.optional(v.string()),
    }),
  },
  returns: v.any(),
  handler: (ctx, args) => memberProposalUpdate(toPortableMutationCtx(ctx), args),
});

export const remove = mutation({
  args: { id: v.id("memberProposals") },
  returns: v.any(),
  handler: (ctx, args) => memberProposalRemove(toPortableMutationCtx(ctx), args),
});
