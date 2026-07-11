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

import type { PortableMutationCtx, PortableQueryCtx } from "../portable/ctx";
import { requireRolePortable } from "./access";
import { transactionBackfillSides, validateBalancedJournalLines } from "../accountingCore";

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

async function assertPeriodOpen(ctx: any, args: { societyId: string; fiscalPeriodId?: string; date: string; allowClosed?: boolean }) {
  if (args.allowClosed) return null;
  let period: any = null;
  if (args.fiscalPeriodId) {
    period = await ctx.db.get(args.fiscalPeriodId as any);
    if (!period || period.societyId !== args.societyId) throw new Error("Fiscal period does not belong to this society.");
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
  const entry = await ctx.db.get(id);
  if (!entry) return null;
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
  return buildTrialBalance(ctx, societyId, fiscalYear);
}

export async function generalLedgerPortable(
  ctx: PortableQueryCtx,
  { societyId, fiscalYear, accountId }: { societyId: string; fiscalYear?: string; accountId?: string },
) {
  return buildGeneralLedger(ctx, societyId, fiscalYear, accountId);
}

export async function exportCsvPortable(
  ctx: PortableQueryCtx,
  { societyId, kind, fiscalYear }: { societyId: string; kind: string; fiscalYear?: string },
) {
  if (kind === "chart_of_accounts") {
    const accounts = await ctx.db.query("financialAccounts").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect();
    const rows = [["code", "name", "type", "subtype", "currency", "normal_balance", "external_id"]];
    for (const account of accounts.sort((a, b) => String(a.code ?? "").localeCompare(String(b.code ?? "")))) {
      rows.push([account.code ?? "", account.name, account.accountType, account.subtype ?? "", account.currency, account.normalBalance ?? "", account.externalId]);
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
  const documents = await Promise.all(Array.from(documentIds).map((id) => ctx.db.get(id as any)));
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
  await requireRolePortable(ctx, { actingUserId: args.actingUserId, societyId: args.societyId, required: "Director" });
  requireOption(args.status, FISCAL_PERIOD_STATUSES, "Fiscal period status");
  const { id, actingUserId, ...payload } = args;
  const now = new Date().toISOString();
  if (id) {
    await ctx.db.patch(id, { ...payload, updatedAtISO: now });
    return id;
  }
  return await ctx.db.insert("accountingFiscalPeriods", { ...payload, createdAtISO: now, updatedAtISO: now });
}

export async function closeFiscalPeriodPortable(
  ctx: PortableMutationCtx,
  { id, actingUserId }: { id: string; actingUserId?: string },
) {
  const period = await ctx.db.get(id);
  if (!period) throw new Error("Fiscal period not found.");
  await requireRolePortable(ctx, { actingUserId, societyId: String(period.societyId), required: "Admin" });
  await ctx.db.patch(id, {
    status: "closed",
    closedAtISO: new Date().toISOString(),
    closedByUserId: actingUserId,
    updatedAtISO: new Date().toISOString(),
  });
  return id;
}

export async function reopenFiscalPeriodPortable(
  ctx: PortableMutationCtx,
  { id, notes, actingUserId }: { id: string; notes?: string; actingUserId?: string },
) {
  const period = await ctx.db.get(id);
  if (!period) throw new Error("Fiscal period not found.");
  await requireRolePortable(ctx, { actingUserId, societyId: String(period.societyId), required: "Admin" });
  await ctx.db.patch(id, {
    status: "open",
    closedAtISO: undefined,
    closedByUserId: undefined,
    notes: [period.notes, notes].filter(Boolean).join("\n"),
    updatedAtISO: new Date().toISOString(),
  });
  return id;
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
  requireOption(args.kind, COUNTERPARTY_KINDS, "Counterparty kind");
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
  const account = await ctx.db.get(args.financialAccountId);
  if (!account || account.societyId !== args.societyId) throw new Error("Mapped account must belong to this society.");
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
    allowClosedPeriodAdjustment?: boolean;
    lines: Array<{
      id?: string;
      accountId: string;
      amountCents: number;
      side: string;
      description?: string;
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
  requireOption(args.status, JOURNAL_STATUSES, "Journal entry status");
  validateJournalLines(args.lines);
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
        createdByUserId: actingUserId,
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
  const candidate = await ctx.db.get(args.transactionCandidateId);
  if (!candidate) throw new Error("Transaction candidate not found.");
  await requireRolePortable(ctx, { actingUserId: args.actingUserId, societyId: String(candidate.societyId), required: "Director" });
  const amountCents = candidate.amountCents ?? signedAmountFromDebitCredit(candidate.debitCents, candidate.creditCents);
  if (!amountCents) throw new Error("Transaction candidate needs an amount before it can be posted.");
  await assertPeriodOpen(ctx, {
    societyId: String(candidate.societyId),
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
    createdByUserId: args.actingUserId,
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
  const candidate = await ctx.db.get(args.transactionCandidateId);
  if (!candidate) throw new Error("Transaction candidate not found.");
  await requireRolePortable(ctx, { actingUserId: args.actingUserId, societyId: String(candidate.societyId), required: "Director" });
  const amountCents = candidate.amountCents ?? signedAmountFromDebitCredit(candidate.debitCents, candidate.creditCents);
  if (!amountCents) throw new Error("Transaction candidate needs an amount before it can be posted.");
  const absoluteCents = Math.abs(amountCents);
  const allocationTotal = args.allocations.reduce((sum: number, row: any) => sum + row.amountCents, 0);
  if (allocationTotal !== absoluteCents) throw new Error("Allocation total must equal the candidate amount.");
  await assertPeriodOpen(ctx, {
    societyId: String(candidate.societyId),
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
    createdByUserId: args.actingUserId,
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

export async function backfillFinancialTransactionsToJournalPortable(
  ctx: PortableMutationCtx,
  { societyId, fiscalYear, limit, actingUserId }: { societyId: string; fiscalYear?: string; limit?: number; actingUserId?: string },
) {
  await requireRolePortable(ctx, { actingUserId, societyId, required: "Admin" });
  const [transactions, existingLines, accounts, mappings] = await Promise.all([
    ctx.db.query("financialTransactions").withIndex("by_society_date", (q) => q.eq("societyId", societyId)).collect(),
    ctx.db.query("journalLines").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect(),
    ctx.db.query("financialAccounts").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect(),
    ctx.db.query("accountingAccountMappings").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect(),
  ]);
  const alreadyBackfilled = new Set(existingLines.map((line: any) => String(line.financialTransactionId ?? "")));
  const accountsById = new Map(accounts.map((account: any) => [String(account._id), account]));
  const fallbackIncome = accounts.find((account: any) => account.accountType === "Income");
  const fallbackExpense = accounts.find((account: any) => account.accountType === "Expense");
  const now = new Date().toISOString();
  let scanned = 0;
  let posted = 0;
  let skipped = 0;
  let needsMapping = 0;
  for (const transaction of transactions.sort((a: any, b: any) => a.date.localeCompare(b.date))) {
    if (posted >= (limit ?? 200)) break;
    scanned += 1;
    if (alreadyBackfilled.has(String(transaction._id))) {
      skipped += 1;
      continue;
    }
    const cashAccount = accountsById.get(String(transaction.accountId));
    if (!cashAccount) {
      needsMapping += 1;
      continue;
    }
    const { cashSide, offsetSide, absoluteAmountCents, offsetKind } = transactionBackfillSides(transaction.amountCents);
    const mapped = mappings.find((mapping: any) =>
      mapping.status === "active" &&
      (
        (transaction.categoryAccountExternalId && mapping.externalAccountId === transaction.categoryAccountExternalId) ||
        (transaction.categoryAccountExternalId && mapping.externalAccountCode === transaction.categoryAccountExternalId) ||
        (transaction.category && mapping.externalCategory?.toLowerCase?.() === transaction.category.toLowerCase()) ||
        (transaction.category && mapping.externalAccountName?.toLowerCase?.() === transaction.category.toLowerCase())
      ),
    );
    const offsetAccount = mapped
      ? accountsById.get(String(mapped.financialAccountId))
      : offsetKind === "income"
        ? fallbackIncome
        : fallbackExpense;
    if (!offsetAccount) {
      needsMapping += 1;
      continue;
    }
    const period = await assertPeriodOpen(ctx, { societyId, date: transaction.date });
    const entryId = await ctx.db.insert("journalEntries", {
      societyId,
      connectionId: transaction.connectionId,
      fiscalPeriodId: period?._id,
      date: transaction.date,
      memo: transaction.description,
      source: "financialTransactionBackfill",
      sourceExternalId: transaction.externalId,
      status: "posted",
      fiscalYear: fiscalYear ?? period?.fiscalYear,
      createdByUserId: actingUserId,
      postedAtISO: now,
      rawJson: JSON.stringify(transaction),
      createdAtISO: now,
      updatedAtISO: now,
    });
    await ctx.db.insert("journalLines", {
      societyId,
      journalEntryId: entryId,
      accountId: transaction.accountId,
      lineOrder: 0,
      amountCents: absoluteAmountCents,
      side: cashSide,
      description: transaction.description,
      financialTransactionId: transaction._id,
      sourceExternalId: transaction.externalId,
      rawJson: JSON.stringify({ backfillRole: "cash" }),
      createdAtISO: now,
      updatedAtISO: now,
    });
    await ctx.db.insert("journalLines", {
      societyId,
      journalEntryId: entryId,
      accountId: offsetAccount._id,
      lineOrder: 1,
      amountCents: absoluteAmountCents,
      side: offsetSide,
      description: transaction.category ?? transaction.description,
      financialTransactionId: transaction._id,
      sourceExternalId: transaction.categoryAccountExternalId ?? transaction.externalId,
      rawJson: JSON.stringify({ backfillRole: "offset", mappingId: mapped?._id }),
      createdAtISO: now,
      updatedAtISO: now,
    });
    posted += 1;
  }
  return { scanned, posted, skipped, needsMapping };
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
  validateJournalLines(args.lines);
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
    createdByUserId: args.actingUserId,
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
  await requireRolePortable(ctx, { actingUserId: args.actingUserId, societyId: args.societyId, required: "Director" });
  const account = await ctx.db.get(args.financialAccountId);
  if (!account || account.societyId !== args.societyId) throw new Error("Account must belong to this society.");
  const [entries, lines] = await Promise.all([
    ctx.db.query("journalEntries").withIndex("by_society_status", (q) => q.eq("societyId", args.societyId).eq("status", "posted")).collect(),
    ctx.db.query("journalLines").withIndex("by_account", (q) => q.eq("accountId", args.financialAccountId)).collect(),
  ]);
  const entryById = new Map(entries.filter((entry) => entry.date <= args.statementDate).map((entry) => [String(entry._id), entry]));
  const includedLines = lines.filter((line) => entryById.has(String(line.journalEntryId)));
  const bookBalanceCents = includedLines.reduce((sum: number, line: any) => sum + (line.side === "debit" ? line.amountCents : -line.amountCents), 0);
  const now = new Date().toISOString();
  const runId = await ctx.db.insert("reconciliationRuns", {
    societyId: args.societyId,
    financialAccountId: args.financialAccountId,
    statementDate: args.statementDate,
    statementBalanceCents: args.statementBalanceCents,
    bookBalanceCents,
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
  const run = await ctx.db.get(id);
  if (!run) throw new Error("Reconciliation run not found.");
  await requireRolePortable(ctx, { actingUserId, societyId: String(run.societyId), required: "Director" });
  await ctx.db.patch(id, {
    status,
    reconciledAtISO: status === "reconciled" ? new Date().toISOString() : run.reconciledAtISO,
    reconciledByUserId: status === "reconciled" ? actingUserId : run.reconciledByUserId,
    updatedAtISO: new Date().toISOString(),
  });
  return id;
}
