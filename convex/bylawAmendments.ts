import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import {
  listPortable,
  getPortable,
  createDraftPortable,
  updateDraftPortable,
  sectionsForAmendmentPortable,
  removePortable,
  startConsultationPortable,
  markResolutionPassedPortable,
  markFiledPortable,
  withdrawPortable,
  supersedePortable,
  materializeSectionsPortable,
} from "../shared/functions/bylawAmendments";
import { toPortableQueryCtx, toPortableMutationCtx } from "./lib/portable";

export const list = query({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: (ctx, args) => listPortable(toPortableQueryCtx(ctx), args),
});

export const get = query({
  args: { id: v.id("bylawAmendments") },
  returns: v.any(),
  handler: (ctx, args) => getPortable(toPortableQueryCtx(ctx), args),
});

export const createDraft = mutation({
  args: {
    societyId: v.id("societies"),
    title: v.string(),
    baseText: v.string(),
    proposedText: v.string(),
    createdByName: v.optional(v.string()),
    notes: v.optional(v.string()),
  },
  returns: v.any(),
  handler: (ctx, args) => createDraftPortable(toPortableMutationCtx(ctx), args),
});

export const updateDraft = mutation({
  args: {
    id: v.id("bylawAmendments"),
    patch: v.object({
      title: v.optional(v.string()),
      proposedText: v.optional(v.string()),
      baseText: v.optional(v.string()),
      notes: v.optional(v.string()),
    }),
    actor: v.optional(v.string()),
  },
  returns: v.any(),
  handler: (ctx, args) => updateDraftPortable(toPortableMutationCtx(ctx), args),
});

export const startConsultation = mutation({
  args: { id: v.id("bylawAmendments"), actor: v.optional(v.string()) },
  returns: v.any(),
  handler: (ctx, args) => startConsultationPortable(toPortableMutationCtx(ctx), args),
});

export const markResolutionPassed = mutation({
  args: {
    id: v.id("bylawAmendments"),
    meetingId: v.optional(v.id("meetings")),
    votesFor: v.optional(v.number()),
    votesAgainst: v.optional(v.number()),
    abstentions: v.optional(v.number()),
    actor: v.optional(v.string()),
  },
  returns: v.any(),
  handler: (ctx, args) => markResolutionPassedPortable(toPortableMutationCtx(ctx), args),
});

export const markFiled = mutation({
  args: {
    id: v.id("bylawAmendments"),
    filingId: v.optional(v.id("filings")),
    actor: v.optional(v.string()),
  },
  returns: v.any(),
  handler: (ctx, args) => markFiledPortable(toPortableMutationCtx(ctx), args),
});

export const withdraw = mutation({
  args: { id: v.id("bylawAmendments"), actor: v.optional(v.string()), reason: v.optional(v.string()) },
  returns: v.any(),
  handler: (ctx, args) => withdrawPortable(toPortableMutationCtx(ctx), args),
});

/** Mark an amendment Superseded — the status the UI already renders but that no
 *  mutation produced. Used when a fresh draft replaces a non-draft amendment
 *  (e.g. a revised version supersedes one in consultation), optionally linking
 *  the superseding amendment. Withdrawn amendments are terminal. */
export const supersede = mutation({
  args: {
    id: v.id("bylawAmendments"),
    supersededByAmendmentId: v.optional(v.id("bylawAmendments")),
    actor: v.optional(v.string()),
    reason: v.optional(v.string()),
  },
  returns: v.any(),
  handler: (ctx, args) => supersedePortable(toPortableMutationCtx(ctx), args),
});

// Persist an amendment's proposed text as structured section records (replacing
// any prior set for that amendment). The client parses the text with
// shared/bylawSections so the section model is identical to the diff view.
export const materializeSections = mutation({
  args: {
    amendmentId: v.id("bylawAmendments"),
    sections: v.array(
      v.object({
        heading: v.string(),
        key: v.string(),
        level: v.number(),
        body: v.string(),
      }),
    ),
  },
  returns: v.any(),
  handler: (ctx, args) => materializeSectionsPortable(toPortableMutationCtx(ctx), args),
});

export const sectionsForAmendment = query({
  args: { amendmentId: v.id("bylawAmendments") },
  returns: v.any(),
  handler: (ctx, args) => sectionsForAmendmentPortable(toPortableQueryCtx(ctx), args),
});

export const remove = mutation({
  args: { id: v.id("bylawAmendments") },
  returns: v.any(),
  handler: (ctx, args) => removePortable(toPortableMutationCtx(ctx), args),
});
