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
      motionEvidence,
      archiveAccessions,
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
      ctx.db.query("motionEvidence").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect(),
      ctx.db.query("archiveAccessions").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect(),
    ]);

    const binderDocuments = documents.filter((doc: any) =>
      ["Constitution", "Bylaws", "Minutes", "Policy", "Filing", "FinancialStatement", "WorkflowGenerated"].includes(doc.category),
    );

    return {
      items: sortDesc(items, "effectiveDate"),
      documents: sortDesc(binderDocuments, "createdAtISO"),
      meetings: sortDesc(meetings, "scheduledAt"),
      minutes: sortDesc(minutes, "heldAt"),
      filings: sortDesc(filings, "dueDate"),
      policies: sortDesc(policies, "effectiveDate"),
      workflowPackages: sortDesc(workflowPackages, "effectiveDate"),
      signatures: sortDesc(signatures, "signedAtISO"),
      sourceEvidence: sortDesc(sourceEvidence, "createdAtISO"),
      motionEvidence: sortDesc(motionEvidence, "meetingDate"),
      archiveAccessions: sortDesc(archiveAccessions, "dateReceived"),
      checks: minuteBookChecks({
        items,
        documents,
        binderDocuments,
        meetings,
        minutes,
        filings,
        policies,
        workflowPackages,
        signatures,
        motionEvidence,
        archiveAccessions,
      }),
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

function minuteBookChecks({
  items,
  documents,
  binderDocuments,
  meetings,
  minutes,
  filings,
  policies,
  workflowPackages,
  signatures,
  motionEvidence,
  archiveAccessions,
}: Record<string, any[]>) {
  const categorySet = new Set(binderDocuments.map((doc) => doc.category));
  const missingBasics = ["Constitution", "Bylaws", "Minutes"].filter((category) => !categorySet.has(category));
  const signatureEntityKeys = new Set(signatures.map((signature) => `${signature.entityType}:${signature.entityId}`));
  const missingSignatureItems = items.filter((item) => {
    const type = String(item.recordType ?? "").toLowerCase();
    const needsSignature = /resolution|minutes|minute|policy|filing|package/.test(type) ||
      item.policyId ||
      item.workflowPackageId ||
      item.minutesId;
    if (!needsSignature) return false;
    if ((item.signatureIds ?? []).length > 0) return false;
    return !signatureEntityKeys.has(`minuteBookItems:${String(item._id)}`) &&
      !signatureEntityKeys.has(`minuteBookItem:${String(item._id)}`);
  });
  const openFilings = filings.filter((filing) => !/filed|submitted|complete/i.test(String(filing.status ?? "")));
  const unresolvedMotions = motionEvidence.filter((motion) =>
    /needsreview|needs review|extracted|pending|unknown/i.test(`${motion.status ?? ""} ${motion.outcome ?? ""}`),
  );
  const paperArchiveDocs = documents.filter((doc) =>
    [doc.title, doc.category, ...(doc.tags ?? [])].join(" ").toLowerCase().includes("paper minute book") ||
    [doc.title, doc.category, ...(doc.tags ?? [])].join(" ").toLowerCase().includes("paper archive"),
  );
  const packageGaps = workflowPackages.filter((pkg) =>
    !/filed|archived|cancelled/i.test(String(pkg.status ?? "")) &&
    ((pkg.signerRoster ?? []).length > 0 || (pkg.supportingDocumentIds ?? []).length > 0),
  );
  const policyReviewGaps = policies.filter((policy) =>
    !policy.reviewDate || (policy.reviewDate < todayDate() && !/ceased|superseded/i.test(String(policy.status ?? ""))),
  );

  return [
    check("missing_core_documents", "Missing constitution/bylaws/minutes", missingBasics.length, "danger", missingBasics.join(", ")),
    check("missing_signatures", "Records missing signatures", missingSignatureItems.length, "warn", "Minute-book records that appear to require signatures but have none linked."),
    check("open_filings", "Open or unfiled filings", openFilings.length, "warn", "Filings still need submission evidence or completion."),
    check("unresolved_resolutions", "Unresolved resolution evidence", unresolvedMotions.length, "warn", "Imported motions still need review or final outcomes."),
    check("paper_archive_gap", "Paper minute-book archive gap", archiveAccessions.length || paperArchiveDocs.length ? 0 : 1, "info", "No archive accession or document tag for the paper minute book."),
    check("workflow_package_gaps", "Workflow packages in progress", packageGaps.length, "info", "Packages with signers or documents that are not filed/archived."),
    check("policy_review_gaps", "Policy review gaps", policyReviewGaps.length, "warn", "Policies missing review dates or past due for review."),
    check("meeting_minutes_gap", "Meetings without minutes", Math.max(0, meetings.length - minutes.length), "warn", "Meeting count exceeds minutes count."),
  ];
}

function check(key: string, label: string, count: number, severity: string, detail: string) {
  return { key, label, count, severity, detail, ok: count === 0 };
}

function todayDate() {
  return new Date().toISOString().slice(0, 10);
}

function cleanText(value: unknown) {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}
