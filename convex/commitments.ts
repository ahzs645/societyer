import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import {
  listPortable,
  getPortable,
  eventsForSocietyPortable,
  eventsForCommitmentPortable,
  createPortable,
  updatePortable,
  recordEventPortable,
  removeEventPortable,
  removePortable,
} from "../shared/functions/commitments";
import { toPortableQueryCtx, toPortableMutationCtx } from "./lib/portable";

const commitmentFields = {
  title: v.string(),
  category: v.string(),
  sourceDocumentId: v.optional(v.id("documents")),
  sourceLabel: v.optional(v.string()),
  sourceExcerpt: v.optional(v.string()),
  counterparty: v.optional(v.string()),
  requirement: v.string(),
  cadence: v.string(),
  nextDueDate: v.optional(v.string()),
  dueDateBasis: v.optional(v.string()),
  noticeLeadDays: v.optional(v.number()),
  owner: v.optional(v.string()),
  status: v.string(),
  reviewStatus: v.optional(v.string()),
  confidence: v.optional(v.number()),
  uncertaintyNote: v.optional(v.string()),
  notes: v.optional(v.string()),
};

export const list = query({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: async (ctx, args) => listPortable(await toPortableQueryCtx(ctx), args),
});

export const get = query({
  args: { id: v.id("commitments") },
  returns: v.any(),
  handler: async (ctx, args) => getPortable(await toPortableQueryCtx(ctx), args),
});

export const eventsForSociety = query({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: async (ctx, args) => eventsForSocietyPortable(await toPortableQueryCtx(ctx), args),
});

export const eventsForCommitment = query({
  args: { commitmentId: v.id("commitments") },
  returns: v.any(),
  handler: async (ctx, args) => eventsForCommitmentPortable(await toPortableQueryCtx(ctx), args),
});

export const create = mutation({
  args: {
    societyId: v.id("societies"),
    ...commitmentFields,
  },
  returns: v.any(),
  handler: async (ctx, args) => createPortable(await toPortableMutationCtx(ctx), args),
});

export const update = mutation({
  args: {
    id: v.id("commitments"),
    patch: v.object({
      title: v.optional(v.string()),
      category: v.optional(v.string()),
      sourceDocumentId: v.optional(v.id("documents")),
      sourceLabel: v.optional(v.string()),
      sourceExcerpt: v.optional(v.string()),
      counterparty: v.optional(v.string()),
      requirement: v.optional(v.string()),
      cadence: v.optional(v.string()),
      nextDueDate: v.optional(v.string()),
      dueDateBasis: v.optional(v.string()),
      noticeLeadDays: v.optional(v.number()),
      owner: v.optional(v.string()),
      status: v.optional(v.string()),
      reviewStatus: v.optional(v.string()),
      confidence: v.optional(v.number()),
      uncertaintyNote: v.optional(v.string()),
      notes: v.optional(v.string()),
    }),
  },
  returns: v.any(),
  handler: async (ctx, args) => updatePortable(await toPortableMutationCtx(ctx), args),
});

export const recordEvent = mutation({
  args: {
    commitmentId: v.id("commitments"),
    title: v.string(),
    happenedAtISO: v.string(),
    meetingId: v.optional(v.id("meetings")),
    evidenceDocumentIds: v.array(v.id("documents")),
    evidenceStatus: v.optional(v.string()),
    evidenceNotes: v.optional(v.string()),
    summary: v.optional(v.string()),
    nextDueDate: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, args) => recordEventPortable(await toPortableMutationCtx(ctx), args),
});

export const removeEvent = mutation({
  args: { id: v.id("commitmentEvents") },
  returns: v.any(),
  handler: async (ctx, args) => removeEventPortable(await toPortableMutationCtx(ctx), args),
});

export const remove = mutation({
  args: { id: v.id("commitments") },
  returns: v.any(),
  handler: async (ctx, args) => removePortable(await toPortableMutationCtx(ctx), args),
});
