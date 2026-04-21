import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

export const overview = query({
  args: { societyId: v.id("societies") },
  handler: async (ctx, { societyId }) => {
    const [
      items,
      documents,
      meetings,
      minutes,
      filings,
      policies,
      workflowPackages,
      signatures,
      sourceEvidence,
    ] = await Promise.all([
      ctx.db.query("minuteBookItems").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect(),
      ctx.db.query("documents").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect(),
      ctx.db.query("meetings").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect(),
      ctx.db.query("minutes").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect(),
      ctx.db.query("filings").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect(),
      ctx.db.query("policies").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect(),
      ctx.db.query("workflowPackages").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect(),
      ctx.db.query("signatures").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect(),
      ctx.db.query("sourceEvidence").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect(),
    ]);

    return {
      items: sortDesc(items, "effectiveDate"),
      documents: sortDesc(
        documents.filter((doc: any) =>
          ["Constitution", "Bylaws", "Minutes", "Policy", "Filing", "FinancialStatement", "WorkflowGenerated"].includes(doc.category),
        ),
        "createdAtISO",
      ),
      meetings: sortDesc(meetings, "scheduledAt"),
      minutes: sortDesc(minutes, "heldAt"),
      filings: sortDesc(filings, "dueDate"),
      policies: sortDesc(policies, "effectiveDate"),
      workflowPackages: sortDesc(workflowPackages, "effectiveDate"),
      signatures: sortDesc(signatures, "signedAtISO"),
      sourceEvidence: sortDesc(sourceEvidence, "createdAtISO"),
    };
  },
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
    signatureIds: v.optional(v.array(v.id("signatures"))),
    sourceEvidenceIds: v.optional(v.array(v.id("sourceEvidence"))),
    archivedAtISO: v.optional(v.string()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, { id, ...args }) => {
    const now = new Date().toISOString();
    const payload = {
      societyId: args.societyId,
      title: cleanText(args.title) || "Untitled record",
      recordType: cleanText(args.recordType) || "other",
      effectiveDate: cleanText(args.effectiveDate),
      status: cleanText(args.status) || "NeedsReview",
      documentIds: args.documentIds ?? [],
      meetingId: args.meetingId,
      minutesId: args.minutesId,
      filingId: args.filingId,
      policyId: args.policyId,
      workflowPackageId: args.workflowPackageId,
      signatureIds: args.signatureIds ?? [],
      sourceEvidenceIds: args.sourceEvidenceIds ?? [],
      archivedAtISO: cleanText(args.archivedAtISO),
      notes: cleanText(args.notes),
      updatedAtISO: now,
    };
    if (id) {
      await ctx.db.patch(id, payload);
      return id;
    }
    return await ctx.db.insert("minuteBookItems", {
      ...payload,
      createdAtISO: now,
    });
  },
});

export const remove = mutation({
  args: { id: v.id("minuteBookItems") },
  handler: async (ctx, { id }) => {
    await ctx.db.delete(id);
  },
});

function sortDesc(rows: any[], field: string) {
  return rows.slice().sort((a, b) => String(b[field] ?? "").localeCompare(String(a[field] ?? "")));
}

function cleanText(value: unknown) {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}
