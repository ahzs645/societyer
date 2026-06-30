import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { auditorsListPortable, auditorCreatePortable, auditorUpdatePortable, auditorRemovePortable } from "../shared/functions/auditors";
import { toPortableQueryCtx, toPortableMutationCtx } from "./lib/portable";

export const list = query({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: (ctx, args) => auditorsListPortable(toPortableQueryCtx(ctx), args),
});

export const create = mutation({
  args: {
    societyId: v.id("societies"),
    firmName: v.string(),
    engagementType: v.string(),
    fiscalYear: v.string(),
    appointedBy: v.string(),
    appointedAtISO: v.string(),
    engagementLetterDocId: v.optional(v.id("documents")),
    independenceAttested: v.boolean(),
    status: v.string(),
    notes: v.optional(v.string()),
  },
  returns: v.any(),
  handler: (ctx, args) => auditorCreatePortable(toPortableMutationCtx(ctx), args),
});

export const update = mutation({
  args: {
    id: v.id("auditorAppointments"),
    patch: v.object({
      firmName: v.optional(v.string()),
      engagementType: v.optional(v.string()),
      fiscalYear: v.optional(v.string()),
      appointedBy: v.optional(v.string()),
      appointedAtISO: v.optional(v.string()),
      engagementLetterDocId: v.optional(v.id("documents")),
      independenceAttested: v.optional(v.boolean()),
      status: v.optional(v.string()),
      notes: v.optional(v.string()),
    }),
  },
  returns: v.any(),
  handler: (ctx, args) => auditorUpdatePortable(toPortableMutationCtx(ctx), args),
});

export const remove = mutation({
  args: { id: v.id("auditorAppointments") },
  returns: v.any(),
  handler: (ctx, args) => auditorRemovePortable(toPortableMutationCtx(ctx), args),
});
