import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

const REGISTER_TABLES = [
  "boardRoleAssignments",
  "boardRoleChanges",
  "signingAuthorities",
  "meetingAttendanceRecords",
  "motionEvidence",
  "budgetSnapshots",
  "budgetSnapshotLines",
  "financialStatementImports",
  "financialStatementImportLines",
  "treasurerReports",
  "transactionCandidates",
  "sourceEvidence",
  "archiveAccessions",
] as const;

export const overview = query({
  args: { societyId: v.id("societies") },
  handler: async (ctx, { societyId }) => {
    const result: Record<string, any[]> = {};
    for (const table of REGISTER_TABLES) {
      result[table] = await ctx.db
        .query(table)
        .withIndex("by_society", (q: any) => q.eq("societyId", societyId))
        .collect();
    }

    return {
      boardRoleAssignments: sortDesc(result.boardRoleAssignments, "startDate"),
      boardRoleChanges: sortDesc(result.boardRoleChanges, "effectiveDate"),
      signingAuthorities: sortDesc(result.signingAuthorities, "effectiveDate"),
      meetingAttendanceRecords: sortDesc(result.meetingAttendanceRecords, "meetingDate"),
      motionEvidence: sortDesc(result.motionEvidence, "meetingDate"),
      budgetSnapshots: sortDesc(result.budgetSnapshots, "fiscalYear"),
      budgetSnapshotLines: result.budgetSnapshotLines,
      financialStatementImports: sortDesc(result.financialStatementImports, "periodEnd"),
      financialStatementImportLines: result.financialStatementImportLines,
      treasurerReports: sortDesc(result.treasurerReports, "reportDate"),
      transactionCandidates: sortDesc(result.transactionCandidates, "transactionDate"),
      sourceEvidence: sortDesc(result.sourceEvidence, "createdAtISO"),
      archiveAccessions: sortDesc(result.archiveAccessions, "dateReceived"),
    };
  },
});

export const updateReview = mutation({
  args: {
    table: v.string(),
    id: v.string(),
    status: v.optional(v.string()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, { table, id, status, notes }) => {
    if (!REGISTER_TABLES.includes(table as any)) throw new Error(`Unsupported register table: ${table}`);
    const patch: Record<string, any> = {};
    if (status != null) patch.status = cleanText(status) || "NeedsReview";
    if (notes != null) patch.notes = cleanText(notes);
    if (Object.keys(patch).length === 0) return id;
    await ctx.db.patch(id as any, patch);
    return id;
  },
});

export const createManual = mutation({
  args: {
    societyId: v.id("societies"),
    kind: v.string(),
    payload: v.any(),
  },
  handler: async (ctx, { societyId, kind, payload }) => {
    const now = new Date().toISOString();
    const p = payload ?? {};

    if (kind === "boardRoleAssignment") {
      return await ctx.db.insert("boardRoleAssignments", {
        societyId,
        personName: cleanText(p.personName) || "Needs review",
        personKey: personKey(p.personName),
        roleTitle: cleanText(p.roleTitle) || "Director",
        roleGroup: cleanText(p.roleGroup),
        roleType: cleanText(p.roleType) || "observed",
        startDate: cleanDate(p.startDate) || todayDate(),
        endDate: cleanDate(p.endDate),
        status: cleanText(p.status) || "Observed",
        confidence: cleanText(p.confidence) || "Review",
        sourceExternalIds: arrayOf(p.sourceExternalIds).map(String),
        notes: cleanText(p.notes),
        createdAtISO: now,
      });
    }

    if (kind === "boardRoleChange") {
      return await ctx.db.insert("boardRoleChanges", {
        societyId,
        effectiveDate: cleanDate(p.effectiveDate) || todayDate(),
        changeType: cleanText(p.changeType) || "needs_review",
        roleTitle: cleanText(p.roleTitle) || "Needs review",
        personName: cleanText(p.personName),
        previousPersonName: cleanText(p.previousPersonName),
        status: cleanText(p.status) || "NeedsReview",
        confidence: cleanText(p.confidence) || "Review",
        sourceExternalIds: arrayOf(p.sourceExternalIds).map(String),
        notes: cleanText(p.notes),
        createdAtISO: now,
      });
    }

    if (kind === "signingAuthority") {
      return await ctx.db.insert("signingAuthorities", {
        societyId,
        personName: cleanText(p.personName) || "Needs review",
        roleTitle: cleanText(p.roleTitle),
        institutionName: cleanText(p.institutionName),
        accountLabel: cleanText(p.accountLabel),
        authorityType: cleanText(p.authorityType) || "signing",
        effectiveDate: cleanDate(p.effectiveDate) || todayDate(),
        endDate: cleanDate(p.endDate),
        status: cleanText(p.status) || "NeedsReview",
        confidence: cleanText(p.confidence) || "Review",
        sourceExternalIds: arrayOf(p.sourceExternalIds).map(String),
        notes: cleanText(p.notes),
        createdAtISO: now,
      });
    }

    throw new Error(`Manual creation is not configured for ${kind}`);
  },
});

function sortDesc(rows: any[], field: string) {
  return rows.slice().sort((a, b) => String(b?.[field] ?? "").localeCompare(String(a?.[field] ?? "")));
}

function cleanText(value: unknown) {
  const text = String(value ?? "").trim();
  return text ? text : undefined;
}

function cleanDate(value: unknown) {
  const text = cleanText(value);
  if (!text) return undefined;
  return text.match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? text.match(/\b(19|20)\d{2}\b/)?.[0]?.concat("-01-01");
}

function todayDate() {
  return new Date().toISOString().slice(0, 10);
}

function arrayOf(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function personKey(value: unknown) {
  return cleanText(value)?.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
