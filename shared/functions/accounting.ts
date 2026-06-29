/**
 * PORTABLE FUNCTIONS: the accounting read domain (chart of accounts, fiscal
 * periods, counterparties, fund restrictions, account mappings, journal
 * entries, trial balance, general ledger, CSV exports, board/auditor package).
 *
 * Only the pure `ctx.db` query handlers live here. The mutation surface of the
 * accounting domain (anything guarded by `requireRole`) stays on Convex.
 *
 * Each handler reads exclusively through the portable `ctx.db` contract and runs
 * unchanged on hosted Convex, the local Dexie runtime, and the convex-test
 * oracle.
 */

import type { PortableQueryCtx } from "../portable/ctx";

function csvEscape(value: unknown) {
  const text = String(value ?? "");
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
