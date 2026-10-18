import {
  BEFORE_OPENING_FLAG,
  SUSPENSE_ACCOUNT_TEMPLATE,
  SUSPENSE_FLAG,
  findSuspenseAccount,
  journalLinesForPlanRow,
  normalizeCategory,
  openingBalanceDate,
  planTransactionBackfill,
  type BackfillAccount,
  type BackfillMapping,
  type BackfillPlanRow,
  type BackfillTransaction,
  type TransactionJournalLine,
} from "../accountingBackfill";
import { assertValid, validateCounterpartyInput, validateFiscalPeriodInput } from "../recordValidation";
import { getPortable as getAccessibleDocument } from "./documents";
/**
 * PORTABLE FUNCTIONS: the accounting domain (chart of accounts, fiscal periods,
 * counterparties, fund restrictions, account mappings, journal entries, trial
 * balance, general ledger, CSV exports, board/auditor package) plus the
 * role-gated write surface (seeding, period close/reopen, upserts, posting
 * transaction candidates, backfills, opening balances, and reconciliation runs).
 *
 * Each handler reads/writes exclusively through the portable `ctx.db` contract
 * and runs unchanged on hosted Convex, the local Dexie runtime, and the
 * convex-test oracle. Role gating goes through `requireRolePortable`, and the
 * pure money/journal helpers come from `shared/accountingCore`.
 */

import type { PortableDoc, PortableMutationCtx, PortableQueryCtx } from "../portable/ctx";
import { getOwned, requireOwnedRow, principalUserId, requireRolePortable, requireSocietyMembership } from "./access";
import { validateBalancedJournalLines } from "../accountingCore";
import { accountParentError } from "../accountHierarchy";
import { requirePermissionPortable } from "./permissions";
import { assertBooksOpen, booksAccountingBasis, booksCloseDate, booksSettingsRow } from "./booksLock";
import {
  ACCOUNTING_BASES,
  BOOKS_REPORT_KINDS,
  REPORT_FREQUENCIES,
  buildBooksReport,
  buildChartRegister,
  buildGeneralLedgerReport,
  buildJournalRegister,
  buildReportPeriods,
  closedBooksError,
  defaultReportCurrency,
  fiscalYearStartMonth,
  isIsoDate,
  isJournalBasis,
  reportDrillLines,
  validateLineFilter,
  type AccountingBasis,
  type BooksAccount,
  type BooksEntry,
  type BooksLine,
  type BooksReportKind,
  type ReportFrequency,
  type ReportLineFilter,
} from "../booksReports";
import { accountSection, type HierarchyAccount } from "../accountHierarchy";
import { todayDateOnly } from "../dateOnly";

const ACCOUNT_TYPES = ["Asset", "Liability", "Equity", "Income", "Expense"] as const;
const NORMAL_BALANCES = ["debit", "credit"] as const;
const JOURNAL_STATUSES = ["draft", "posted", "void"] as const;
const FISCAL_PERIOD_STATUSES = ["open", "closed", "archived"] as const;
const COUNTERPARTY_KINDS = ["vendor", "customer", "funder", "member", "employee", "government", "other"] as const;
const FUND_RESTRICTION_STATUSES = ["active", "released", "archived"] as const;
const ACCOUNT_MAPPING_STATUSES = ["active", "inactive", "needs_review"] as const;
const RECONCILIATION_STATUSES = ["draft", "ready", "reconciled", "reopened"] as const;

const SOCIETYER_CONNECTION_PROVIDER = "societyer";

const SOCIETY_COA_TEMPLATE = [
  { code: "1000", name: "Cash and bank", accountType: "Asset", subtype: "cash", normalBalance: "debit" },
  { code: "1100", name: "Accounts receivable", accountType: "Asset", subtype: "receivable", normalBalance: "debit" },
  { code: "1200", name: "Prepaid expenses", accountType: "Asset", subtype: "prepaid", normalBalance: "debit" },
  { code: "1500", name: "Capital assets", accountType: "Asset", subtype: "fixed_asset", normalBalance: "debit" },
  { code: "2000", name: "Accounts payable", accountType: "Liability", subtype: "payable", normalBalance: "credit" },
  { code: "2100", name: "Deferred revenue", accountType: "Liability", subtype: "deferred_revenue", normalBalance: "credit" },
  { code: "2200", name: "Restricted funds payable", accountType: "Liability", subtype: "restricted_fund", normalBalance: "credit" },
  { code: "3000", name: "Unrestricted net assets", accountType: "Equity", subtype: "net_assets", normalBalance: "credit" },
  { code: "3100", name: "Restricted net assets", accountType: "Equity", subtype: "restricted_net_assets", normalBalance: "credit" },
  { code: "4000", name: "Donations and fundraising", accountType: "Income", subtype: "donations", normalBalance: "credit" },
  { code: "4100", name: "Grant revenue", accountType: "Income", subtype: "grants", normalBalance: "credit" },
  { code: "4200", name: "Membership dues", accountType: "Income", subtype: "dues", normalBalance: "credit" },
  { code: "4300", name: "Program fees", accountType: "Income", subtype: "program_revenue", normalBalance: "credit" },
  { code: "5000", name: "Program supplies", accountType: "Expense", subtype: "program", normalBalance: "debit" },
  { code: "5100", name: "Wages and benefits", accountType: "Expense", subtype: "payroll", normalBalance: "debit" },
  { code: "5200", name: "Facilities and utilities", accountType: "Expense", subtype: "facilities", normalBalance: "debit" },
  { code: "5300", name: "Insurance", accountType: "Expense", subtype: "insurance", normalBalance: "debit" },
  { code: "5400", name: "Professional fees", accountType: "Expense", subtype: "professional_fees", normalBalance: "debit" },
] as const;

function requireOption(value: string, allowed: readonly string[], label: string) {
  if (!allowed.includes(value)) throw new Error(`${label} must be one of: ${allowed.join(", ")}.`);
}

function validateJournalLines(lines: Array<{ amountCents: number; side: string }>) {
  validateBalancedJournalLines(lines);
}

function signedAmountFromDebitCredit(debitCents?: number, creditCents?: number) {
  if (typeof debitCents === "number" && debitCents > 0) return -debitCents;
  if (typeof creditCents === "number" && creditCents > 0) return creditCents;
  return 0;
}

/** Refuses a posting dated inside a closed or archived fiscal period (bills post through this too). */
export async function assertPeriodOpen(ctx: any, args: { societyId: string; fiscalPeriodId?: string; date: string; allowClosed?: boolean }) {
  if (args.allowClosed) return null;
  let period: any = null;
  if (args.fiscalPeriodId) {
    period = await getOwned(ctx, "accountingFiscalPeriods", args.fiscalPeriodId, args.societyId);
  } else {
    const periods = await ctx.db
      .query("accountingFiscalPeriods")
      .withIndex("by_society", (q: any) => q.eq("societyId", args.societyId))
      .collect();
    period = periods.find((row: any) => row.startDate <= args.date && row.endDate >= args.date) ?? null;
  }
  if (period && period.status !== "open") {
    throw new Error(`Fiscal period ${period.periodLabel} is ${period.status}; reopen it or post an approved adjustment.`);
  }
  return period;
}

function csvEscape(value: unknown) {
  let text = String(value ?? "");
  // Formula-injection guard: a spreadsheet treats a cell starting with = + - @
  // (or tab/CR) as a formula, so a crafted memo / line description / account
  // name in an exported accounting CSV could execute when the treasurer opens it
  // in Excel/Sheets. Prefix a zero-width non-joiner so it renders as text.
  // Scoped to string cells so numeric columns (amount_cents) stay numeric.
  // Mirrors src/lib/csv.ts sanitizeCsvCell, which shared/ cannot import.
  if (typeof value === "string" && /^[=+\-@\t\r]/.test(text)) {
    text = String.fromCharCode(0x200c) + text;
  }
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function csvRows(rows: unknown[][]) {
  return rows.map((row) => row.map(csvEscape).join(",")).join("\n");
}

async function buildTrialBalance(ctx: any, societyId: string, fiscalYear?: string) {
  const [accounts, entries, allLines] = await Promise.all([
    ctx.db.query("financialAccounts").withIndex("by_society", (q: any) => q.eq("societyId", societyId)).collect(),
    ctx.db.query("journalEntries").withIndex("by_society_status", (q: any) => q.eq("societyId", societyId).eq("status", "posted")).collect(),
    ctx.db.query("journalLines").withIndex("by_society", (q: any) => q.eq("societyId", societyId)).collect(),
  ]);
  const entryIds = new Set(
    entries
      .filter((entry: any) => !fiscalYear || entry.fiscalYear === fiscalYear)
      .map((entry: any) => String(entry._id)),
  );
  const accountById = new Map(accounts.map((account: any) => [String(account._id), account]));
  const totals = new Map<string, { debitCents: number; creditCents: number }>();
  for (const line of allLines) {
    if (!entryIds.has(String(line.journalEntryId))) continue;
    const current = totals.get(String(line.accountId)) ?? { debitCents: 0, creditCents: 0 };
    if (line.side === "debit") current.debitCents += line.amountCents;
    if (line.side === "credit") current.creditCents += line.amountCents;
    totals.set(String(line.accountId), current);
  }
  return Array.from(totals.entries())
    .map(([accountId, total]) => ({
      account: (accountById.get(accountId) as any) ?? null,
      ...total,
      balanceCents: total.debitCents - total.creditCents,
    }))
    .sort((a, b) => String(a.account?.code ?? "").localeCompare(String(b.account?.code ?? "")));
}

async function buildGeneralLedger(ctx: any, societyId: string, fiscalYear?: string, accountId?: string) {
  const [entries, lines, accounts] = await Promise.all([
    ctx.db.query("journalEntries").withIndex("by_society_status", (q: any) => q.eq("societyId", societyId).eq("status", "posted")).collect(),
    accountId
      ? ctx.db.query("journalLines").withIndex("by_account", (q: any) => q.eq("accountId", accountId)).collect()
      : ctx.db.query("journalLines").withIndex("by_society", (q: any) => q.eq("societyId", societyId)).collect(),
    ctx.db.query("financialAccounts").withIndex("by_society", (q: any) => q.eq("societyId", societyId)).collect(),
  ]);
  const entryById = new Map(entries.filter((entry: any) => !fiscalYear || entry.fiscalYear === fiscalYear).map((entry: any) => [String(entry._id), entry]));
  const accountById = new Map(accounts.map((account: any) => [String(account._id), account]));
  return lines
    .filter((line: any) => entryById.has(String(line.journalEntryId)))
    .map((line: any) => {
      const entry: any = entryById.get(String(line.journalEntryId));
      return {
        ...line,
        entry,
        account: (accountById.get(String(line.accountId)) as any) ?? null,
      };
    })
    .sort((a: any, b: any) => `${a.entry.date}:${a.account?.code ?? ""}:${a.lineOrder}`.localeCompare(`${b.entry.date}:${b.account?.code ?? ""}:${b.lineOrder}`));
}

export async function chartAccountsPortable(ctx: PortableQueryCtx, { societyId }: { societyId: string }) {
  await requireSocietyMembership(ctx, societyId);
  const accounts = await ctx.db
    .query("financialAccounts")
    .withIndex("by_society", (q) => q.eq("societyId", societyId))
    .collect();
  return accounts.sort((a, b) => String(a.code ?? "").localeCompare(String(b.code ?? "")) || a.name.localeCompare(b.name));
}

export async function fiscalPeriodsPortable(
  ctx: PortableQueryCtx,
  { societyId, fiscalYear }: { societyId: string; fiscalYear?: string },
) {
  await requireSocietyMembership(ctx, societyId);
  const rows = await ctx.db
    .query("accountingFiscalPeriods")
    .withIndex("by_society_fiscal_year", (q) =>
      fiscalYear ? q.eq("societyId", societyId).eq("fiscalYear", fiscalYear) : q.eq("societyId", societyId),
    )
    .collect();
  return rows.sort((a, b) => a.startDate.localeCompare(b.startDate));
}

export async function counterpartiesPortable(
  ctx: PortableQueryCtx,
  { societyId, kind }: { societyId: string; kind?: string },
) {
  await requireSocietyMembership(ctx, societyId);
  const rows = await (kind
    ? ctx.db
        .query("accountingCounterparties")
        .withIndex("by_society_kind", (q) => q.eq("societyId", societyId).eq("kind", kind))
        .collect()
    : ctx.db
        .query("accountingCounterparties")
        .withIndex("by_society", (q) => q.eq("societyId", societyId))
        .collect());
  return rows.sort((a, b) => a.name.localeCompare(b.name));
}

export async function fundRestrictionsPortable(
  ctx: PortableQueryCtx,
  { societyId, status }: { societyId: string; status?: string },
) {
  await requireSocietyMembership(ctx, societyId);
  const rows = await (status
    ? ctx.db
        .query("fundRestrictions")
        .withIndex("by_society_status", (q) => q.eq("societyId", societyId).eq("status", status))
        .collect()
    : ctx.db
        .query("fundRestrictions")
        .withIndex("by_society", (q) => q.eq("societyId", societyId))
        .collect());
  return rows.sort((a, b) => a.name.localeCompare(b.name));
}

export async function restrictedFundBalancesPortable(
  ctx: PortableQueryCtx,
  { societyId, fiscalYear }: { societyId: string; fiscalYear?: string },
) {
  await requireSocietyMembership(ctx, societyId);
  const [restrictions, entries, lines] = await Promise.all([
    ctx.db.query("fundRestrictions").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect(),
    ctx.db.query("journalEntries").withIndex("by_society_status", (q) => q.eq("societyId", societyId).eq("status", "posted")).collect(),
    ctx.db.query("journalLines").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect(),
  ]);
  const entryIds = new Set(
    entries
      .filter((entry) => !fiscalYear || entry.fiscalYear === fiscalYear)
      .map((entry) => String(entry._id)),
  );
  const totals = new Map<string, { debitCents: number; creditCents: number }>();
  for (const line of lines) {
    if (!line.fundRestrictionId || !entryIds.has(String(line.journalEntryId))) continue;
    const key = String(line.fundRestrictionId);
    const current = totals.get(key) ?? { debitCents: 0, creditCents: 0 };
    if (line.side === "debit") current.debitCents += line.amountCents;
    if (line.side === "credit") current.creditCents += line.amountCents;
    totals.set(key, current);
  }
  return restrictions
    .map((restriction) => {
      const total = totals.get(String(restriction._id)) ?? { debitCents: 0, creditCents: 0 };
      return {
        ...restriction,
        debitCents: total.debitCents,
        creditCents: total.creditCents,
        balanceCents: total.debitCents - total.creditCents,
      };
    })
    .sort((a: any, b: any) => String(a.name).localeCompare(String(b.name)));
}

export async function accountMappingsPortable(
  ctx: PortableQueryCtx,
  { societyId, provider, status }: { societyId: string; provider?: string; status?: string },
) {
  await requireSocietyMembership(ctx, societyId);
  const rows = await (provider
    ? ctx.db
        .query("accountingAccountMappings")
        .withIndex("by_society_provider", (q) => q.eq("societyId", societyId).eq("provider", provider))
        .collect()
    : status
      ? ctx.db
          .query("accountingAccountMappings")
          .withIndex("by_society_status", (q) => q.eq("societyId", societyId).eq("status", status))
          .collect()
      : ctx.db
          .query("accountingAccountMappings")
          .withIndex("by_society", (q) => q.eq("societyId", societyId))
          .collect());
  return rows.sort((a, b) => `${a.provider}:${a.externalAccountName}`.localeCompare(`${b.provider}:${b.externalAccountName}`));
}

export async function journalEntriesPortable(
  ctx: PortableQueryCtx,
  { societyId, status, limit }: { societyId: string; status?: string; limit?: number },
) {
  await requireSocietyMembership(ctx, societyId);
  const entries = await (status
    ? ctx.db
        .query("journalEntries")
        .withIndex("by_society_status", (q) => q.eq("societyId", societyId).eq("status", status))
        .collect()
    : ctx.db
        .query("journalEntries")
        .withIndex("by_society_date", (q) => q.eq("societyId", societyId))
        .order("desc")
        .take(limit ?? 100));
  const sorted = entries.sort((a, b) => b.date.localeCompare(a.date)).slice(0, limit ?? 100);
  const lines = await Promise.all(
    sorted.map((entry) =>
      ctx.db
        .query("journalLines")
        .withIndex("by_entry", (q) => q.eq("journalEntryId", entry._id))
        .collect(),
    ),
  );
  return sorted.map((entry, index) => ({
    ...entry,
    lines: lines[index].sort((a, b) => a.lineOrder - b.lineOrder),
  }));
}

export async function journalEntryPortable(ctx: PortableQueryCtx, { id }: { id: string }) {
  const entry = await requireOwnedRow(ctx, "journalEntries", id);
  const lines = await ctx.db
    .query("journalLines")
    .withIndex("by_entry", (q) => q.eq("journalEntryId", id))
    .collect();
  return { ...entry, lines: lines.sort((a, b) => a.lineOrder - b.lineOrder) };
}

export async function trialBalancePortable(
  ctx: PortableQueryCtx,
  { societyId, fiscalYear }: { societyId: string; fiscalYear?: string },
) {
  await requireSocietyMembership(ctx, societyId);
  return buildTrialBalance(ctx, societyId, fiscalYear);
}

export async function generalLedgerPortable(
  ctx: PortableQueryCtx,
  { societyId, fiscalYear, accountId }: { societyId: string; fiscalYear?: string; accountId?: string },
) {
  await requireSocietyMembership(ctx, societyId);
  if (accountId) await getOwned(ctx, "financialAccounts", accountId, societyId);
  return buildGeneralLedger(ctx, societyId, fiscalYear, accountId);
}

export async function exportCsvPortable(
  ctx: PortableQueryCtx,
  { societyId, kind, fiscalYear }: { societyId: string; kind: string; fiscalYear?: string },
) {
  await requirePermissionPortable(ctx, societyId, "exports:download");
  await requirePermissionPortable(ctx, societyId, "financials:read");
  if (kind === "chart_of_accounts") {
    const accounts = await ctx.db.query("financialAccounts").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect();
    const rows = [["code", "name", "type", "subtype", "currency", "normal_balance", "external_id", "parent_code"]];
    const parentCode = new Map(accounts.map((account) => [String(account._id), account.code ?? account.name]));
    for (const account of accounts.sort((a, b) => String(a.code ?? "").localeCompare(String(b.code ?? "")))) {
      rows.push([account.code ?? "", account.name, account.accountType, account.subtype ?? "", account.currency, account.normalBalance ?? "", account.externalId, account.parentAccountId ? parentCode.get(String(account.parentAccountId)) ?? "" : ""]);
    }
    return { filename: "chart-of-accounts.csv", contentType: "text/csv", csv: csvRows(rows) };
  }
  if (kind === "trial_balance") {
    const rows = [["account_code", "account_name", "debit_cents", "credit_cents", "balance_cents"]];
    const trial = await buildTrialBalance(ctx, societyId, fiscalYear);
    for (const row of trial) rows.push([row.account?.code ?? "", row.account?.name ?? "", row.debitCents, row.creditCents, row.balanceCents]);
    return { filename: "trial-balance.csv", contentType: "text/csv", csv: csvRows(rows) };
  }
  if (kind === "journal_entries" || kind === "general_ledger") {
    const rows = [["entry_date", "entry_number", "reference", "memo", "status", "source", "account_code", "account_name", "side", "amount_cents", "line_description"]];
    const ledger = await buildGeneralLedger(ctx, societyId, fiscalYear);
    for (const line of ledger) {
      rows.push([
        line.entry.date,
        line.entry.entryNumber ?? "",
        line.entry.reference ?? "",
        line.entry.memo,
        line.entry.status,
        line.entry.source,
        line.account?.code ?? "",
        line.account?.name ?? "",
        line.side,
        line.amountCents,
        line.description ?? "",
      ]);
    }
    return { filename: kind === "journal_entries" ? "journal-entries.csv" : "general-ledger.csv", contentType: "text/csv", csv: csvRows(rows) };
  }
  throw new Error("Unsupported accounting CSV export kind.");
}

export async function boardAuditorPackagePortable(
  ctx: PortableQueryCtx,
  { societyId, fiscalYear, packageKind }: { societyId: string; fiscalYear?: string; packageKind?: string },
) {
  await requirePermissionPortable(ctx, societyId, "exports:download");
  await requirePermissionPortable(ctx, societyId, "financials:read");
  const [society, trial, ledger, entries, restrictions, reconciliations] = await Promise.all([
    ctx.db.get(societyId),
    buildTrialBalance(ctx, societyId, fiscalYear),
    buildGeneralLedger(ctx, societyId, fiscalYear),
    ctx.db.query("journalEntries").withIndex("by_society_status", (q) => q.eq("societyId", societyId).eq("status", "posted")).collect(),
    ctx.db.query("fundRestrictions").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect(),
    ctx.db.query("reconciliationRuns").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect(),
  ]);
  if (!society) throw new Error("Society not found.");
  const includedEntries = entries.filter((entry) => !fiscalYear || entry.fiscalYear === fiscalYear);
  const documentIds = new Set<string>();
  for (const entry of includedEntries) for (const id of entry.sourceDocumentIds ?? []) documentIds.add(String(id));
  for (const line of ledger) for (const id of line.documentIds ?? []) documentIds.add(String(id));
  for (const restriction of restrictions) for (const id of restriction.sourceDocumentIds ?? []) documentIds.add(String(id));
  for (const run of reconciliations) for (const id of run.sourceDocumentIds ?? []) documentIds.add(String(id));
  const documents = await Promise.all(Array.from(documentIds).map((id) => getAccessibleDocument(ctx, { id })));
  const attachments = documents
    .filter(Boolean)
    .map((document: any) => ({
      documentId: document._id,
      title: document.title,
      category: document.category,
      fileName: document.fileName,
      storageId: document.storageId ? String(document.storageId) : undefined,
      url: document.url,
    }));
  const trialRows = [["account_code", "account_name", "debit_cents", "credit_cents", "balance_cents"]];
  for (const row of trial) trialRows.push([row.account?.code ?? "", row.account?.name ?? "", row.debitCents, row.creditCents, row.balanceCents]);
  const ledgerRows = [["entry_date", "entry_number", "memo", "account_code", "account_name", "side", "amount_cents", "line_description", "document_ids"]];
  for (const line of ledger) {
    ledgerRows.push([line.entry.date, line.entry.entryNumber ?? "", line.entry.memo, line.account?.code ?? "", line.account?.name ?? "", line.side, line.amountCents, line.description ?? "", (line.documentIds ?? []).join(";")]);
  }
  const reconciliationRows = [["statement_date", "account_id", "statement_balance_cents", "book_balance_cents", "status"]];
  for (const run of reconciliations) {
    reconciliationRows.push([run.statementDate, String(run.financialAccountId), run.statementBalanceCents, run.bookBalanceCents ?? "", run.status]);
  }
  const manifest = {
    packageVersion: 1,
    packageKind: packageKind ?? "board_auditor",
    societyId,
    societyName: society.name,
    fiscalYear: fiscalYear ?? null,
    generatedAtISO: new Date().toISOString(),
    files: ["manifest.json", "trial-balance.csv", "general-ledger.csv", "reconciliations.csv", "attachments.json"],
    attachmentCount: attachments.length,
  };
  return {
    filename: `societyer-${packageKind ?? "board-auditor"}-${fiscalYear ?? "all"}-package.zip`,
    contentType: "application/zip",
    files: [
      { path: "manifest.json", content: JSON.stringify(manifest, null, 2) },
      { path: "trial-balance.csv", content: csvRows(trialRows) },
      { path: "general-ledger.csv", content: csvRows(ledgerRows) },
      { path: "reconciliations.csv", content: csvRows(reconciliationRows) },
      { path: "attachments.json", content: JSON.stringify(attachments, null, 2) },
    ],
    attachments,
  };
}

export async function ensureSocietyerConnectionPortable(
  ctx: PortableMutationCtx,
  { societyId, actingUserId }: { societyId: string; actingUserId?: string },
) {
  await requireRolePortable(ctx, { actingUserId, societyId, required: "Admin" });
  await requireSocietyMembership(ctx, societyId);
  const existing = await ctx.db
    .query("financialConnections")
    .withIndex("by_society", (q) => q.eq("societyId", societyId))
    .collect();
  const match = existing.find((row) => row.provider === SOCIETYER_CONNECTION_PROVIDER);
  if (match) return match._id;
  return await ctx.db.insert("financialConnections", {
    societyId,
    provider: SOCIETYER_CONNECTION_PROVIDER,
    status: "connected",
    accountLabel: "Societyer internal ledger",
    syncMode: "internal",
    connectedAtISO: new Date().toISOString(),
    demo: false,
  });
}

export async function seedSocietyChartOfAccountsPortable(
  ctx: PortableMutationCtx,
  { societyId, actingUserId }: { societyId: string; actingUserId?: string },
) {
  await requireRolePortable(ctx, { actingUserId, societyId, required: "Admin" });
  await requireSocietyMembership(ctx, societyId);
  const existingConnections = await ctx.db
    .query("financialConnections")
    .withIndex("by_society", (q) => q.eq("societyId", societyId))
    .collect();
  const connection =
    existingConnections.find((row) => row.provider === SOCIETYER_CONNECTION_PROVIDER) ??
    (await ctx.db.insert("financialConnections", {
      societyId,
      provider: SOCIETYER_CONNECTION_PROVIDER,
      status: "connected",
      accountLabel: "Societyer internal ledger",
      syncMode: "internal",
      connectedAtISO: new Date().toISOString(),
      demo: false,
    }));
  const connectionId = typeof connection === "string" ? connection : connection._id;
  const existingAccounts = await ctx.db
    .query("financialAccounts")
    .withIndex("by_society", (q) => q.eq("societyId", societyId))
    .collect();
  const existingCodes = new Set(existingAccounts.map((account: any) => account.code).filter(Boolean));
  let inserted = 0;
  for (const account of SOCIETY_COA_TEMPLATE) {
    if (existingCodes.has(account.code)) continue;
    await ctx.db.insert("financialAccounts", {
      societyId,
      connectionId,
      externalId: `societyer:${account.code}`,
      code: account.code,
      name: account.name,
      currency: "CAD",
      accountType: account.accountType,
      subtype: account.subtype,
      balanceCents: 0,
      isRestricted: account.code === "2200" || account.code === "3100",
      restrictedPurpose: account.code === "2200" || account.code === "3100" ? "Restricted fund accounting" : undefined,
      sourceSystem: SOCIETYER_CONNECTION_PROVIDER,
      normalBalance: account.normalBalance,
    });
    inserted += 1;
  }
  return { inserted, skipped: SOCIETY_COA_TEMPLATE.length - inserted };
}

export async function upsertFiscalPeriodPortable(
  ctx: PortableMutationCtx,
  args: {
    id?: string;
    societyId: string;
    fiscalYear: string;
    periodLabel: string;
    startDate: string;
    endDate: string;
    status: string;
    notes?: string;
    actingUserId?: string;
  },
) {
  await requireSocietyMembership(ctx, args.societyId);
  await requireRolePortable(ctx, { actingUserId: args.actingUserId, societyId: args.societyId, required: "Director" });
  if (args.id) await getOwned(ctx, "accountingFiscalPeriods", args.id, args.societyId);
  requireOption(args.status, FISCAL_PERIOD_STATUSES, "Fiscal period status");
  const existingPeriods = await ctx.db
    .query("accountingFiscalPeriods")
    .withIndex("by_society", (q) => q.eq("societyId", args.societyId))
    .collect();
  assertValid(validateFiscalPeriodInput(args, existingPeriods as any, args.id));
  args = { ...args, fiscalYear: args.fiscalYear.trim(), periodLabel: args.periodLabel.trim() };
  const { id, actingUserId, ...payload } = args;
  const now = new Date().toISOString();
  if (id) {
    await ctx.db.patch(id, { ...payload, updatedAtISO: now });
    return id;
  }
  return await ctx.db.insert("accountingFiscalPeriods", { ...payload, createdAtISO: now, updatedAtISO: now });
}

/**
 * Close a fiscal period. With `lockBooks`, the books close date also moves to
 * the period end (never backwards), turning the soft period close, which still
 * accepts approved adjustments, into a hard lock.
 */
export async function closeFiscalPeriodPortable(
  ctx: PortableMutationCtx,
  { id, lockBooks, actingUserId }: { id: string; lockBooks?: boolean; actingUserId?: string },
) {
  const period = await requireOwnedRow(ctx, "accountingFiscalPeriods", id);
  const societyId = String(period.societyId);
  await requireRolePortable(ctx, { actingUserId, societyId, required: "Admin" });
  const now = new Date().toISOString();
  const userId = await principalUserId(ctx, societyId);
  await ctx.db.patch(id, {
    status: "closed",
    closedAtISO: now,
    closedByUserId: userId,
    updatedAtISO: now,
  });
  if (lockBooks) {
    const settings = await booksSettingsRow(ctx, societyId);
    if (!settings?.closeDate || settings.closeDate < period.endDate) {
      const patch = { closeDate: period.endDate, closeDateSetAtISO: now, closeDateSetByUserId: userId ?? undefined, updatedAtISO: now };
      if (settings) await ctx.db.patch(settings._id, patch);
      else await ctx.db.insert("booksSettings", { societyId, ...patch, createdAtISO: now });
    }
  }
  return id;
}

export async function reopenFiscalPeriodPortable(
  ctx: PortableMutationCtx,
  { id, notes, actingUserId }: { id: string; notes?: string; actingUserId?: string },
) {
  const period = await requireOwnedRow(ctx, "accountingFiscalPeriods", id);
  const societyId = String(period.societyId);
  await requireRolePortable(ctx, { actingUserId, societyId, required: "Admin" });
  const closeDate = await booksCloseDate(ctx, societyId);
  if (closeDate && period.startDate <= closeDate) {
    throw new Error(`The books are closed through ${closeDate}, which covers ${period.periodLabel}. Move the close date in Books settings before reopening it.`);
  }
  await ctx.db.patch(id, {
    status: "open",
    closedAtISO: undefined,
    closedByUserId: undefined,
    notes: [period.notes, notes].filter(Boolean).join("\n"),
    updatedAtISO: new Date().toISOString(),
  });
  return id;
}

/**
 * Move an account under another one (a sub-account), or back to the top
 * level when `parentAccountId` is omitted. Rejects cycles, a parent in a
 * different statement section or currency, and nesting deeper than
 * MAX_ACCOUNT_DEPTH (shared/accountHierarchy.ts).
 */
export async function setAccountParentPortable(
  ctx: PortableMutationCtx,
  args: { id: string; parentAccountId?: string; actingUserId?: string },
) {
  const account: any = await ctx.db.get(args.id, "financialAccounts");
  if (!account) throw new Error("Account not found.");
  const societyId = String(account.societyId);
  await requireRolePortable(ctx, { actingUserId: args.actingUserId, societyId, required: "Director" });
  await getOwned(ctx, "financialAccounts", args.id, societyId);
  if (args.parentAccountId) await getOwned(ctx, "financialAccounts", args.parentAccountId, societyId);
  const accounts = await ctx.db
    .query("financialAccounts")
    .withIndex("by_society", (q) => q.eq("societyId", societyId))
    .collect();
  const error = accountParentError(accounts.map((row: any) => ({ ...row, _id: String(row._id), parentAccountId: row.parentAccountId ? String(row.parentAccountId) : null })), String(args.id), args.parentAccountId ? String(args.parentAccountId) : null);
  if (error) throw new Error(error);
  await ctx.db.patch(args.id, { parentAccountId: args.parentAccountId || undefined });
  return args.id;
}

export async function upsertCounterpartyPortable(
  ctx: PortableMutationCtx,
  args: {
    id?: string;
    societyId: string;
    name: string;
    kind: string;
    provider?: string;
    externalId?: string;
    email?: string;
    taxIdentifier?: string;
    notes?: string;
    actingUserId?: string;
  },
) {
  await requireRolePortable(ctx, { actingUserId: args.actingUserId, societyId: args.societyId, required: "Director" });
  if (args.id) await getOwned(ctx, "accountingCounterparties", args.id, args.societyId);
  requireOption(args.kind, COUNTERPARTY_KINDS, "Counterparty kind");
  assertValid(validateCounterpartyInput(args));
  args = { ...args, name: args.name.trim(), email: args.email?.trim() || undefined };
  const { id, actingUserId, ...payload } = args;
  const now = new Date().toISOString();
  if (id) {
    await ctx.db.patch(id, { ...payload, updatedAtISO: now });
    return id;
  }
  return await ctx.db.insert("accountingCounterparties", { ...payload, createdAtISO: now, updatedAtISO: now });
}

export async function upsertFundRestrictionPortable(
  ctx: PortableMutationCtx,
  args: {
    id?: string;
    societyId: string;
    name: string;
    purpose: string;
    status: string;
    linkedGrantId?: string;
    linkedFinancialAccountId?: string;
    startDate?: string;
    endDate?: string;
    sourceDocumentIds?: string[];
    notes?: string;
    actingUserId?: string;
  },
) {
  await requireRolePortable(ctx, { actingUserId: args.actingUserId, societyId: args.societyId, required: "Director" });
  await Promise.all([
    args.id ? getOwned(ctx, "fundRestrictions", args.id, args.societyId) : Promise.resolve(),
    args.linkedGrantId ? getOwned(ctx, "grants", args.linkedGrantId, args.societyId) : Promise.resolve(),
    args.linkedFinancialAccountId
      ? getOwned(ctx, "financialAccounts", args.linkedFinancialAccountId, args.societyId)
      : Promise.resolve(),
    ...(args.sourceDocumentIds ?? []).map((documentId) =>
      getOwned(ctx, "documents", documentId, args.societyId)),
  ]);
  requireOption(args.status, FUND_RESTRICTION_STATUSES, "Fund restriction status");
  const { id, actingUserId, ...payload } = args;
  const now = new Date().toISOString();
  if (id) {
    await ctx.db.patch(id, { ...payload, updatedAtISO: now });
    return id;
  }
  return await ctx.db.insert("fundRestrictions", { ...payload, createdAtISO: now, updatedAtISO: now });
}

export async function upsertAccountMappingPortable(
  ctx: PortableMutationCtx,
  args: {
    id?: string;
    societyId: string;
    provider: string;
    externalAccountId?: string;
    externalAccountCode?: string;
    externalAccountName: string;
    externalCategory?: string;
    financialAccountId: string;
    confidence?: string;
    status: string;
    notes?: string;
    actingUserId?: string;
  },
) {
  await requireRolePortable(ctx, { actingUserId: args.actingUserId, societyId: args.societyId, required: "Director" });
  requireOption(args.status, ACCOUNT_MAPPING_STATUSES, "Account mapping status");
  await getOwned(ctx, "financialAccounts", args.financialAccountId, args.societyId);
  if (args.id) await getOwned(ctx, "accountingAccountMappings", args.id, args.societyId);
  const { id, actingUserId, ...payload } = args;
  const now = new Date().toISOString();
  if (id) {
    await ctx.db.patch(id, { ...payload, updatedAtISO: now });
    return id;
  }
  return await ctx.db.insert("accountingAccountMappings", { ...payload, createdAtISO: now, updatedAtISO: now });
}

export async function upsertJournalEntryPortable(
  ctx: PortableMutationCtx,
  args: {
    id?: string;
    societyId: string;
    connectionId?: string;
    fiscalPeriodId?: string;
    entryNumber?: string;
    reference?: string;
    date: string;
    memo: string;
    source: string;
    sourceExternalId?: string;
    status: string;
    fiscalYear?: string;
    sourceDocumentIds?: string[];
    rawJson?: string;
    /** "both" (default), "accrual-only" or "cash-only"; see shared/booksReports.ts. */
    basis?: string;
    allowClosedPeriodAdjustment?: boolean;
    lines: Array<{
      id?: string;
      accountId: string;
      amountCents: number;
      side: string;
      description?: string;
      programCode?: string;
      counterpartyId?: string;
      grantId?: string;
      fundRestrictionId?: string;
      financialTransactionId?: string;
      transactionCandidateId?: string;
      documentIds?: string[];
      sourceExternalId?: string;
      rawJson?: string;
    }>;
    actingUserId?: string;
  },
) {
  await requireRolePortable(ctx, { actingUserId: args.actingUserId, societyId: args.societyId, required: "Director" });
  await Promise.all([
    args.id ? getOwned(ctx, "journalEntries", args.id, args.societyId) : Promise.resolve(),
    args.connectionId ? getOwned(ctx, "financialConnections", args.connectionId, args.societyId) : Promise.resolve(),
    args.fiscalPeriodId ? getOwned(ctx, "accountingFiscalPeriods", args.fiscalPeriodId, args.societyId) : Promise.resolve(),
    ...(args.sourceDocumentIds ?? []).map((documentId) =>
      getOwned(ctx, "documents", documentId, args.societyId)),
    ...args.lines.flatMap((line) => [
      getOwned(ctx, "financialAccounts", line.accountId, args.societyId),
      line.counterpartyId ? getOwned(ctx, "accountingCounterparties", line.counterpartyId, args.societyId) : Promise.resolve(),
      line.grantId ? getOwned(ctx, "grants", line.grantId, args.societyId) : Promise.resolve(),
      line.fundRestrictionId ? getOwned(ctx, "fundRestrictions", line.fundRestrictionId, args.societyId) : Promise.resolve(),
      line.financialTransactionId ? getOwned(ctx, "financialTransactions", line.financialTransactionId, args.societyId) : Promise.resolve(),
      line.transactionCandidateId ? getOwned(ctx, "transactionCandidates", line.transactionCandidateId, args.societyId) : Promise.resolve(),
      ...(line.documentIds ?? []).map((documentId) =>
        getOwned(ctx, "documents", documentId, args.societyId)),
    ]),
  ]);
  requireOption(args.status, JOURNAL_STATUSES, "Journal entry status");
  if (args.basis !== undefined && !isJournalBasis(args.basis)) throw new Error("Journal entry basis must be one of: both, accrual-only, cash-only.");
  validateJournalLines(args.lines);
  // Editing moves an entry from its old date too, so both dates must be open.
  const existing = args.id ? await ctx.db.get(args.id, "journalEntries") : null;
  await assertBooksOpen(ctx, args.societyId, [args.date, existing?.date], existing ? "posted or edited" : "posted");
  await assertPeriodOpen(ctx, {
    societyId: args.societyId,
    fiscalPeriodId: args.fiscalPeriodId,
    date: args.date,
    allowClosed: args.allowClosedPeriodAdjustment === true,
  });
  const now = new Date().toISOString();
  const { id, lines, actingUserId, allowClosedPeriodAdjustment, ...entry } = args;
  const postedAtISO = entry.status === "posted" ? now : undefined;
  const entryId = id
    ? (await ctx.db.patch(id, { ...entry, postedAtISO, updatedAtISO: now }), id)
    : await ctx.db.insert("journalEntries", {
        ...entry,
        createdByUserId: await principalUserId(ctx, args.societyId),
        postedAtISO,
        createdAtISO: now,
        updatedAtISO: now,
      });

  const existingLines = await ctx.db
    .query("journalLines")
    .withIndex("by_entry", (q) => q.eq("journalEntryId", entryId))
    .collect();
  for (const line of existingLines) await ctx.db.delete(line._id);

  for (const [index, line] of lines.entries()) {
    const { id: _lineId, ...payload } = line;
    await ctx.db.insert("journalLines", {
      societyId: args.societyId,
      journalEntryId: entryId,
      lineOrder: index,
      ...payload,
      createdAtISO: now,
      updatedAtISO: now,
    });
  }
  return entryId;
}

export async function postTransactionCandidatePortable(
  ctx: PortableMutationCtx,
  args: {
    transactionCandidateId: string;
    cashAccountId: string;
    offsetAccountId: string;
    counterpartyId?: string;
    grantId?: string;
    fundRestrictionId?: string;
    fiscalPeriodId?: string;
    fiscalYear?: string;
    memo?: string;
    allowClosedPeriodAdjustment?: boolean;
    actingUserId?: string;
  },
) {
  const candidate = await requireOwnedRow(ctx, "transactionCandidates", args.transactionCandidateId);
  const societyId = String(candidate.societyId);
  await requireRolePortable(ctx, { actingUserId: args.actingUserId, societyId, required: "Director" });
  await Promise.all([
    getOwned(ctx, "financialAccounts", args.cashAccountId, societyId),
    getOwned(ctx, "financialAccounts", args.offsetAccountId, societyId),
    args.counterpartyId ? getOwned(ctx, "accountingCounterparties", args.counterpartyId, societyId) : Promise.resolve(),
    args.grantId ? getOwned(ctx, "grants", args.grantId, societyId) : Promise.resolve(),
    args.fundRestrictionId ? getOwned(ctx, "fundRestrictions", args.fundRestrictionId, societyId) : Promise.resolve(),
    args.fiscalPeriodId ? getOwned(ctx, "accountingFiscalPeriods", args.fiscalPeriodId, societyId) : Promise.resolve(),
    ...(Array.isArray(candidate.sourceDocumentIds) ? candidate.sourceDocumentIds : []).map((documentId: string) =>
      getOwned(ctx, "documents", documentId, societyId)),
  ]);
  if (String(candidate.status).toLowerCase() === "posted") {
    throw new Error("Transaction candidate has already been posted.");
  }
  const linkedLine = await ctx.db
    .query("journalLines")
    .withIndex("by_transaction_candidate", (q) => q.eq("transactionCandidateId", args.transactionCandidateId))
    .first();
  if (linkedLine) {
    throw new Error("Transaction candidate is already linked to a journal entry.");
  }
  const amountCents = candidate.amountCents ?? signedAmountFromDebitCredit(candidate.debitCents, candidate.creditCents);
  if (!amountCents) throw new Error("Transaction candidate needs an amount before it can be posted.");
  await assertBooksOpen(ctx, societyId, [candidate.transactionDate], "posted");
  await assertPeriodOpen(ctx, {
    societyId,
    fiscalPeriodId: args.fiscalPeriodId,
    date: candidate.transactionDate,
    allowClosed: args.allowClosedPeriodAdjustment === true,
  });
  const now = new Date().toISOString();
  const entryId = await ctx.db.insert("journalEntries", {
    societyId: candidate.societyId,
    fiscalPeriodId: args.fiscalPeriodId,
    date: candidate.transactionDate,
    memo: args.memo || candidate.description,
    source: "transactionCandidate",
    sourceExternalId: (candidate.sourceExternalIds ?? [])[0],
    status: "posted",
    fiscalYear: args.fiscalYear ?? candidate.periodLabel,
    createdByUserId: await principalUserId(ctx, societyId),
    postedAtISO: now,
    sourceDocumentIds: candidate.sourceDocumentIds,
    rawJson: JSON.stringify(candidate),
    createdAtISO: now,
    updatedAtISO: now,
  });

  const absoluteCents = Math.abs(amountCents);
  const cashSide = amountCents >= 0 ? "debit" : "credit";
  const offsetSide = amountCents >= 0 ? "credit" : "debit";
  const common = {
    societyId: candidate.societyId,
    journalEntryId: entryId,
    amountCents: absoluteCents,
    counterpartyId: args.counterpartyId,
    grantId: args.grantId,
    fundRestrictionId: args.fundRestrictionId,
    transactionCandidateId: args.transactionCandidateId,
    documentIds: candidate.sourceDocumentIds,
    sourceExternalId: (candidate.sourceExternalIds ?? [])[0],
    createdAtISO: now,
    updatedAtISO: now,
  };
  await ctx.db.insert("journalLines", {
    ...common,
    accountId: args.cashAccountId,
    lineOrder: 0,
    side: cashSide,
    description: candidate.accountName ? `${candidate.accountName}: ${candidate.description}` : candidate.description,
    rawJson: JSON.stringify({ candidateRole: "cash" }),
  });
  await ctx.db.insert("journalLines", {
    ...common,
    accountId: args.offsetAccountId,
    lineOrder: 1,
    side: offsetSide,
    description: candidate.category || candidate.description,
    rawJson: JSON.stringify({ candidateRole: "offset" }),
  });
  await ctx.db.patch(args.transactionCandidateId, {
    status: "Posted",
    notes: [candidate.notes, `Posted to journal entry ${entryId}`].filter(Boolean).join("\n"),
  });
  return entryId;
}

export async function postTransactionCandidateAllocationPortable(
  ctx: PortableMutationCtx,
  args: {
    transactionCandidateId: string;
    cashAccountId: string;
    allocations: Array<{
      accountId: string;
      amountCents: number;
      description?: string;
      programCode?: string;
      counterpartyId?: string;
      grantId?: string;
      fundRestrictionId?: string;
      documentIds?: string[];
    }>;
    fiscalPeriodId?: string;
    fiscalYear?: string;
    memo?: string;
    allowClosedPeriodAdjustment?: boolean;
    actingUserId?: string;
  },
) {
  const candidate = await requireOwnedRow(ctx, "transactionCandidates", args.transactionCandidateId);
  const societyId = String(candidate.societyId);
  await requireRolePortable(ctx, { actingUserId: args.actingUserId, societyId, required: "Director" });
  await Promise.all([
    getOwned(ctx, "financialAccounts", args.cashAccountId, societyId),
    args.fiscalPeriodId ? getOwned(ctx, "accountingFiscalPeriods", args.fiscalPeriodId, societyId) : Promise.resolve(),
    ...(Array.isArray(candidate.sourceDocumentIds) ? candidate.sourceDocumentIds : []).map((documentId: string) =>
      getOwned(ctx, "documents", documentId, societyId)),
    ...args.allocations.flatMap((allocation) => [
      getOwned(ctx, "financialAccounts", allocation.accountId, societyId),
      allocation.counterpartyId ? getOwned(ctx, "accountingCounterparties", allocation.counterpartyId, societyId) : Promise.resolve(),
      allocation.grantId ? getOwned(ctx, "grants", allocation.grantId, societyId) : Promise.resolve(),
      allocation.fundRestrictionId ? getOwned(ctx, "fundRestrictions", allocation.fundRestrictionId, societyId) : Promise.resolve(),
      ...(allocation.documentIds ?? []).map((documentId) =>
        getOwned(ctx, "documents", documentId, societyId)),
    ]),
  ]);
  if (String(candidate.status).toLowerCase() === "posted") {
    throw new Error("Transaction candidate has already been posted.");
  }
  const linkedLine = await ctx.db
    .query("journalLines")
    .withIndex("by_transaction_candidate", (q) => q.eq("transactionCandidateId", args.transactionCandidateId))
    .first();
  if (linkedLine) {
    throw new Error("Transaction candidate is already linked to a journal entry.");
  }
  const amountCents = candidate.amountCents ?? signedAmountFromDebitCredit(candidate.debitCents, candidate.creditCents);
  if (!amountCents) throw new Error("Transaction candidate needs an amount before it can be posted.");
  const absoluteCents = Math.abs(amountCents);
  const allocationTotal = args.allocations.reduce((sum: number, row: any) => sum + row.amountCents, 0);
  if (allocationTotal !== absoluteCents) throw new Error("Allocation total must equal the candidate amount.");
  await assertBooksOpen(ctx, societyId, [candidate.transactionDate], "posted");
  await assertPeriodOpen(ctx, {
    societyId,
    fiscalPeriodId: args.fiscalPeriodId,
    date: candidate.transactionDate,
    allowClosed: args.allowClosedPeriodAdjustment === true,
  });
  const now = new Date().toISOString();
  const entryId = await ctx.db.insert("journalEntries", {
    societyId: candidate.societyId,
    fiscalPeriodId: args.fiscalPeriodId,
    date: candidate.transactionDate,
    memo: args.memo || candidate.description,
    source: "transactionCandidate",
    sourceExternalId: (candidate.sourceExternalIds ?? [])[0],
    status: "posted",
    fiscalYear: args.fiscalYear ?? candidate.periodLabel,
    createdByUserId: await principalUserId(ctx, societyId),
    postedAtISO: now,
    sourceDocumentIds: candidate.sourceDocumentIds,
    rawJson: JSON.stringify(candidate),
    createdAtISO: now,
    updatedAtISO: now,
  });
  const cashSide = amountCents >= 0 ? "debit" : "credit";
  const offsetSide = amountCents >= 0 ? "credit" : "debit";
  await ctx.db.insert("journalLines", {
    societyId: candidate.societyId,
    journalEntryId: entryId,
    accountId: args.cashAccountId,
    lineOrder: 0,
    amountCents: absoluteCents,
    side: cashSide,
    description: candidate.accountName ? `${candidate.accountName}: ${candidate.description}` : candidate.description,
    transactionCandidateId: args.transactionCandidateId,
    documentIds: candidate.sourceDocumentIds,
    sourceExternalId: (candidate.sourceExternalIds ?? [])[0],
    rawJson: JSON.stringify({ candidateRole: "cash" }),
    createdAtISO: now,
    updatedAtISO: now,
  });
  for (const [index, allocation] of args.allocations.entries()) {
    await ctx.db.insert("journalLines", {
      societyId: candidate.societyId,
      journalEntryId: entryId,
      accountId: allocation.accountId,
      lineOrder: index + 1,
      amountCents: allocation.amountCents,
      side: offsetSide,
      description: allocation.description ?? candidate.category ?? candidate.description,
      programCode: allocation.programCode?.trim() || undefined,
      counterpartyId: allocation.counterpartyId,
      grantId: allocation.grantId,
      fundRestrictionId: allocation.fundRestrictionId,
      transactionCandidateId: args.transactionCandidateId,
      documentIds: allocation.documentIds ?? candidate.sourceDocumentIds,
      sourceExternalId: (candidate.sourceExternalIds ?? [])[0],
      rawJson: JSON.stringify({ candidateRole: "allocation", allocationIndex: index }),
      createdAtISO: now,
      updatedAtISO: now,
    });
  }
  await ctx.db.patch(args.transactionCandidateId, {
    status: "Posted",
    notes: [candidate.notes, `Posted to allocated journal entry ${entryId}`].filter(Boolean).join("\n"),
  });
  return entryId;
}

/** Journal entries a bank transaction posts (backfill, and re-posting after an edit). */
export const TRANSACTION_BACKFILL_SOURCE = "financialTransactionBackfill";

type BackfillOptions = {
  categoryChoices?: Array<{ category: string; accountId: string }>;
  includeBeforeOpening?: boolean;
  useSuspense?: boolean;
  transactionIds?: string[];
};

async function loadBackfillPlan(ctx: PortableQueryCtx, societyId: string, options: BackfillOptions) {
  const [transactions, allLines, accounts, mappings, openingEntries, voidEntries] = await Promise.all([
    ctx.db.query("financialTransactions").withIndex("by_society_date", (q) => q.eq("societyId", societyId)).collect(),
    ctx.db.query("journalLines").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect(),
    ctx.db.query("financialAccounts").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect(),
    ctx.db.query("accountingAccountMappings").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect(),
    ctx.db.query("journalEntries").withIndex("by_society_source", (q) => q.eq("societyId", societyId).eq("source", "opening_balance")).collect(),
    ctx.db.query("journalEntries").withIndex("by_society_status", (q) => q.eq("societyId", societyId).eq("status", "void")).collect(),
  ]);
  // Lines of a voided entry no longer count as posting their transaction.
  const voided = new Set(voidEntries.map((entry: any) => String(entry._id)));
  const existingLines = allLines.filter((line: any) => !voided.has(String(line.journalEntryId)));
  const accountIds = new Set(accounts.map((account: any) => String(account._id)));
  for (const choice of options.categoryChoices ?? []) {
    if (!accountIds.has(String(choice.accountId))) throw new Error("Record not found.");
  }
  const plan = planTransactionBackfill({
    transactions: transactions as any,
    accounts: accounts as any,
    mappings: mappings as any,
    postedTransactionIds: existingLines.map((line: any) => String(line.financialTransactionId ?? "")).filter(Boolean),
    openingBalanceDate: openingBalanceDate(openingEntries as any),
    categoryChoices: options.categoryChoices,
    includeBeforeOpening: options.includeBeforeOpening,
    useSuspense: options.useSuspense,
    transactionIds: options.transactionIds,
  });
  return { plan, transactions, accounts };
}

/**
 * Review step for "Backfill imports": what would be posted, to which account,
 * and what is held back (already posted, dated before opening balances, or
 * unmapped). Nothing is written.
 */
export async function backfillPreviewPortable(
  ctx: PortableQueryCtx,
  { societyId, ...options }: { societyId: string } & BackfillOptions,
) {
  await requireSocietyMembership(ctx, societyId);
  const { plan, accounts } = await loadBackfillPlan(ctx, societyId, options);
  const accountsById = new Map(accounts.map((account: any) => [String(account._id), account]));
  const suspenseTemplateLabel = `${SUSPENSE_ACCOUNT_TEMPLATE.code} ${SUSPENSE_ACCOUNT_TEMPLATE.name}`;
  const label = (id?: string) => {
    const account: any = id ? accountsById.get(String(id)) : undefined;
    return account ? `${account.code ? `${account.code} ` : ""}${account.name}` : undefined;
  };
  return {
    ...plan,
    suspenseAccountLabel: label(plan.suspenseAccountId ?? undefined) ?? `${suspenseTemplateLabel} (created on first use)`,
    rows: plan.rows.map((row) => ({
      ...row,
      cashAccountLabel: label(row.cashAccountId),
      offsetAccountLabel: row.offsetSource === "suspense" && !row.offsetAccountId ? suspenseTemplateLabel : label(row.offsetAccountId),
    })),
    categories: plan.categories.map((category) => ({
      ...category,
      offsetAccountLabel: category.offsetSource === "suspense" && !category.offsetAccountId ? suspenseTemplateLabel : label(category.offsetAccountId),
    })),
  };
}

async function ensureSuspenseAccount(ctx: PortableMutationCtx, societyId: string, accounts: any[]): Promise<string> {
  const existing = findSuspenseAccount(accounts as any);
  if (existing) return String(existing._id);
  const connections = await ctx.db
    .query("financialConnections")
    .withIndex("by_society", (q) => q.eq("societyId", societyId))
    .collect();
  const connectionId =
    connections.find((row: any) => row.provider === SOCIETYER_CONNECTION_PROVIDER)?._id ??
    (await ctx.db.insert("financialConnections", {
      societyId,
      provider: SOCIETYER_CONNECTION_PROVIDER,
      status: "connected",
      accountLabel: "Societyer internal ledger",
      syncMode: "internal",
      connectedAtISO: new Date().toISOString(),
      demo: false,
    }));
  const currency = accounts.find((account: any) => account.currency)?.currency ?? "CAD";
  return await ctx.db.insert("financialAccounts", {
    societyId,
    connectionId,
    externalId: `societyer:${SUSPENSE_ACCOUNT_TEMPLATE.code}`,
    code: SUSPENSE_ACCOUNT_TEMPLATE.code,
    name: SUSPENSE_ACCOUNT_TEMPLATE.name,
    currency,
    accountType: SUSPENSE_ACCOUNT_TEMPLATE.accountType,
    subtype: SUSPENSE_ACCOUNT_TEMPLATE.subtype,
    balanceCents: 0,
    isRestricted: false,
    sourceSystem: SOCIETYER_CONNECTION_PROVIDER,
    normalBalance: SUSPENSE_ACCOUNT_TEMPLATE.normalBalance,
  });
}

/**
 * Post imported transactions to the journal after the review step. Defaults
 * are the safe ones: unmapped rows go to the suspense account (never to an
 * arbitrary income/expense account), and transactions dated on or before the
 * opening-balance entry are skipped unless `includeBeforeOpening` is set, in
 * which case each such entry is flagged.
 */
export async function backfillFinancialTransactionsToJournalPortable(
  ctx: PortableMutationCtx,
  { societyId, fiscalYear, limit, actingUserId, rememberMappings, ...options }: {
    societyId: string;
    fiscalYear?: string;
    limit?: number;
    actingUserId?: string;
    /** Save the review step's category choices as active account mappings. */
    rememberMappings?: boolean;
  } & BackfillOptions,
) {
  await requireRolePortable(ctx, { actingUserId, societyId, required: "Admin" });
  const createdByUserId = await principalUserId(ctx, societyId);
  const { plan, transactions, accounts } = await loadBackfillPlan(ctx, societyId, options);
  const transactionsById = new Map(transactions.map((row: any) => [String(row._id), row]));
  // Transactions dated on or before the books close date are never posted.
  const closeDate = await booksCloseDate(ctx, societyId);
  const isLocked = (row: { transactionId: string }) => Boolean(closeDate && closedBooksError(closeDate, [transactionsById.get(row.transactionId)?.date]));
  const ready = plan.rows.filter((row) => row.status === "post");
  const skippedLocked = ready.filter(isLocked).length;
  const toPost = ready.filter((row) => !isLocked(row)).slice(0, limit ?? 200);
  let suspenseAccountId = plan.suspenseAccountId;
  if (!suspenseAccountId && toPost.some((row) => row.offsetSource === "suspense")) {
    suspenseAccountId = await ensureSuspenseAccount(ctx, societyId, accounts);
  }
  const now = new Date().toISOString();
  let posted = 0;
  let postedToSuspense = 0;
  let flaggedBeforeOpening = 0;
  for (const row of toPost) {
    const transaction: any = transactionsById.get(row.transactionId);
    if (!transaction || (row.offsetSource === "suspense" && !suspenseAccountId)) continue;
    const period = await assertPeriodOpen(ctx, { societyId, date: transaction.date });
    const flags = [
      ...(row.beforeOpening ? [BEFORE_OPENING_FLAG] : []),
      ...(row.offsetSource === "suspense" ? [SUSPENSE_FLAG] : []),
    ];
    const entryId = await ctx.db.insert("journalEntries", {
      societyId,
      connectionId: transaction.connectionId,
      fiscalPeriodId: period?._id,
      date: transaction.date,
      memo: row.beforeOpening
        ? `[Before opening balances ${plan.openingBalanceDate}] ${transaction.description}`
        : transaction.description,
      source: TRANSACTION_BACKFILL_SOURCE,
      sourceExternalId: transaction.externalId,
      status: "posted",
      fiscalYear: fiscalYear ?? period?.fiscalYear,
      createdByUserId,
      postedAtISO: now,
      reviewFlags: flags.length ? flags : undefined,
      rawJson: JSON.stringify({ ...transaction, backfillFlags: flags }),
      createdAtISO: now,
      updatedAtISO: now,
    });
    for (const line of journalLinesForPlanRow(transaction, row, suspenseAccountId)) {
      await ctx.db.insert("journalLines", {
        societyId,
        journalEntryId: entryId,
        ...line,
        financialTransactionId: transaction._id,
        createdAtISO: now,
        updatedAtISO: now,
      });
    }
    posted += 1;
    if (row.offsetSource === "suspense") postedToSuspense += 1;
    if (row.beforeOpening) flaggedBeforeOpening += 1;
  }
  let mappingsSaved = 0;
  if (rememberMappings) {
    const existing = await ctx.db.query("accountingAccountMappings").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect();
    for (const choice of options.categoryChoices ?? []) {
      const category = choice.category.trim();
      if (!category || !choice.accountId) continue;
      const duplicate = existing.some((mapping: any) =>
        mapping.status === "active" &&
        normalizeCategory(mapping.externalCategory) === normalizeCategory(category) &&
        String(mapping.financialAccountId) === String(choice.accountId));
      if (duplicate) continue;
      await ctx.db.insert("accountingAccountMappings", {
        societyId,
        provider: "societyer",
        externalAccountName: category,
        externalCategory: category,
        financialAccountId: choice.accountId,
        confidence: "manual",
        status: "active",
        notes: "Saved from the Backfill imports review.",
        createdAtISO: now,
        updatedAtISO: now,
      });
      mappingsSaved += 1;
    }
  }
  return {
    scanned: plan.summary.scanned,
    posted,
    postedToSuspense,
    flaggedBeforeOpening,
    skipped: plan.summary.alreadyPosted,
    skippedBeforeOpening: plan.rows.filter((row) => row.status === "before_opening").length,
    needsMapping: plan.summary.needsMapping + plan.summary.noCashAccount,
    suspenseAccountId,
    openingBalanceDate: plan.openingBalanceDate,
    mappingsSaved,
    skippedLocked,
    closeDate,
  };
}

export async function postOpeningBalancesPortable(
  ctx: PortableMutationCtx,
  args: {
    societyId: string;
    date: string;
    fiscalYear?: string;
    fiscalPeriodId?: string;
    memo?: string;
    sourceDocumentIds?: string[];
    lines: Array<{
      accountId: string;
      amountCents: number;
      side: string;
      description?: string;
      fundRestrictionId?: string;
    }>;
    actingUserId?: string;
  },
) {
  await requireRolePortable(ctx, { actingUserId: args.actingUserId, societyId: args.societyId, required: "Admin" });
  await Promise.all([
    args.fiscalPeriodId
      ? getOwned(ctx, "accountingFiscalPeriods", args.fiscalPeriodId, args.societyId)
      : Promise.resolve(),
    ...(args.sourceDocumentIds ?? []).map((documentId) =>
      getOwned(ctx, "documents", documentId, args.societyId)),
    ...args.lines.flatMap((line) => [
      getOwned(ctx, "financialAccounts", line.accountId, args.societyId),
      line.fundRestrictionId
        ? getOwned(ctx, "fundRestrictions", line.fundRestrictionId, args.societyId)
        : Promise.resolve(),
    ]),
  ]);
  validateJournalLines(args.lines);
  await assertBooksOpen(ctx, args.societyId, [args.date], "posted");
  await assertPeriodOpen(ctx, { societyId: args.societyId, fiscalPeriodId: args.fiscalPeriodId, date: args.date });
  const existing = await ctx.db
    .query("journalEntries")
    .withIndex("by_society_source", (q) => q.eq("societyId", args.societyId).eq("source", "opening_balance"))
    .collect();
  if (existing.some((entry) => entry.status === "posted")) throw new Error("Opening balances have already been posted for this society.");
  const now = new Date().toISOString();
  const entryId = await ctx.db.insert("journalEntries", {
    societyId: args.societyId,
    fiscalPeriodId: args.fiscalPeriodId,
    date: args.date,
    memo: args.memo ?? "Opening balances",
    source: "opening_balance",
    status: "posted",
    fiscalYear: args.fiscalYear,
    createdByUserId: await principalUserId(ctx, args.societyId),
    postedAtISO: now,
    sourceDocumentIds: args.sourceDocumentIds,
    createdAtISO: now,
    updatedAtISO: now,
  });
  for (const [index, line] of args.lines.entries()) {
    await ctx.db.insert("journalLines", {
      societyId: args.societyId,
      journalEntryId: entryId,
      accountId: line.accountId,
      lineOrder: index,
      amountCents: line.amountCents,
      side: line.side,
      description: line.description ?? "Opening balance",
      fundRestrictionId: line.fundRestrictionId,
      documentIds: args.sourceDocumentIds,
      createdAtISO: now,
      updatedAtISO: now,
    });
  }
  return entryId;
}

export async function createReconciliationRunPortable(
  ctx: PortableMutationCtx,
  args: {
    societyId: string;
    financialAccountId: string;
    statementDate: string;
    statementBalanceCents: number;
    sourceDocumentIds?: string[];
    notes?: string;
    actingUserId?: string;
  },
) {
  await requireSocietyMembership(ctx, args.societyId);
  await requireRolePortable(ctx, { actingUserId: args.actingUserId, societyId: args.societyId, required: "Director" });
  await getOwned(ctx, "financialAccounts", args.financialAccountId, args.societyId);
  await Promise.all((args.sourceDocumentIds ?? []).map((documentId) =>
    getOwned(ctx, "documents", documentId, args.societyId)));
  const [entries, lines] = await Promise.all([
    ctx.db.query("journalEntries").withIndex("by_society_status", (q) => q.eq("societyId", args.societyId).eq("status", "posted")).collect(),
    ctx.db.query("journalLines").withIndex("by_account", (q) => q.eq("accountId", args.financialAccountId)).collect(),
  ]);
  const entryById = new Map(entries.filter((entry) => entry.date <= args.statementDate).map((entry) => [String(entry._id), entry]));
  const includedLines = lines.filter((line) => entryById.has(String(line.journalEntryId)));
  const ledgerFingerprint = reconciliationLedgerFingerprint(includedLines, entryById);
  const bookBalanceCents = includedLines.reduce((sum: number, line: any) => sum + (line.side === "debit" ? line.amountCents : -line.amountCents), 0);
  const now = new Date().toISOString();
  const runId = await ctx.db.insert("reconciliationRuns", {
    societyId: args.societyId,
    financialAccountId: args.financialAccountId,
    statementDate: args.statementDate,
    statementBalanceCents: args.statementBalanceCents,
    bookBalanceCents,
    ledgerFingerprint,
    status: bookBalanceCents === args.statementBalanceCents ? "ready" : "draft",
    sourceDocumentIds: args.sourceDocumentIds,
    notes: args.notes,
    createdAtISO: now,
    updatedAtISO: now,
  });
  for (const line of includedLines) {
    await ctx.db.insert("reconciliationRunLines", {
      societyId: args.societyId,
      reconciliationRunId: runId,
      journalLineId: line._id,
      // Bridge to the legacy per-transaction reconciliation system: when the
      // posted journal line originated from a financial transaction, link it
      // so both reconciliation surfaces reference the same source row.
      ...(line.financialTransactionId
        ? { financialTransactionId: line.financialTransactionId }
        : {}),
      status: "included",
      amountCents: line.side === "debit" ? line.amountCents : -line.amountCents,
      createdAtISO: now,
      updatedAtISO: now,
    });
  }
  const differenceCents = args.statementBalanceCents - bookBalanceCents;
  if (differenceCents !== 0) {
    await ctx.db.insert("reconciliationRunLines", {
      societyId: args.societyId,
      reconciliationRunId: runId,
      status: "difference",
      amountCents: differenceCents,
      notes: "Statement balance less posted ledger balance.",
      createdAtISO: now,
      updatedAtISO: now,
    });
  }
  return { runId, bookBalanceCents, differenceCents };
}

export async function setReconciliationRunStatusPortable(
  ctx: PortableMutationCtx,
  { id, status, actingUserId }: { id: string; status: string; actingUserId?: string },
) {
  requireOption(status, RECONCILIATION_STATUSES, "Reconciliation status");
  const run = await requireOwnedRow(ctx, "reconciliationRuns", id);
  const societyId = String(run.societyId);
  await requireRolePortable(ctx, { actingUserId, societyId, required: "Director" });
  if (status === "ready" || status === "reconciled") {
    await getOwned(ctx, "financialAccounts", String(run.financialAccountId), societyId);
    const [entries, lines, captured] = await Promise.all([
      ctx.db.query("journalEntries").withIndex("by_society_status", q => q.eq("societyId", societyId).eq("status", "posted")).collect(),
      ctx.db.query("journalLines").withIndex("by_account", q => q.eq("accountId", run.financialAccountId)).collect(),
      ctx.db.query("reconciliationRunLines").withIndex("by_run", q => q.eq("reconciliationRunId", id)).collect(),
    ]);
    const entryById = new Map(entries.filter(entry => entry.date <= run.statementDate).map(entry => [String(entry._id), entry]));
    const current = lines.filter(line => entryById.has(String(line.journalEntryId)));
    const capturedLines = captured.filter(line => line.journalLineId);
    const sameLines = current.length === capturedLines.length && current.every(line => capturedLines.some(snapshot =>
      String(snapshot.journalLineId) === String(line._id) && snapshot.status === "included" &&
      snapshot.amountCents === (line.side === "debit" ? line.amountCents : -line.amountCents)));
    if (!sameLines || (run.ledgerFingerprint && run.ledgerFingerprint !== reconciliationLedgerFingerprint(current, entryById))) {
      throw new Error("The posted ledger has changed. Create a new reconciliation from current evidence.");
    }
    const balance = current.reduce((sum: number, line: any) => sum + (line.side === "debit" ? line.amountCents : -line.amountCents), 0);
    if (!Number.isSafeInteger(balance) || !Number.isSafeInteger(run.statementBalanceCents) ||
        balance !== run.bookBalanceCents || balance !== run.statementBalanceCents ||
        captured.some(line => line.status === "difference" && line.amountCents !== 0)) {
      throw new Error("Unresolved statement/book difference blocks reconciliation. Record evidenced outstanding items before closing.");
    }
  }
  await ctx.db.patch(id, {
    status,
    reconciledAtISO: status === "reconciled" ? new Date().toISOString() : run.reconciledAtISO,
    reconciledByUserId: status === "reconciled"
      ? await principalUserId(ctx, societyId)
      : run.reconciledByUserId,
    updatedAtISO: new Date().toISOString(),
  });
  return id;
}

function reconciliationLedgerFingerprint(lines: any[], entries: Map<string, any>): string {
  return JSON.stringify(lines.map(line => {
    const entry = entries.get(String(line.journalEntryId));
    return [String(line._id), String(line.journalEntryId), line.side, line.amountCents,
      line.currency, line.programCode, entry?.date, entry?.updatedAtISO];
  }).sort((a, b) => String(a[0]).localeCompare(String(b[0]))));
}

// ---------------------------------------------------------------------------
// One bank transaction's journal entry: the preview the transaction panel
// shows, and keeping a posted entry in step with later edits.

type JournalPlanContext = { accounts: BackfillAccount[]; mappings: BackfillMapping[] };

async function loadJournalPlanContext(ctx: PortableQueryCtx, societyId: string): Promise<JournalPlanContext> {
  const [accounts, mappings] = await Promise.all([
    ctx.db.query("financialAccounts").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect(),
    ctx.db.query("accountingAccountMappings").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect(),
  ]);
  return {
    accounts: accounts.map((row) => ({ _id: String(row._id), code: row.code, name: String(row.name ?? ""), accountType: String(row.accountType ?? ""), subtype: row.subtype })),
    mappings: mappings.map((row) => ({
      _id: String(row._id),
      status: String(row.status ?? ""),
      externalAccountId: row.externalAccountId,
      externalAccountCode: row.externalAccountCode,
      externalAccountName: row.externalAccountName,
      externalCategory: row.externalCategory,
      financialAccountId: String(row.financialAccountId),
    })),
  };
}

/** The fields of a stored transaction the posting planner reads. */
export function backfillTransactionOf(row: PortableDoc): BackfillTransaction & { externalId?: string } {
  return {
    _id: String(row._id),
    date: String(row.date ?? ""),
    description: row.description,
    amountCents: Number(row.amountCents) || 0,
    accountId: String(row.accountId ?? ""),
    category: row.category,
    categoryAccountExternalId: row.categoryAccountExternalId,
    accountingAccountId: row.accountingAccountId ? String(row.accountingAccountId) : undefined,
    fundRestrictionId: row.fundRestrictionId ? String(row.fundRestrictionId) : undefined,
    tagIds: Array.isArray(row.tagIds) ? row.tagIds.map(String) : undefined,
    lines: Array.isArray(row.lines) ? row.lines : undefined,
    externalId: row.externalId,
  };
}

/** The plan row for one transaction as if it were posted now (review choices aside). */
function planOneTransaction(context: JournalPlanContext, transaction: BackfillTransaction): { row: BackfillPlanRow; suspenseAccountId: string | null } {
  const plan = planTransactionBackfill({
    transactions: [transaction],
    accounts: context.accounts,
    mappings: context.mappings,
    postedTransactionIds: [],
    openingBalanceDate: null,
    includeBeforeOpening: true,
  });
  return { row: plan.rows[0], suspenseAccountId: plan.suspenseAccountId };
}

/** The live (not void) entries that posted this transaction, and their lines. */
export async function postedJournalForTransaction(ctx: PortableQueryCtx, transactionId: string) {
  const lines = await ctx.db
    .query("journalLines")
    .withIndex("by_financial_transaction", (q) => q.eq("financialTransactionId", transactionId))
    .collect();
  const entryIds = [...new Set(lines.map((line) => String(line.journalEntryId)))];
  const found = await Promise.all(entryIds.map((id) => ctx.db.get(id, "journalEntries")));
  const entries = found.filter((entry): entry is PortableDoc => Boolean(entry) && entry?.status !== "void");
  const live = new Set(entries.map((entry) => String(entry._id)));
  return { entries, lines: lines.filter((line) => live.has(String(line.journalEntryId))) };
}

/** Suspense account stand-in for a preview made before the account exists. */
export const PENDING_SUSPENSE_ACCOUNT = "__suspense__";

/**
 * What posting this transaction would write (the bank line plus one line
 * per line item). Suspense lines name `PENDING_SUSPENSE_ACCOUNT` until the
 * suspense account exists.
 */
export async function previewTransactionJournal(ctx: PortableQueryCtx, transaction: PortableDoc) {
  const context = await loadJournalPlanContext(ctx, String(transaction.societyId));
  const planned = backfillTransactionOf(transaction);
  const { row, suspenseAccountId } = planOneTransaction(context, planned);
  if (row.status !== "post") return { status: row.status, lines: [] as TransactionJournalLine[] };
  return { status: row.status, lines: journalLinesForPlanRow(planned, row, suspenseAccountId ?? PENDING_SUSPENSE_ACCOUNT) };
}

export type TransactionJournalSyncResult = "unposted" | "external" | "unchanged" | "updated" | "reposted" | "locked";

/**
 * Keeps a posted bank transaction's journal entry in step with its current
 * category, line items, fund and tags. Idempotent, and never posts twice: a
 * transaction nobody posted stays unposted (Backfill imports posts it), an
 * entry written elsewhere (a sync, a manual journal) is left alone, and the
 * transaction's own entry has its lines replaced in place. Changes to
 * accounts, amounts, funds or the date need the fiscal period to be open;
 * tags and descriptions are updated in place either way. With
 * `onLocked: "skip"` a closed period leaves the entry as it is instead of
 * failing (rule runs and bulk edits).
 */
export function createTransactionJournalSync(ctx: PortableMutationCtx, societyId: string) {
  let context: JournalPlanContext | null = null;
  return async (transactionId: string, options: { onLocked?: "throw" | "skip" } = {}): Promise<TransactionJournalSyncResult> => {
    const { entries, lines } = await postedJournalForTransaction(ctx, transactionId);
    if (entries.length === 0) return "unposted";
    const entry = entries.find((row) => row.source === TRANSACTION_BACKFILL_SOURCE && row.status === "posted");
    if (!entry) return "external";
    const stored = await ctx.db.get(transactionId, "financialTransactions");
    if (!stored || String(stored.societyId) !== String(societyId)) return "unchanged";
    const transaction = backfillTransactionOf(stored);
    context ??= await loadJournalPlanContext(ctx, societyId);
    let { row, suspenseAccountId } = planOneTransaction(context, transaction);
    if (row.status !== "post") return "unchanged";
    if (!suspenseAccountId && row.lines.some((line) => line.offsetSource === "suspense")) {
      await ensureSuspenseAccount(ctx, societyId, context.accounts);
      context = await loadJournalPlanContext(ctx, societyId);
      ({ row, suspenseAccountId } = planOneTransaction(context, transaction));
    }
    const desired = journalLinesForPlanRow(transaction, row, suspenseAccountId);
    const current = lines
      .filter((line) => String(line.journalEntryId) === String(entry._id))
      .sort((a, b) => Number(a.lineOrder) - Number(b.lineOrder));
    const sameShape =
      entry.date === transaction.date &&
      current.length === desired.length &&
      desired.every((line, index) =>
        String(current[index].accountId) === line.accountId &&
        current[index].amountCents === line.amountCents &&
        current[index].side === line.side &&
        String(current[index].fundRestrictionId ?? "") === String(line.fundRestrictionId ?? ""));
    const now = new Date().toISOString();
    if (sameShape) {
      let changed = false;
      for (const [index, line] of desired.entries()) {
        const existing = current[index];
        const tagsBefore = JSON.stringify((Array.isArray(existing.tagIds) ? existing.tagIds : []).map(String).sort());
        const tagsAfter = JSON.stringify([...(line.tagIds ?? [])].sort());
        if (existing.description === line.description && tagsBefore === tagsAfter) continue;
        await ctx.db.patch(existing._id, { description: line.description, tagIds: line.tagIds, updatedAtISO: now });
        changed = true;
      }
      return changed ? "updated" : "unchanged";
    }
    let period: PortableDoc | null = null;
    try {
      await assertPeriodOpen(ctx, { societyId, date: String(entry.date) });
      period = await assertPeriodOpen(ctx, { societyId, date: transaction.date });
    } catch (error) {
      if (options.onLocked === "skip") return "locked";
      throw error;
    }
    for (const line of current) await ctx.db.delete(line._id);
    for (const line of desired) {
      await ctx.db.insert("journalLines", {
        societyId,
        journalEntryId: entry._id,
        ...line,
        financialTransactionId: transactionId,
        createdAtISO: now,
        updatedAtISO: now,
      });
    }
    const keptFlags = (Array.isArray(entry.reviewFlags) ? entry.reviewFlags.map(String) : []).filter((flag) => flag !== SUSPENSE_FLAG);
    const flags = [...keptFlags, ...(row.lines.some((line) => line.offsetSource === "suspense") ? [SUSPENSE_FLAG] : [])];
    await ctx.db.patch(entry._id, {
      date: transaction.date,
      ...(period?._id ? { fiscalPeriodId: period._id } : {}),
      reviewFlags: flags.length ? flags : undefined,
      updatedAtISO: now,
    });
    return "reposted";
  };
}

/* ------------------------------------------------------------------------
 * Books: multi-period reports, the general ledger and journal registers, the
 * chart-of-accounts register and editor, voiding, and Books settings (start
 * date, accounting basis, close date). The computation lives in
 * shared/booksReports.ts; these handlers load the society's books and gate
 * access.
 * --------------------------------------------------------------------- */

type ReportFilterArg = { fund?: string; dimensions?: Array<{ kind: string; values: string[] }> };

async function loadBooks(ctx: PortableQueryCtx, societyId: string) {
  const [accounts, entries, lines] = await Promise.all([
    ctx.db.query("financialAccounts").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect(),
    ctx.db.query("journalEntries").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect(),
    ctx.db.query("journalLines").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect(),
  ]);
  return { accounts: accounts as BooksAccount[], entries: entries as BooksEntry[], lines: lines as BooksLine[] };
}

function requireBasis(value: string | undefined, fallback: AccountingBasis): AccountingBasis {
  if (value === undefined) return fallback;
  if (!(ACCOUNTING_BASES as readonly string[]).includes(value)) throw new Error("Accounting basis must be cash or accrual.");
  return value as AccountingBasis;
}

function requireDate(value: string | undefined | null, label: string) {
  if (value == null || value === "") return undefined;
  if (!isIsoDate(value)) throw new Error(`${label} must be a valid date (YYYY-MM-DD).`);
  return value;
}

function lineFilter(filter: ReportFilterArg | undefined): ReportLineFilter | undefined {
  if (!filter) return undefined;
  validateLineFilter(filter);
  return filter;
}

/** Books settings with defaults, plus the facts the settings page explains (fiscal year, last closed period). */
export async function booksSettingsPortable(ctx: PortableQueryCtx, { societyId }: { societyId: string }) {
  await requireSocietyMembership(ctx, societyId);
  const [settings, society, periods, entries] = await Promise.all([
    booksSettingsRow(ctx, societyId),
    ctx.db.get(societyId),
    ctx.db.query("accountingFiscalPeriods").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect(),
    ctx.db.query("journalEntries").withIndex("by_society_status", (q) => q.eq("societyId", societyId).eq("status", "posted")).collect(),
  ]);
  const setBy = settings?.closeDateSetByUserId ? await ctx.db.get(settings.closeDateSetByUserId, "users") : null;
  const closedPeriods = periods.filter((period) => period.status === "closed").sort((a, b) => String(b.endDate).localeCompare(String(a.endDate)));
  const firstEntryDate = entries.reduce<string | null>((min, entry) => (min == null || entry.date < min ? entry.date : min), null);
  const fiscalYearEnd = typeof society?.fiscalYearEnd === "string" ? society.fiscalYearEnd : null;
  return {
    _id: settings?._id ?? null,
    configured: Boolean(settings),
    booksStartDate: settings?.booksStartDate ?? null,
    accountingBasis: settings?.accountingBasis === "cash" ? "cash" : "accrual",
    closeDate: settings?.closeDate ?? null,
    closeDateSetAtISO: settings?.closeDateSetAtISO ?? null,
    closeDateSetByName: setBy ? String(setBy.displayName ?? setBy.email ?? "") || null : null,
    fiscalYearEnd,
    fiscalStartMonth: fiscalYearStartMonth(fiscalYearEnd),
    firstEntryDate,
    lastClosedPeriod: closedPeriods[0] ? { _id: closedPeriods[0]._id, periodLabel: closedPeriods[0].periodLabel, startDate: closedPeriods[0].startDate, endDate: closedPeriods[0].endDate } : null,
    closedPeriodCount: closedPeriods.length,
  };
}

/**
 * Save Books settings. Directors set the start date and basis; moving the close
 * date (the hard lock) needs an admin. `null` clears a date.
 */
export async function updateBooksSettingsPortable(
  ctx: PortableMutationCtx,
  args: { societyId: string; booksStartDate?: string | null; accountingBasis?: string; closeDate?: string | null; actingUserId?: string },
) {
  await requireRolePortable(ctx, { actingUserId: args.actingUserId, societyId: args.societyId, required: "Director" });
  const settings = await booksSettingsRow(ctx, args.societyId);
  const now = new Date().toISOString();
  const patch: Record<string, string | undefined> = { updatedAtISO: now };
  if (args.booksStartDate !== undefined) patch.booksStartDate = requireDate(args.booksStartDate, "Books start date");
  if (args.accountingBasis !== undefined) patch.accountingBasis = requireBasis(args.accountingBasis, "accrual");
  if (args.closeDate !== undefined && (args.closeDate ?? undefined) !== (settings?.closeDate ?? undefined)) {
    await requireRolePortable(ctx, { actingUserId: args.actingUserId, societyId: args.societyId, required: "Admin" });
    const closeDate = requireDate(args.closeDate, "Close date");
    if (closeDate && closeDate > todayDateOnly()) throw new Error("The close date can't be in the future. Lock the books once a period has ended.");
    patch.closeDate = closeDate;
    patch.closeDateSetAtISO = now;
    patch.closeDateSetByUserId = (await principalUserId(ctx, args.societyId)) ?? undefined;
  }
  if (settings) {
    await ctx.db.patch(settings._id, patch);
    return settings._id;
  }
  return await ctx.db.insert("booksSettings", { societyId: args.societyId, ...patch, createdAtISO: now });
}

/**
 * One multi-period report (balance sheet, statement of operations or cash
 * flow). Basis defaults to Books settings; `filter` narrows lines by fund and
 * by dimensions (programCode now, tag ids once lines carry them).
 */
export async function booksReportPortable(
  ctx: PortableQueryCtx,
  args: { societyId: string; report: string; from: string; to: string; frequency: string; basis?: string; currency?: string; filter?: ReportFilterArg; asOf?: string },
) {
  await requireSocietyMembership(ctx, args.societyId);
  if (!(BOOKS_REPORT_KINDS as readonly string[]).includes(args.report)) throw new Error("Unsupported report.");
  if (!(REPORT_FREQUENCIES as readonly string[]).includes(args.frequency)) throw new Error("Choose monthly, quarterly or yearly columns.");
  const [books, society, defaultBasis] = await Promise.all([loadBooks(ctx, args.societyId), ctx.db.get(args.societyId), booksAccountingBasis(ctx, args.societyId)]);
  const periods = buildReportPeriods({
    from: args.from,
    to: args.to,
    frequency: args.frequency as ReportFrequency,
    today: requireDate(args.asOf, "Report date") ?? todayDateOnly(),
    fiscalStartMonth: fiscalYearStartMonth(typeof society?.fiscalYearEnd === "string" ? society.fiscalYearEnd : null),
  });
  return buildBooksReport(args.report as BooksReportKind, {
    ...books,
    periods,
    basis: requireBasis(args.basis, defaultBasis),
    currency: args.currency,
    filter: lineFilter(args.filter),
  });
}

/** The journal lines behind one report amount, on the report's basis and filter. */
export async function booksReportLinesPortable(
  ctx: PortableQueryCtx,
  args: { societyId: string; accountIds: string[]; scope: string; from?: string; to: string; basis?: string; currency?: string; filter?: ReportFilterArg },
) {
  await requireSocietyMembership(ctx, args.societyId);
  if (!["balance", "period", "cash"].includes(args.scope)) throw new Error("Unsupported drilldown.");
  const [books, defaultBasis] = await Promise.all([loadBooks(ctx, args.societyId), booksAccountingBasis(ctx, args.societyId)]);
  const owned = new Set(books.accounts.map((account) => String(account._id)));
  if (args.accountIds.some((id) => !owned.has(String(id)))) throw new Error("Record not found.");
  return reportDrillLines({
    ...books,
    basis: requireBasis(args.basis, defaultBasis),
    currency: args.currency,
    filter: lineFilter(args.filter),
    accountIds: args.accountIds,
    scope: args.scope as "balance" | "period" | "cash",
    start: requireDate(args.from, "From date") ?? null,
    end: requireDate(args.to, "To date") as string,
  });
}

/**
 * General ledger for a date range with contra accounts and counterparties;
 * filtered to one account it adds the opening balance and a running balance.
 */
export async function generalLedgerReportPortable(
  ctx: PortableQueryCtx,
  args: { societyId: string; from: string; to: string; accountId?: string; basis?: string; currency?: string; filter?: ReportFilterArg; limit?: number },
) {
  await requireSocietyMembership(ctx, args.societyId);
  if (args.accountId) await getOwned(ctx, "financialAccounts", args.accountId, args.societyId);
  const [books, defaultBasis, counterparties, transactions] = await Promise.all([
    loadBooks(ctx, args.societyId),
    booksAccountingBasis(ctx, args.societyId),
    ctx.db.query("accountingCounterparties").withIndex("by_society", (q) => q.eq("societyId", args.societyId)).collect(),
    ctx.db.query("financialTransactions").withIndex("by_society_date", (q) => q.eq("societyId", args.societyId)).collect(),
  ]);
  return buildGeneralLedgerReport({
    ...books,
    basis: requireBasis(args.basis, defaultBasis),
    currency: args.currency ?? defaultReportCurrency(books.accounts, books.lines),
    filter: lineFilter(args.filter),
    from: args.from,
    to: args.to,
    accountId: args.accountId,
    counterpartyNames: new Map(counterparties.map((row) => [String(row._id), String(row.name)])),
    transactionCounterparties: new Map(transactions.filter((row) => row.counterparty).map((row) => [String(row._id), String(row.counterparty)])),
    limit: args.limit,
  });
}

/** Every journal entry with its debit and credit accounts and total, newest first. */
export async function journalEntryRegisterPortable(ctx: PortableQueryCtx, { societyId }: { societyId: string }) {
  await requireSocietyMembership(ctx, societyId);
  const [books, closeDate] = await Promise.all([loadBooks(ctx, societyId), booksCloseDate(ctx, societyId)]);
  return { closeDate, rows: buildJournalRegister({ ...books, closeDate }) };
}

/** The chart of accounts with normal balance, opening balance and posted balance per account. */
export async function chartOfAccountsRegisterPortable(ctx: PortableQueryCtx, { societyId }: { societyId: string }) {
  await requireSocietyMembership(ctx, societyId);
  const books = await loadBooks(ctx, societyId);
  return buildChartRegister(books).sort((a, b) => String(a.code ?? "").localeCompare(String(b.code ?? "")) || a.name.localeCompare(b.name));
}

const CHART_ACCOUNT_TYPES = ["Asset", "Bank", "Liability", "Credit", "Equity", "Income", "Expense"] as const;

/**
 * Add or edit a chart account. Codes are unique per society. An account with
 * posted lines keeps its statement section (moving it would silently move
 * those amounts); reclassify with a journal entry instead.
 */
export async function upsertChartAccountPortable(
  ctx: PortableMutationCtx,
  args: {
    id?: string;
    societyId: string;
    code?: string;
    name: string;
    accountType: string;
    subtype?: string;
    normalBalance?: string;
    currency?: string;
    parentAccountId?: string;
    actingUserId?: string;
  },
) {
  await requireRolePortable(ctx, { actingUserId: args.actingUserId, societyId: args.societyId, required: "Director" });
  const existing = args.id ? await getOwned(ctx, "financialAccounts", args.id, args.societyId) : null;
  if (args.parentAccountId) await getOwned(ctx, "financialAccounts", args.parentAccountId, args.societyId);
  requireOption(args.accountType, CHART_ACCOUNT_TYPES, "Account type");
  if (args.normalBalance) requireOption(args.normalBalance, NORMAL_BALANCES, "Normal balance");
  const name = args.name.trim();
  const code = args.code?.trim() || undefined;
  if (!name) throw new Error("Give the account a name.");
  if (code && !/^[A-Za-z0-9.\-]{1,12}$/.test(code)) throw new Error("Use up to 12 letters, digits, dots or dashes for the code.");
  const accounts = await ctx.db.query("financialAccounts").withIndex("by_society", (q) => q.eq("societyId", args.societyId)).collect();
  if (code && accounts.some((account) => account.code === code && String(account._id) !== String(args.id ?? ""))) {
    throw new Error(`Account code ${code} is already used.`);
  }
  const currency = args.currency?.trim().toUpperCase() || existing?.currency || accounts.find((account) => account.currency)?.currency || "CAD";
  if (existing && accountSection(existing.accountType) !== accountSection(args.accountType)) {
    const posted = await ctx.db.query("journalLines").withIndex("by_account", (q) => q.eq("accountId", args.id)).first();
    if (posted) throw new Error("This account has journal lines, so it stays in its statement section. Create a new account and move the balance with a journal entry.");
  }
  if (existing && existing.currency !== currency) {
    const posted = await ctx.db.query("journalLines").withIndex("by_account", (q) => q.eq("accountId", args.id)).first();
    if (posted) throw new Error("This account has journal lines, so its currency can't change.");
  }
  const normalBalance = args.normalBalance ?? (["Liability", "Credit", "Equity", "Income"].includes(args.accountType) ? "credit" : "debit");
  const candidate = { _id: String(args.id ?? "__new"), code, name, accountType: args.accountType, currency, parentAccountId: args.parentAccountId ?? null };
  const chart: HierarchyAccount[] = [
    ...accounts
      .filter((account) => String(account._id) !== String(args.id ?? ""))
      .map((account) => ({ _id: String(account._id), code: account.code, name: String(account.name), accountType: String(account.accountType), currency: account.currency, parentAccountId: account.parentAccountId ? String(account.parentAccountId) : null })),
    candidate,
  ];
  const parentError = args.parentAccountId ? accountParentError(chart, candidate._id, String(args.parentAccountId)) : null;
  if (parentError) throw new Error(parentError);
  const fields = {
    code,
    name,
    accountType: args.accountType,
    subtype: args.subtype?.trim() || undefined,
    normalBalance,
    currency,
    parentAccountId: args.parentAccountId || undefined,
  };
  if (existing) {
    await ctx.db.patch(String(existing._id), fields);
    return String(existing._id);
  }
  const connections = await ctx.db.query("financialConnections").withIndex("by_society", (q) => q.eq("societyId", args.societyId)).collect();
  const connectionId =
    connections.find((row) => row.provider === SOCIETYER_CONNECTION_PROVIDER)?._id ??
    (await ctx.db.insert("financialConnections", {
      societyId: args.societyId,
      provider: SOCIETYER_CONNECTION_PROVIDER,
      status: "connected",
      accountLabel: "Societyer internal ledger",
      syncMode: "internal",
      connectedAtISO: new Date().toISOString(),
      demo: false,
    }));
  return await ctx.db.insert("financialAccounts", {
    societyId: args.societyId,
    connectionId,
    externalId: `societyer:${code ?? `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${Date.now().toString(36)}`}`,
    ...fields,
    balanceCents: 0,
    isRestricted: false,
    sourceSystem: SOCIETYER_CONNECTION_PROVIDER,
  });
}

/**
 * Void a journal entry: it stays on record with its lines but leaves every
 * report. Entries posted from bank transactions, claims or other sources are
 * voided where they came from, and nothing dated on or before the close date
 * can be voided.
 */
export async function voidJournalEntryPortable(
  ctx: PortableMutationCtx,
  { id, reason, actingUserId }: { id: string; reason?: string; actingUserId?: string },
) {
  const entry = await requireOwnedRow(ctx, "journalEntries", id);
  const societyId = String(entry.societyId);
  await requireRolePortable(ctx, { actingUserId, societyId, required: "Director" });
  if (entry.status === "void") return id;
  if (!["manual", "adjustment"].includes(String(entry.source))) {
    throw new Error("Only manual journal entries can be voided here. Undo an imported or posted-from-source entry where it came from.");
  }
  await assertBooksOpen(ctx, societyId, [entry.date], "voided");
  const now = new Date().toISOString();
  await ctx.db.patch(id, {
    status: "void",
    voidedAtISO: now,
    memo: reason?.trim() ? `${entry.memo} (void: ${reason.trim()})` : entry.memo,
    updatedAtISO: now,
  });
  return id;
}
