import { authorizedMutation, authorizedQuery } from "./lib/authorizedServer";
import { mutation, query } from "./lib/untypedServer";
import { v } from "convex/values";
import { checklistPortable, recordEvidencePortable } from "../shared/functions/postIncorporation";
import { toPortableMutationCtx, toPortableQueryCtx } from "./lib/portable";

/**
 * Post-incorporation guided checklist (YCN "next steps after incorporating").
 * Returns the ordered steps for the society's jurisdiction/entity type (pure
 * logic in shared/postIncorporationSteps.ts), each enriched with whether its
 * linked document packet has already been generated, so the UI can show progress
 * and a one-click generate per step.
 */
export const checklist = authorizedQuery("postIncorporation:checklist", query)({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: async (ctx, args) => checklistPortable(await toPortableQueryCtx(ctx), args),
});


export const recordEvidence = authorizedMutation("postIncorporation:recordEvidence", mutation)({
  args: { societyId: v.id("societies"), stepKey: v.string(), stage: v.string(), documentId: v.optional(v.id("documents")), confirmationNumber: v.optional(v.string()), notes: v.optional(v.string()) },
  returns: v.string(),
  handler: async (ctx, args) => recordEvidencePortable(await toPortableMutationCtx(ctx), args),
});
