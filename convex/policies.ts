import { mutation, query } from "./lib/untypedServer";
import { v } from "convex/values";
import {
  listPortable,
  adoptionOptionsPortable,
  upsertPortable,
  removePortable,
  createReviewTaskPortable,
  createRequiredSignerTaskPortable,
  createTransparencyDraftPortable,
} from "../shared/functions/policies";
import { toPortableQueryCtx, toPortableMutationCtx } from "./lib/portable";

export const list = query({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: (ctx, args) => listPortable(toPortableQueryCtx(ctx), args),
});

export const adoptionOptions = query({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: (ctx, args) => adoptionOptionsPortable(toPortableQueryCtx(ctx), args),
});

export const upsert = mutation({
  args: {
    id: v.optional(v.id("policies")),
    societyId: v.id("societies"),
    policyName: v.string(),
    policyNumber: v.optional(v.string()),
    owner: v.optional(v.string()),
    effectiveDate: v.optional(v.string()),
    reviewDate: v.optional(v.string()),
    ceasedDate: v.optional(v.string()),
    docxDocumentId: v.optional(v.id("documents")),
    pdfDocumentId: v.optional(v.id("documents")),
    adoptedAtMeetingId: v.optional(v.id("meetings")),
    adoptedInMinutesId: v.optional(v.id("minutes")),
    adoptingMotionEvidenceId: v.optional(v.id("motionEvidence")),
    html: v.optional(v.string()),
    requiredSigners: v.optional(v.array(v.string())),
    signatureRequired: v.optional(v.boolean()),
    jurisdictions: v.optional(v.array(v.string())),
    entityTypes: v.optional(v.array(v.string())),
    status: v.optional(v.string()),
    notes: v.optional(v.string()),
  },
  returns: v.any(),
  handler: (ctx, args) => upsertPortable(toPortableMutationCtx(ctx), args),
});

export const remove = mutation({
  args: { id: v.id("policies") },
  returns: v.any(),
  handler: (ctx, args) => removePortable(toPortableMutationCtx(ctx), args),
});

export const createReviewTask = mutation({
  args: {
    policyId: v.id("policies"),
    dueDate: v.optional(v.string()),
  },
  returns: v.any(),
  handler: (ctx, args) => createReviewTaskPortable(toPortableMutationCtx(ctx), args),
});

export const createRequiredSignerTask = mutation({
  args: { policyId: v.id("policies") },
  returns: v.any(),
  handler: (ctx, args) => createRequiredSignerTaskPortable(toPortableMutationCtx(ctx), args),
});

export const createTransparencyDraft = mutation({
  args: { policyId: v.id("policies") },
  returns: v.any(),
  handler: (ctx, args) => createTransparencyDraftPortable(toPortableMutationCtx(ctx), args),
});
