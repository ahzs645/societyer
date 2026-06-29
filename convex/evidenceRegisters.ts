import { mutation, query } from "./lib/untypedServer";
import { v } from "convex/values";
import {
  overviewPortable,
  updateReviewPortable,
  promoteBoardRoleToDirectorPortable,
  finishFinancePaperlessReviewPortable,
  finishSafePaperlessReviewPortable,
  createManualPortable,
} from "../shared/functions/evidenceRegisters";
import { toPortableQueryCtx, toPortableMutationCtx } from "./lib/portable";

export const overview = query({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: (ctx, args) => overviewPortable(toPortableQueryCtx(ctx), args),
});

export const updateReview = mutation({
  args: {
    table: v.string(),
    id: v.string(),
    status: v.optional(v.string()),
    notes: v.optional(v.string()),
  },
  returns: v.any(),
  handler: (ctx, args) => updateReviewPortable(toPortableMutationCtx(ctx), args),
});

export const promoteBoardRoleToDirector = mutation({
  args: {
    assignmentId: v.id("boardRoleAssignments"),
    position: v.optional(v.string()),
    isBCResident: v.optional(v.boolean()),
    consentOnFile: v.optional(v.boolean()),
    status: v.optional(v.string()),
    notes: v.optional(v.string()),
  },
  returns: v.any(),
  handler: (ctx, args) => promoteBoardRoleToDirectorPortable(toPortableMutationCtx(ctx), args),
});

export const finishFinancePaperlessReview = mutation({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: (ctx, args) => finishFinancePaperlessReviewPortable(toPortableMutationCtx(ctx), args),
});

export const finishSafePaperlessReview = mutation({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: (ctx, args) => finishSafePaperlessReviewPortable(toPortableMutationCtx(ctx), args),
});

export const createManual = mutation({
  args: {
    societyId: v.id("societies"),
    kind: v.string(),
    payload: v.any(),
  },
  returns: v.any(),
  handler: (ctx, args) => createManualPortable(toPortableMutationCtx(ctx), args),
});
