import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

export const list = query({
  args: {
    societyId: v.id("societies"),
    workflowId: v.optional(v.id("workflows")),
  },
  handler: async (ctx, { societyId, workflowId }) => {
    const rows = workflowId
      ? await ctx.db
          .query("workflowPackages")
          .withIndex("by_workflow", (q) => q.eq("workflowId", workflowId))
          .collect()
      : await ctx.db
          .query("workflowPackages")
          .withIndex("by_society", (q) => q.eq("societyId", societyId))
          .collect();
    return rows
      .filter((row) => row.societyId === societyId)
      .sort((a, b) => String(b.effectiveDate ?? b.createdAtISO).localeCompare(String(a.effectiveDate ?? a.createdAtISO)));
  },
});

export const upsert = mutation({
  args: {
    id: v.optional(v.id("workflowPackages")),
    societyId: v.id("societies"),
    workflowId: v.optional(v.id("workflows")),
    workflowRunId: v.optional(v.id("workflowRuns")),
    eventType: v.string(),
    effectiveDate: v.optional(v.string()),
    status: v.optional(v.string()),
    packageName: v.string(),
    parts: v.optional(v.array(v.string())),
    notes: v.optional(v.string()),
    supportingDocumentIds: v.optional(v.array(v.id("documents"))),
    priceItems: v.optional(v.array(v.string())),
    transactionId: v.optional(v.string()),
    signerRoster: v.optional(v.array(v.string())),
    signerEmails: v.optional(v.array(v.string())),
    signingPackageIds: v.optional(v.array(v.string())),
    stripeCheckoutSessionId: v.optional(v.string()),
  },
  handler: async (ctx, { id, ...args }) => {
    const now = new Date().toISOString();
    const payload = {
      societyId: args.societyId,
      workflowId: args.workflowId,
      workflowRunId: args.workflowRunId,
      eventType: cleanText(args.eventType) || "other",
      effectiveDate: cleanText(args.effectiveDate),
      status: cleanText(args.status) || "draft",
      packageName: cleanText(args.packageName) || "Untitled package",
      parts: cleanList(args.parts),
      notes: cleanText(args.notes),
      supportingDocumentIds: args.supportingDocumentIds ?? [],
      priceItems: cleanList(args.priceItems),
      transactionId: cleanText(args.transactionId),
      signerRoster: cleanList(args.signerRoster),
      signerEmails: cleanList(args.signerEmails),
      signingPackageIds: cleanList(args.signingPackageIds),
      stripeCheckoutSessionId: cleanText(args.stripeCheckoutSessionId),
      updatedAtISO: now,
    };
    if (id) {
      await ctx.db.patch(id, payload);
      return id;
    }
    return await ctx.db.insert("workflowPackages", {
      ...payload,
      createdAtISO: now,
    });
  },
});

export const remove = mutation({
  args: { id: v.id("workflowPackages") },
  handler: async (ctx, { id }) => {
    await ctx.db.delete(id);
  },
});

function cleanText(value: unknown) {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function cleanList(values?: string[]) {
  return Array.from(new Set((values ?? []).map((value) => cleanText(value)).filter(Boolean))) as string[];
}
