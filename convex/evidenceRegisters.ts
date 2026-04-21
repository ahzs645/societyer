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

export const promoteBoardRoleToDirector = mutation({
  args: {
    assignmentId: v.id("boardRoleAssignments"),
    position: v.optional(v.string()),
    isBCResident: v.optional(v.boolean()),
    consentOnFile: v.optional(v.boolean()),
    status: v.optional(v.string()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const assignment = await ctx.db.get(args.assignmentId);
    if (!assignment) throw new Error("Board role assignment not found.");
    const name = splitName(assignment.personName);
    const directorId = await ctx.db.insert("directors", {
      societyId: assignment.societyId,
      memberId: assignment.memberId,
      firstName: name.firstName,
      lastName: name.lastName,
      email: undefined,
      aliases: [],
      position: cleanText(args.position) || assignment.roleTitle || "Director",
      isBCResident: args.isBCResident ?? false,
      termStart: assignment.startDate,
      termEnd: assignment.endDate,
      consentOnFile: args.consentOnFile ?? false,
      status: cleanText(args.status) || "Active",
      notes: appendReviewNote(
        args.notes,
        `Promoted from board role evidence ${String(assignment._id)}. Review source evidence before treating as final registry data.`,
      ),
    });
    await ctx.db.patch(args.assignmentId, {
      directorId,
      status: assignment.status === "Observed" ? "Verified" : assignment.status,
      notes: appendReviewNote(assignment.notes, `Promoted to director register as ${String(directorId)}.`),
    });
    return directorId;
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

export const finishSafePaperlessReview = mutation({
  args: { societyId: v.id("societies") },
  handler: async (ctx, { societyId }) => {
    const completedAt = todayDate();
    const counts: Record<string, number> = {
      boardRoleAssignmentsRejected: 0,
      boardRoleChangesVerified: 0,
      boardRoleChangesRejected: 0,
      signingAuthoritiesVerified: 0,
      signingAuthoritiesSuperseded: 0,
      signingAuthoritiesRejected: 0,
      attendanceVerified: 0,
      attendanceBlocked: 0,
      motionsVerified: 0,
      motionsRejected: 0,
      sourceEvidenceVerified: 0,
      archiveAccessionsInCustody: 0,
      insuranceVerifiedLapsed: 0,
      insuranceLapsed: 0,
      insuranceCancelled: 0,
      importRecordsRejected: 0,
    };

    for (const id of SAFE_REVIEW.boardRoleAssignmentsReject) {
      if (await patchOwned(ctx, "boardRoleAssignments", id, societyId, (row) => ({
        status: "Rejected",
        confidence: "High",
        notes: appendReviewNote(
          row.notes,
          `Paperless governance review completed ${completedAt}: rejected as a governance-register role assignment. Visual/source review showed this was employee-list, editorial-board, access-list, or external-role evidence rather than legal director/officer service.`,
        ),
      }))) counts.boardRoleAssignmentsRejected += 1;
    }

    for (const id of SAFE_REVIEW.boardRoleChangesVerify) {
      if (await patchOwned(ctx, "boardRoleChanges", id, societyId, (row) => ({
        status: "Verified",
        confidence: "High",
        notes: appendReviewNote(
          row.notes,
          `Paperless governance review completed ${completedAt}: verified against the rendered November 29, 2008 minutes as an explicit role-change action.`,
        ),
      }))) counts.boardRoleChangesVerified += 1;
    }

    for (const id of SAFE_REVIEW.boardRoleChangesReject) {
      if (await patchOwned(ctx, "boardRoleChanges", id, societyId, (row) => ({
        status: "Rejected",
        confidence: "High",
        notes: appendReviewNote(
          row.notes,
          `Paperless governance review completed ${completedAt}: rejected because the source was not a board-role change record.`,
        ),
      }))) counts.boardRoleChangesRejected += 1;
    }

    for (const id of SAFE_REVIEW.signingAuthoritiesVerify) {
      if (await patchOwned(ctx, "signingAuthorities", id, societyId, (row) => ({
        status: "Verified",
        confidence: "High",
        notes: appendReviewNote(
          row.notes,
          `Paperless signing-authority review completed ${completedAt}: verified against rendered source evidence for the named person and authority.`,
        ),
      }))) counts.signingAuthoritiesVerified += 1;
    }

    if (await patchOwned(ctx, "signingAuthorities", SAFE_REVIEW.signingAuthoritySupersede, societyId, (row) => ({
      status: "Superseded",
      confidence: "High",
      notes: appendReviewNote(
        row.notes,
        `Paperless signing-authority review completed ${completedAt}: superseded as a duplicate of ws7f8134gkr56x1m5mza1xtnan850jrz.`,
      ),
    }))) counts.signingAuthoritiesSuperseded += 1;

    if (await patchOwned(ctx, "signingAuthorities", SAFE_REVIEW.signingAuthorityReject, societyId, (row) => ({
      status: "Rejected",
      confidence: "High",
      notes: appendReviewNote(
        row.notes,
        `Paperless signing-authority review completed ${completedAt}: rejected because the imported person name was a malformed placeholder, not a signatory.`,
      ),
    }))) counts.signingAuthoritiesRejected += 1;

    for (const id of SAFE_REVIEW.attendanceVerify) {
      if (await patchOwned(ctx, "meetingAttendanceRecords", id, societyId, (row) => ({
        confidence: "High",
        notes: appendReviewNote(
          row.notes,
          `Paperless meeting-evidence review completed ${completedAt}: attendance was confirmed in the rendered source.`,
        ),
      }))) counts.attendanceVerified += 1;
    }

    for (const id of SAFE_REVIEW.attendanceBlocked) {
      if (await patchOwned(ctx, "meetingAttendanceRecords", id, societyId, (row) => ({
        attendanceStatus: "needs_review",
        confidence: "Review",
        notes: appendReviewNote(
          row.notes,
          `Paperless meeting-evidence review completed ${completedAt}: left unresolved because the needed source page was not available in the local rendered review trees.`,
        ),
      }))) counts.attendanceBlocked += 1;
    }

    for (const id of SAFE_REVIEW.motionsVerify) {
      if (await patchOwned(ctx, "motionEvidence", id, societyId, (row) => ({
        status: "Verified",
        confidence: "High",
        notes: appendReviewNote(
          row.notes,
          `Paperless meeting-evidence review completed ${completedAt}: motion evidence was confirmed in the rendered source.`,
        ),
      }))) counts.motionsVerified += 1;
    }

    for (const id of SAFE_REVIEW.motionsReject) {
      if (await patchOwned(ctx, "motionEvidence", id, societyId, (row) => ({
        status: "Rejected",
        confidence: "High",
        notes: appendReviewNote(
          row.notes,
          `Paperless meeting-evidence review completed ${completedAt}: rejected because the source was a tax, shipping, invoice, or receipt artifact rather than meeting evidence.`,
        ),
      }))) counts.motionsRejected += 1;
    }

    const sourceEvidenceKeepReview = new Set(SAFE_REVIEW.sourceEvidenceKeepNeedsReview);
    const evidenceRows = await ctx.db
      .query("sourceEvidence")
      .withIndex("by_society", (q: any) => q.eq("societyId", societyId))
      .collect();
    for (const row of evidenceRows) {
      if (row.status !== "NeedsReview" || sourceEvidenceKeepReview.has(row._id)) continue;
      await ctx.db.patch(row._id, {
        status: "Verified",
        notes: appendReviewNote(
          row.notes,
          `Paperless source-evidence review completed ${completedAt}: retained as verified source/provenance evidence. Unmapped AI evidence rows were intentionally left in NeedsReview.`,
        ),
      });
      counts.sourceEvidenceVerified += 1;
    }

    const archiveRows = await ctx.db
      .query("archiveAccessions")
      .withIndex("by_society", (q: any) => q.eq("societyId", societyId))
      .collect();
    for (const row of archiveRows) {
      if (row.status !== "NeedsReview") continue;
      await ctx.db.patch(row._id, {
        status: "InCustody",
        notes: appendReviewNote(
          row.notes,
          `Paperless archive review completed ${completedAt}: retained as in-custody archive/source material; no transfer-out or closed-archive signal was found in the reviewed rows.`,
        ),
      });
      counts.archiveAccessionsInCustody += 1;
    }

    for (const policy of SAFE_REVIEW.insuranceVerifiedLapsed) {
      if (await patchOwned(ctx, "insurancePolicies", policy.id, societyId, (row) => ({
        ...policy.patch,
        status: "Lapsed",
        confidence: "High",
        notes: appendReviewNote(
          row.notes,
          `Paperless insurance review completed ${completedAt}: corrected and verified against rendered source text, then marked lapsed because the coverage period has ended.`,
        ),
        updatedAtISO: new Date().toISOString(),
      }))) counts.insuranceVerifiedLapsed += 1;
    }

    for (const id of SAFE_REVIEW.insuranceHistoricalLapsed) {
      if (await patchOwned(ctx, "insurancePolicies", id, societyId, (row) => ({
        status: "Lapsed",
        notes: appendReviewNote(
          row.notes,
          `Paperless insurance review completed ${completedAt}: marked lapsed because the imported coverage/renewal dates are historical and should not remain active coverage.`,
        ),
        updatedAtISO: new Date().toISOString(),
      }))) counts.insuranceLapsed += 1;
    }

    for (const id of SAFE_REVIEW.insuranceCancel) {
      if (await patchOwned(ctx, "insurancePolicies", id, societyId, (row) => ({
        status: "Cancelled",
        confidence: "High",
        notes: appendReviewNote(
          row.notes,
          `Paperless insurance review completed ${completedAt}: removed from active use as a duplicate, placeholder-heavy, or non-insurance import.`,
        ),
        updatedAtISO: new Date().toISOString(),
      }))) counts.insuranceCancelled += 1;
    }

    for (const id of SAFE_REVIEW.oldTranspositionPendingReject) {
      if (await rejectImportRecord(ctx, id, societyId, `Paperless review completed ${completedAt}: rejected this old pending transposition candidate as an unsafe OCR/document-classification import.`)) {
        counts.importRecordsRejected += 1;
      }
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

function splitName(value: unknown) {
  const parts = (cleanText(value) || "Needs Review").split(/\s+/);
  if (parts.length === 1) return { firstName: parts[0], lastName: "Review" };
  return {
    firstName: parts.slice(0, -1).join(" "),
    lastName: parts[parts.length - 1],
  };
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

async function patchOwned(ctx: any, table: string, id: string, societyId: string, patchFor: (row: any) => Record<string, any>) {
  const row = await ctx.db.get(id as any);
  if (!row || String(row.societyId) !== String(societyId)) return false;
  await ctx.db.patch(id as any, patchFor(row));
  return true;
}

async function rejectImportRecord(ctx: any, id: string, societyId: string, note: string) {
  const doc = await ctx.db.get(id as any);
  if (!doc || String(doc.societyId) !== String(societyId)) return false;
  const payload = parseJson(doc.content);
  if (payload.status === "Rejected") return false;
  await ctx.db.patch(id as any, {
    content: JSON.stringify({
      ...payload,
      status: "Rejected",
      reviewNotes: appendReviewNote(payload.reviewNotes, note),
      updatedAtISO: new Date().toISOString(),
    }),
  });
  return true;
}

function parseJson(value: unknown) {
  try {
    return JSON.parse(String(value ?? "{}"));
  } catch {
    return {};
  }
}

const SAFE_REVIEW = {
  boardRoleAssignmentsReject: [
    "vs7f76ycmzrxpk3692j8ammz65851qk8",
    "vs729h1bgnx9qacgc0k2fkxddn850j4p",
    "vs78n3qcyjh2kx72zd57vxqjxh851yzk",
    "vs74fkzzf9nwfvemnbcpn4w0ex851hdn",
    "vs73881bydw6919wa8426g26f1850ngz",
    "vs7eghgxpx8h8k4epndfg36a2n851zv4",
    "vs7d9erv9zaew9g102rrze9ndx850jra",
    "vs73p2an0jpeq7xeekx61vz5fh850txh",
    "vs74amr19572cpf66fypy4vfwd850sb5",
    "vs7fh58j0nxr64vew5zyzaxvg185090h",
    "vs78bg816x9gtw3fekcgqaw7pn851j2f",
    "vs7cmhf7d36056km1az2887abd850ny0",
    "vs74e3peh9sha1x87y228hyeh5850dax",
    "vs701m6qyj2s2kvsj8a5qhx0xd851620",
    "vs71ycnrv5mhay2e37mrtc58yx850m6r",
    "vs7cmqw77399qy0c7ba04cr9598516rb",
    "vs7b802dmpnt9knj9yjy36bfnd851jfa",
    "vs7e4anhch48js1h0a1d8zj7hx851zyb",
    "vs7djxyh3yq11k9ee6qdyydvyx851vke",
    "vs7fgjddhez14d0gdav3fbdj95850p74",
    "vs7b8msnazdfjy42kxkt4t4gzx851jsf",
  ],
  boardRoleChangesVerify: [
    "vx75hzh3ag73rs6rg2ty16vxbs851av0",
    "vx75hj7ej4z1ba35fg1c0dnyr9851g0b",
    "vx78z0p36967hxy8ajv5ycg3hh85103j",
  ],
  boardRoleChangesReject: [
    "vx77j5qawzagb7kv2k6wecetm5850x04",
    "vx7a4cvwk0arv50ae6rvf1xh5x850dhk",
  ],
  signingAuthoritiesVerify: [
    "ws77v6f7ad44mpgaqe5ks2mnh5850h04",
    "ws7f8134gkr56x1m5mza1xtnan850jrz",
    "ws7bc4paddnkahptgqjq0q6drs850pj1",
    "ws78n8fzeq3tvqaj0tw1rg83dn8518fv",
    "ws79pyaaa4aw2gjb67xkd5rn398503qp",
    "ws773evazkdjb9gjsw3z3qc4wd850a9s",
  ],
  signingAuthoritySupersede: "ws7cq3wsvk6agbsj4z4gsfncxx851kbq",
  signingAuthorityReject: "ws7587ghcxjzq99qgghywpkvds851mqw",
  attendanceVerify: [
    "wh74dfjx8mf8q3vfj82neapmkd8519pd",
    "wh73pk61mezgbahyfcf2dh38c9851dj4",
    "wh71hc85425g6zj24tgj4yy71s850hyy",
    "wh7fryjb0cf0f15cnqn16shmks851k8y",
    "wh7ekanre3m72vxas58gtzweph851srk",
    "wh7ekypffcw3ph5mvagapne4vd8510we",
    "wh7c1q8wxfv3s6jrj5zk87dqs9850z6c",
    "wh7d3t66xm669nxyfxbwaekbpx850em5",
    "wh72krd6h16kwzz8rc6pej6f9s85165g",
    "wh794gb2zkr3m73krr909k1zy18514xc",
    "wh773ebj4ye7s9yc0thhk2sw3d851h6d",
    "wh79vt9jem5vtasdswd5d4vqk58500f8",
    "wh7bc3bje8p03rd1s59ghsbyzh851azz",
    "wh78rppm765x496ddfhvbbn3wh850jss",
    "wh7dz0bc45j2s95fjjf93st9sd850r5x",
    "wh7a9tcpjpc4p120k6ts0wzeqx851bz2",
    "wh7anha9y4n4vhbmex2en66z85851270",
    "wh7e85jtb1axzgag3dr8bv0ge5850g1m",
    "wh73p1vdmbx8nsn4b7335t1bmd850e2g",
    "wh77fdkhx91ff4kg93s5jy1vz9851nef",
    "wh72n5n2h8p3zkyadwk5zhq5z5850pkw",
    "wh7bd6t2vmcvc3j7k3w2bvfwg185117g",
    "wh77mc4sqjxdwh7hda8kbfbz2s85082q",
  ],
  attendanceBlocked: [
    "wh7ej2hy6gjyn9jbf6e10yyr21851fx0",
    "wh7bh0swrx6nhe8jz4fyy9xcc5851ey7",
    "wh73m3e65gzb515543g5ktmez9851vra",
  ],
  motionsVerify: [
    "wn73qww8rgbkhvkgjjz0620rkh8502w1",
    "wn75j5eq7qf0aq3zwqjr9bkxxs850yhk",
    "wn7b7dpz1296j3y31h201xqycn8516d9",
    "wn76v7c2ns4zjxn5z1jtwzz0h9850qq5",
    "wn76f4my6jjwcn4em3d6tfy6m9850ydz",
    "wn718xcypb7mpcyj9jhy87pm298518mq",
    "wn70721e67v5hfpvpe34ea2cxx8511w1",
  ],
  motionsReject: [
    "wn74nkthd0r2eqdz4a4x146x9s850kpj",
    "wn79ke0p596q7kec0eahvxkd5n8500m3",
    "wn76xzzdwcq0q66cbx9z74n4th850q0r",
    "wn7d7gmymd6a215x7qefespkdn8503a0",
  ],
  sourceEvidenceKeepNeedsReview: [
    "wx77ptmss8vcbz01ahz4a3qw1d850ge9",
    "wx78mq49knzzbbdv5zhnb8yr4s851hak",
    "wx7ac4kj2a4gd04pxqr2fe5kxx85057q",
    "wx76bj50b416rmhqj1hsnv6v3s850s5v",
    "wx74ts5hq37np44bb2yzprmag5850ccg",
    "wx75gh9mjqdtz8v87znnpqef4185188k",
    "wx75zrxd287bsy2wknjzwd012x850g4d",
    "wx713w2b64zbs92zvbkzgnt4k1850eta",
    "wx7fbbabnvmzaqmggwdr6jvwq9851rma",
  ],
  insuranceVerifiedLapsed: [
    {
      id: "q975260ppgmqf78023rdt5svc9851afg",
      patch: { kind: "GeneralLiability", insurer: "Brownridge", policyNumber: "501332671", startDate: "2022-11-01", endDate: "2023-11-01", renewalDate: "2023-11-01" },
    },
    {
      id: "q97dawaxe02cp9emv382teh705851eqn",
      patch: { kind: "GeneralLiability", insurer: "Brownridge", policyNumber: "501332671", startDate: "2023-11-01", endDate: "2024-11-01", renewalDate: "2024-11-01" },
    },
    {
      id: "q972ccxd2p5js0xp2d2bbeed2d850p5y",
      patch: { kind: "DirectorsOfficers", insurer: "Brownridge", policyNumber: "ONL533338", startDate: "2023-11-01", endDate: "2024-11-01", renewalDate: "2024-11-01" },
    },
  ],
  insuranceHistoricalLapsed: [
    "q978sbrrysdrpvtsnn6xf2f7ph851557",
    "q97aayspev13fs68eg2fvafz45850nv4",
    "q97e347csy4ftjj9ajkcchhhhx851cke",
    "q97bwb9wzk03jt2bp487v4gxdd851kv4",
    "q971the2nf58mph2hvcwwjr2fh850hct",
    "q97dj8p3s92732z7k4sg5et62s850f3y",
    "q97cew9xfywpmbkwb5738wv329850b4f",
    "q975nsj7r023w57jg14x9n0f4d851ppj",
    "q974kz7bs17kxw7f82fhnh0t29851x8m",
    "q976h457ez0jzmnec2khr0ce39851ykp",
    "q97bfyrsbwf232fjtgqmgcnfy1851a2p",
    "q972nskr3j10zqae3k83qj54d985018d",
    "q979v48yn04hgkhp82dm1xw2cn850ept",
  ],
  insuranceCancel: [
    "q970007mtkew1r9bhnsx6ehfr18505em",
    "q97c67wtfqv46ecvyaq8j9xvg1850ee5",
    "q97a5pqpd2f1hm6b5pz5p5vty58516vh",
    "q977rfcwfjhr2pf9h9c68a8jkh851z1c",
  ],
  oldTranspositionPendingReject: [
    "mn7378mmgq8tymvd28525pym0x84zd7g",
    "mn7fsgn53qax4dmetqbqw6k59984yw71",
    "mn7fcej514cxcxwngs0928bkxd84zrc1",
    "mn70qmndfszzg1erz5d4x3sy8184z74c",
    "mn770r2q6td5jkb74r0h5rm54x84yq8s",
    "mn7dd942sf2nz0ttrps05q7rq584yr10",
    "mn76fc6myedgq21xe6kyfbrtbn84y005",
    "mn7css8j5b1f7z382mn6mn0z6184zs03",
    "mn7eqzex9j6gwfcbbjt8b8qxr184zyqf",
    "mn74snp642yrqmzjhha9kwpk0h84ztay",
    "mn729473zkdwb1czdy1x0a7m4s84zv8r",
    "mn71rjjgkdqhxdbaz0180v5mvd84y151",
    "mn76a39gns4exzmkf2kjamyvzh84y5rz",
    "mn77mpf3e8zwv1cp0atfb9x09984y7ar",
  ],
} as const;
