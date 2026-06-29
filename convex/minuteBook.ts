import { mutation, query } from "./lib/untypedServer";
import { v } from "convex/values";
import {
  overviewPortable,
  upsertPortable,
  removePortable,
} from "../shared/functions/minuteBook";
import { toPortableQueryCtx, toPortableMutationCtx } from "./lib/portable";

export const overview = query({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: (ctx, args) => overviewPortable(toPortableQueryCtx(ctx), args),
});

export const upsert = mutation({
  args: {
    id: v.optional(v.id("minuteBookItems")),
    societyId: v.id("societies"),
    title: v.string(),
    recordType: v.string(),
    effectiveDate: v.optional(v.string()),
    status: v.optional(v.string()),
    documentIds: v.optional(v.array(v.id("documents"))),
    meetingId: v.optional(v.id("meetings")),
    minutesId: v.optional(v.id("minutes")),
    filingId: v.optional(v.id("filings")),
    policyId: v.optional(v.id("policies")),
    workflowPackageId: v.optional(v.id("workflowPackages")),
    writtenResolutionId: v.optional(v.id("writtenResolutions")),
    signatureIds: v.optional(v.array(v.id("signatures"))),
    sourceEvidenceIds: v.optional(v.array(v.id("sourceEvidence"))),
    archivedAtISO: v.optional(v.string()),
    notes: v.optional(v.string()),
  },
  returns: v.any(),
  handler: (ctx, args) => upsertPortable(toPortableMutationCtx(ctx), args),
});

export const remove = mutation({
  args: { id: v.id("minuteBookItems") },
  returns: v.any(),
  handler: (ctx, args) => removePortable(toPortableMutationCtx(ctx), args),
});
