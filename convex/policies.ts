import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { assertAllowedOption, invalidOptionListIssues } from "./lib/orgHubOptions";

export const list = query({
  args: { societyId: v.id("societies") },
  handler: async (ctx, { societyId }) => {
    const [rows, pipaTrainings, publications, workflows, documentVersions, tasks] = await Promise.all([
      ctx.db.query("policies").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect(),
      ctx.db.query("pipaTrainings").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect(),
      ctx.db.query("publications").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect(),
      ctx.db.query("workflows").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect(),
      ctx.db.query("documentVersions").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect(),
      ctx.db.query("tasks").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect(),
    ]);
    return rows
      .sort((a, b) =>
        String(a.reviewDate ?? a.effectiveDate ?? "").localeCompare(String(b.reviewDate ?? b.effectiveDate ?? "")),
      )
      .map((policy) => ({
        ...policy,
        lifecycle: policyLifecycle(policy, {
          pipaTrainings,
          publications,
          workflows,
          documentVersions,
          tasks,
        }),
      }));
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
    assertAllowedOption("policyStatuses", args.status, "Policy status");
    for (const issue of [
      ...invalidOptionListIssues("requiredSigners", args.requiredSigners, "Required signers"),
      ...invalidOptionListIssues("entityJurisdictions", args.jurisdictions, "Jurisdictions"),
      ...invalidOptionListIssues("entityTypes", args.entityTypes, "Entity types"),
    ]) {
      throw new Error(issue);
    }
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

export const createReviewTask = mutation({
  args: {
    policyId: v.id("policies"),
    dueDate: v.optional(v.string()),
  },
  handler: async (ctx, { policyId, dueDate }) => {
    const policy = await ctx.db.get(policyId);
    if (!policy) throw new Error("Policy not found.");
    return await ctx.db.insert("tasks", {
      societyId: policy.societyId,
      title: `Review policy: ${policy.policyName}`,
      description: "Review effective date, owner, documents, signers, publication status, and training impact.",
      status: "Todo",
      priority: policy.reviewDate && policy.reviewDate < todayDate() ? "High" : "Medium",
      dueDate: dueDate || policy.reviewDate || todayDate(),
      documentId: policy.pdfDocumentId ?? policy.docxDocumentId,
      eventId: `policy:${String(policy._id)}`,
      tags: ["policy", "review"],
      createdAtISO: new Date().toISOString(),
    });
  },
});

export const createRequiredSignerTask = mutation({
  args: { policyId: v.id("policies") },
  handler: async (ctx, { policyId }) => {
    const policy = await ctx.db.get(policyId);
    if (!policy) throw new Error("Policy not found.");
    if (!policy.signatureRequired) throw new Error("This policy does not require signatures.");
    return await ctx.db.insert("tasks", {
      societyId: policy.societyId,
      title: `Collect policy signatures: ${policy.policyName}`,
      description: `Required signers: ${(policy.requiredSigners ?? []).join(", ") || "Needs review"}`,
      status: "Todo",
      priority: "High",
      dueDate: policy.effectiveDate || policy.reviewDate || todayDate(),
      documentId: policy.pdfDocumentId ?? policy.docxDocumentId,
      eventId: `policy-signatures:${String(policy._id)}`,
      tags: ["policy", "signatures"],
      createdAtISO: new Date().toISOString(),
    });
  },
});

export const createTransparencyDraft = mutation({
  args: { policyId: v.id("policies") },
  handler: async (ctx, { policyId }) => {
    const policy = await ctx.db.get(policyId);
    if (!policy) throw new Error("Policy not found.");
    const documentId = policy.pdfDocumentId ?? policy.docxDocumentId;
    const existing = await ctx.db
      .query("publications")
      .withIndex("by_society", (q) => q.eq("societyId", policy.societyId))
      .collect();
    const match = existing.find((row) =>
      row.category === "Policy" &&
      ((documentId && row.documentId === documentId) || row.title.toLowerCase() === policy.policyName.toLowerCase()),
    );
    if (match) return match._id;
    return await ctx.db.insert("publications", {
      societyId: policy.societyId,
      title: policy.policyName,
      summary: policy.notes,
      category: "Policy",
      documentId,
      status: "Draft",
      reviewStatus: "InReview",
      createdAtISO: new Date().toISOString(),
    });
  },
});

function policyLifecycle(policy: any, related: Record<string, any[]>) {
  const docIds = new Set([policy.docxDocumentId, policy.pdfDocumentId].filter(Boolean).map(String));
  const name = String(policy.policyName ?? "").toLowerCase();
  const reviewDate = policy.reviewDate;
  const reviewState =
    !reviewDate ? "missing_review_date"
    : reviewDate < todayDate() ? "overdue"
    : daysFromToday(reviewDate) <= 30 ? "due_soon"
    : "scheduled";
  const versionCount = related.documentVersions.filter((version) => docIds.has(String(version.documentId))).length;
  const publication = related.publications.find((row) =>
    row.category === "Policy" &&
    ((row.documentId && docIds.has(String(row.documentId))) || row.title.toLowerCase() === name),
  );
  const trainingCount = related.pipaTrainings.filter((training) =>
    `${training.topic ?? ""} ${training.notes ?? ""}`.toLowerCase().includes(name) ||
    (name.includes("privacy") && String(training.topic ?? "").toLowerCase().includes("pipa")),
  ).length;
  const workflowCount = related.workflows.filter((workflow) =>
    `${workflow.name ?? ""} ${workflow.recipe ?? ""}`.toLowerCase().includes(name) ||
    `${workflow.name ?? ""} ${workflow.recipe ?? ""}`.toLowerCase().includes("policy"),
  ).length;
  const taskCount = related.tasks.filter((task) =>
    String(task.eventId ?? "").includes(String(policy._id)) ||
    (task.documentId && docIds.has(String(task.documentId))) ||
    (task.tags ?? []).includes("policy"),
  ).length;
  return {
    reviewState,
    versionCount,
    publicationId: publication?._id,
    publicationStatus: publication?.status,
    trainingCount,
    workflowCount,
    taskCount,
    signatureState: policy.signatureRequired
      ? (policy.requiredSigners?.length ? "required" : "missing_signers")
      : "not_required",
  };
}

function cleanText(value: unknown) {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function cleanList(values?: string[]) {
  return Array.from(new Set((values ?? []).map((value) => cleanText(value)).filter(Boolean))) as string[];
}

function todayDate() {
  return new Date().toISOString().slice(0, 10);
}

function daysFromToday(date: string) {
  return Math.ceil((new Date(date).getTime() - new Date(todayDate()).getTime()) / 86400000);
}
