import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

export const list = query({
  args: { societyId: v.id("societies") },
  handler: async (ctx, { societyId }) => {
    const rows = await ctx.db
      .query("policies")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect();
    return rows.sort((a, b) =>
      String(a.reviewDate ?? a.effectiveDate ?? "").localeCompare(String(b.reviewDate ?? b.effectiveDate ?? "")),
    );
  },
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
    html: v.optional(v.string()),
    requiredSigners: v.optional(v.array(v.string())),
    signatureRequired: v.optional(v.boolean()),
    jurisdictions: v.optional(v.array(v.string())),
    entityTypes: v.optional(v.array(v.string())),
    status: v.optional(v.string()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, { id, ...args }) => {
    const now = new Date().toISOString();
    const payload = {
      societyId: args.societyId,
      policyName: cleanText(args.policyName) || "Untitled policy",
      policyNumber: cleanText(args.policyNumber),
      owner: cleanText(args.owner),
      effectiveDate: cleanText(args.effectiveDate),
      reviewDate: cleanText(args.reviewDate),
      ceasedDate: cleanText(args.ceasedDate),
      docxDocumentId: args.docxDocumentId,
      pdfDocumentId: args.pdfDocumentId,
      html: cleanText(args.html),
      requiredSigners: cleanList(args.requiredSigners),
      signatureRequired: Boolean(args.signatureRequired),
      jurisdictions: cleanList(args.jurisdictions),
      entityTypes: cleanList(args.entityTypes),
      status: cleanText(args.status) || "Draft",
      notes: cleanText(args.notes),
      updatedAtISO: now,
    };
    if (id) {
      await ctx.db.patch(id, payload);
      return id;
    }
    return await ctx.db.insert("policies", {
      ...payload,
      createdAtISO: now,
    });
  },
});

export const remove = mutation({
  args: { id: v.id("policies") },
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
