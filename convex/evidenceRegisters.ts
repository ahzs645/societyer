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

export const finishFinancePaperlessReview = mutation({
  args: { societyId: v.id("societies") },
  handler: async (ctx, { societyId }) => {
    const completedAt = todayDate();
    const counts = {
      budgetVerified: 0,
      budgetSuperseded: 0,
      statementsVerified: 0,
      statementsRejected: 0,
      transactionsMatched: 0,
      transactionsIgnored: 0,
    };

    const budgets = await ctx.db
      .query("budgetSnapshots")
      .withIndex("by_society", (q: any) => q.eq("societyId", societyId))
      .collect();
    for (const row of budgets) {
      if (hasSource(row, "paperless:1412") && row.title === "2005 Fall Budget") {
        await ctx.db.patch(row._id, {
          totalIncomeCents: 2172000,
          totalExpenseCents: 2029300,
          netCents: 142700,
          endingBalanceCents: undefined,
          status: "Verified",
          confidence: "High",
          notes: appendReviewNote(
            row.notes,
            `Finance source review completed ${completedAt}: verified against the rendered Paperless budget page. The source shows total income $21,720.00 and total expenses $20,293.00; the previous expense value repeated the income total.`,
          ),
        });
        counts.budgetVerified += 1;
        continue;
      }

      await ctx.db.patch(row._id, {
        status: "Superseded",
        notes: appendReviewNote(
          row.notes,
          `Finance source review completed ${completedAt}: not promoted to official budget data. The imported figures came from OCR or sheet line-item extraction and were not reliable budget totals on visual review.`,
        ),
      });
      counts.budgetSuperseded += 1;
    }

    const statements = await ctx.db
      .query("financialStatementImports")
      .withIndex("by_society", (q: any) => q.eq("societyId", societyId))
      .collect();
    for (const row of statements) {
      if (row.status === "Verified" || shouldVerifyReviewedStatement(row)) {
        await ctx.db.patch(row._id, {
          status: "Verified",
          confidence: row.confidence === "Review" ? "High" : row.confidence,
          notes: appendReviewNote(
            row.notes,
            `Finance source review completed ${completedAt}: statement figures were retained as source-backed. Revenue and expense totals were confirmed where visible; net-asset values may be derived from the paired balance sheet, retained earnings, or trial balance support.`,
          ),
        });
        counts.statementsVerified += 1;
        continue;
      }

      await ctx.db.patch(row._id, {
        status: "Rejected",
        notes: appendReviewNote(
          row.notes,
          `Finance source review completed ${completedAt}: rejected as an authoritative financial statement import. This row was metadata-only, a budget/forecast/tax support artifact, or an Office/OCR parser result rather than a confirmed statement total.`,
        ),
      });
      counts.statementsRejected += 1;
    }

    const transactions = await ctx.db
      .query("transactionCandidates")
      .withIndex("by_society", (q: any) => q.eq("societyId", societyId))
      .collect();
    for (const row of transactions) {
      if (isSourceBackedLedgerTransaction(row)) {
        await ctx.db.patch(row._id, {
          status: "Matched",
          confidence: row.confidence === "Review" ? "High" : row.confidence,
          notes: appendReviewNote(
            row.notes,
            `Finance source review completed ${completedAt}: source-backed ledger row retained. Amount, debit/credit direction, reference, and running balance were present in the reviewed source text.`,
          ),
        });
        counts.transactionsMatched += 1;
        continue;
      }

      await ctx.db.patch(row._id, {
        status: "Ignored",
        notes: appendReviewNote(
          row.notes,
          `Finance source review completed ${completedAt}: ignored as a transaction candidate. Visual review showed these generic OCR/Office candidates frequently represented document-level amounts, line items, dates, or statement balances rather than posted transactions.`,
        ),
      });
      counts.transactionsIgnored += 1;
    }

    return counts;
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

function hasSource(row: any, sourceExternalId: string) {
  return arrayOf(row.sourceExternalIds).includes(sourceExternalId);
}

function shouldVerifyReviewedStatement(row: any) {
  return [
    "FY2022 retained earnings letter review",
    "Fall 2013 semester finance report review",
    "October 2005 monthly income statement review",
  ].includes(cleanText(row.title) ?? "");
}

function isSourceBackedLedgerTransaction(row: any) {
  const notes = cleanText(row.notes) ?? "";
  return (
    hasSource(row, "paperless:1345") &&
    /\bSource paperless:1345\b/.test(notes) &&
    /\b(amount|Cheque\/reference|Running balance)\b/i.test(notes) &&
    typeof row.amountCents === "number"
  );
}

function appendReviewNote(existing: unknown, note: string) {
  const current = cleanText(existing);
  if (!current) return note;
  if (current.includes(note)) return current;
  return `${current}\n\n${note}`;
}
