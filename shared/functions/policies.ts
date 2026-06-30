/**
 * PORTABLE FUNCTIONS: the policies domain
 * (list / adoptionOptions / upsert / remove / createReviewTask /
 * createRequiredSignerTask / createTransparencyDraft).
 *
 * Reads/writes the `policies` table (plus related `tasks`/`publications`) over
 * `ctx.db`. Each handler runs unchanged on hosted Convex, the local Dexie
 * runtime, and the convex-test oracle. `policyLifecycle` and the small
 * date/sort helpers are pure (`ctx.db`-free) and shared across handlers.
 */

import type { PortableMutationCtx, PortableQueryCtx } from "../portable/ctx";
import { assertAllowedOption, invalidOptionListIssues } from "../orgHubOptions";
import { cleanText, cleanList } from "./text";

export async function listPortable(ctx: PortableQueryCtx, { societyId }: { societyId: string }) {
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
}

export async function adoptionOptionsPortable(ctx: PortableQueryCtx, { societyId }: { societyId: string }) {
  const [meetings, minutes, motionEvidence] = await Promise.all([
    ctx.db.query("meetings").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect(),
    ctx.db.query("minutes").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect(),
    ctx.db.query("motionEvidence").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect(),
  ]);
  return {
    meetings: sortDesc(meetings, "scheduledAt"),
    minutes: sortDesc(minutes, "heldAt"),
    motionEvidence: sortDesc(motionEvidence, "meetingDate"),
  };
}

export async function upsertPortable(ctx: PortableMutationCtx, { id, ...args }: Record<string, any>) {
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
    adoptedAtMeetingId: args.adoptedAtMeetingId,
    adoptedInMinutesId: args.adoptedInMinutesId,
    adoptingMotionEvidenceId: args.adoptingMotionEvidenceId,
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
}

export async function removePortable(ctx: PortableMutationCtx, { id }: { id: string }) {
  await ctx.db.delete(id);
}

export async function createReviewTaskPortable(ctx: PortableMutationCtx, { policyId, dueDate }: { policyId: string; dueDate?: string }) {
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
}

export async function createRequiredSignerTaskPortable(ctx: PortableMutationCtx, { policyId }: { policyId: string }) {
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
}

export async function createTransparencyDraftPortable(ctx: PortableMutationCtx, { policyId }: { policyId: string }) {
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
}

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
    adoptionState: policy.adoptedAtMeetingId || policy.adoptedInMinutesId || policy.adoptingMotionEvidenceId
      ? "linked"
      : policy.status === "Active"
        ? "missing_adoption_record"
        : "not_linked",
  };
}

function sortDesc(rows: any[], field: string) {
  return rows.slice().sort((a, b) => String(b[field] ?? "").localeCompare(String(a[field] ?? "")));
}

function todayDate() {
  return new Date().toISOString().slice(0, 10);
}

function daysFromToday(date: string) {
  return Math.ceil((new Date(date).getTime() - new Date(todayDate()).getTime()) / 86400000);
}
