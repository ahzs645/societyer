import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import {
  getPortable,
  listPortable,
  guidancePortable,
  createPortable,
  markFiledPortable,
  updatePortable,
  importBcRegistryHistoryPortable,
  removePortable,
} from "../shared/functions/filings";
import { toPortableQueryCtx, toPortableMutationCtx } from "./lib/portable";

export const get = query({
  args: { id: v.id("filings") },
  returns: v.any(),
  handler: (ctx, args) => getPortable(toPortableQueryCtx(ctx), args),
});

export const list = query({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: (ctx, args) => listPortable(toPortableQueryCtx(ctx), args),
});

export const guidance = query({
  args: { kind: v.string(), jurisdictionCode: v.optional(v.string()) },
  returns: v.any(),
  handler: (ctx, args) => guidancePortable(toPortableQueryCtx(ctx), args),
});

export const create = mutation({
  args: {
    societyId: v.id("societies"),
    kind: v.string(),
    jurisdictionCode: v.optional(v.string()),
    contextKind: v.optional(v.string()),
    sourceRegistrationId: v.optional(v.string()),
    periodLabel: v.optional(v.string()),
    dueDate: v.string(),
    status: v.string(),
    submissionMethod: v.optional(v.string()),
    submittedByUserId: v.optional(v.id("users")),
    submissionChecklist: v.optional(v.array(v.string())),
    registryUrl: v.optional(v.string()),
    notes: v.optional(v.string()),
  },
  returns: v.any(),
  handler: (ctx, args) => createPortable(toPortableMutationCtx(ctx), args),
});

export const markFiled = mutation({
  args: {
    id: v.id("filings"),
    filedAt: v.string(),
    submissionMethod: v.optional(v.string()),
    submittedByUserId: v.optional(v.id("users")),
    confirmationNumber: v.optional(v.string()),
    feePaidCents: v.optional(v.number()),
    receiptDocumentId: v.optional(v.id("documents")),
    stagedPacketDocumentId: v.optional(v.id("documents")),
    evidenceNotes: v.optional(v.string()),
    attestedByUserId: v.optional(v.id("users")),
    submissionChecklist: v.optional(v.array(v.string())),
  },
  returns: v.any(),
  handler: (ctx, args) => markFiledPortable(toPortableMutationCtx(ctx), args),
});

export const update = mutation({
  args: {
    id: v.id("filings"),
    patch: v.object({
      kind: v.optional(v.string()),
      jurisdictionCode: v.optional(v.string()),
      contextKind: v.optional(v.string()),
      sourceRegistrationId: v.optional(v.string()),
      periodLabel: v.optional(v.string()),
      dueDate: v.optional(v.string()),
      status: v.optional(v.string()),
      filedAt: v.optional(v.string()),
      confirmationNumber: v.optional(v.string()),
      feePaidCents: v.optional(v.number()),
      submissionMethod: v.optional(v.string()),
      submittedByUserId: v.optional(v.id("users")),
      receiptDocumentId: v.optional(v.id("documents")),
      stagedPacketDocumentId: v.optional(v.id("documents")),
      sourceDocumentIds: v.optional(v.array(v.id("documents"))),
      submissionChecklist: v.optional(v.array(v.string())),
      registryUrl: v.optional(v.string()),
      evidenceNotes: v.optional(v.string()),
      attestedByUserId: v.optional(v.id("users")),
      attestedAtISO: v.optional(v.string()),
      sourceExternalIds: v.optional(v.array(v.string())),
      sourcePayloadJson: v.optional(v.string()),
      notes: v.optional(v.string()),
    }),
  },
  returns: v.any(),
  handler: (ctx, args) => updatePortable(toPortableMutationCtx(ctx), args),
});

export const importBcRegistryHistory = mutation({
  args: {
    societyId: v.id("societies"),
    records: v.array(
      v.object({
        kind: v.string(),
        jurisdictionCode: v.optional(v.string()),
        contextKind: v.optional(v.string()),
        sourceRegistrationId: v.optional(v.string()),
        periodLabel: v.optional(v.string()),
        dueDate: v.string(),
        filedAt: v.optional(v.string()),
        submissionMethod: v.optional(v.string()),
        confirmationNumber: v.optional(v.string()),
        feePaidCents: v.optional(v.number()),
        receiptDocumentId: v.optional(v.id("documents")),
        stagedPacketDocumentId: v.optional(v.id("documents")),
        sourceDocumentIds: v.optional(v.array(v.id("documents"))),
        submissionChecklist: v.optional(v.array(v.string())),
        registryUrl: v.optional(v.string()),
        evidenceNotes: v.optional(v.string()),
        sourceExternalIds: v.array(v.string()),
        sourcePayloadJson: v.optional(v.string()),
        status: v.string(),
        notes: v.optional(v.string()),
      }),
    ),
  },
  returns: v.any(),
  handler: (ctx, args) => importBcRegistryHistoryPortable(toPortableMutationCtx(ctx), args),
});

export const remove = mutation({
  args: { id: v.id("filings") },
  returns: v.any(),
  handler: (ctx, args) => removePortable(toPortableMutationCtx(ctx), args),
});
