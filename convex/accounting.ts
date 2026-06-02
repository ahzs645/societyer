import { v } from "convex/values";
import { mutation, query } from "./lib/untypedServer";
import { requireRole } from "./users";

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
  if (lines.length < 2) throw new Error("A journal entry needs at least two lines.");
  let debitCents = 0;
  let creditCents = 0;
  for (const line of lines) {
    if (line.amountCents <= 0) throw new Error("Journal line amounts must be positive cents.");
    if (line.side === "debit") debitCents += line.amountCents;
    else if (line.side === "credit") creditCents += line.amountCents;
    else throw new Error("Journal line side must be debit or credit.");
  }
  if (debitCents !== creditCents) throw new Error("Journal entry is not balanced.");
}

function csvEscape(value: unknown) {
  const text = String(value ?? "");
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function csvRows(rows: unknown[][]) {
  return rows.map((row) => row.map(csvEscape).join(",")).join("\n");
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

export const chartAccounts = query({
  args: { societyId: v.id("societies") },
  returns: v.any(),
  handler: async (ctx, { societyId }) => {
    const accounts = await ctx.db
      .query("financialAccounts")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect();
    return accounts.sort((a, b) => String(a.code ?? "").localeCompare(String(b.code ?? "")) || a.name.localeCompare(b.name));
  },
});

export const fiscalPeriods = query({
  args: { societyId: v.id("societies"), fiscalYear: v.optional(v.string()) },
  returns: v.any(),
  handler: async (ctx, { societyId, fiscalYear }) => {
    const rows = await ctx.db
      .query("accountingFiscalPeriods")
      .withIndex("by_society_fiscal_year", (q) =>
        fiscalYear ? q.eq("societyId", societyId).eq("fiscalYear", fiscalYear) : q.eq("societyId", societyId),
      )
      .collect();
    return rows.sort((a, b) => a.startDate.localeCompare(b.startDate));
  },
});

export const counterparties = query({
  args: { societyId: v.id("societies"), kind: v.optional(v.string()) },
  returns: v.any(),
  handler: async (ctx, { societyId, kind }) => {
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
  },
});

export const fundRestrictions = query({
  args: { societyId: v.id("societies"), status: v.optional(v.string()) },
  returns: v.any(),
  handler: async (ctx, { societyId, status }) => {
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
  },
});

export const accountMappings = query({
  args: { societyId: v.id("societies"), provider: v.optional(v.string()), status: v.optional(v.string()) },
  returns: v.any(),
  handler: async (ctx, { societyId, provider, status }) => {
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
  },
});

export const journalEntries = query({
  args: { societyId: v.id("societies"), status: v.optional(v.string()), limit: v.optional(v.number()) },
  returns: v.any(),
  handler: async (ctx, { societyId, status, limit }) => {
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
  },
});

export const journalEntry = query({
  args: { id: v.id("journalEntries") },
  returns: v.any(),
  handler: async (ctx, { id }) => {
    const entry = await ctx.db.get(id);
    if (!entry) return null;
    const lines = await ctx.db
      .query("journalLines")
      .withIndex("by_entry", (q) => q.eq("journalEntryId", id))
      .collect();
    return { ...entry, lines: lines.sort((a, b) => a.lineOrder - b.lineOrder) };
  },
});

export const trialBalance = query({
  args: { societyId: v.id("societies"), fiscalYear: v.optional(v.string()) },
  returns: v.any(),
  handler: async (ctx, { societyId, fiscalYear }) => buildTrialBalance(ctx, societyId, fiscalYear),
});

export const generalLedger = query({
  args: { societyId: v.id("societies"), fiscalYear: v.optional(v.string()), accountId: v.optional(v.id("financialAccounts")) },
  returns: v.any(),
  handler: async (ctx, { societyId, fiscalYear, accountId }) => buildGeneralLedger(ctx, societyId, fiscalYear, accountId),
});

export const exportCsv = query({
  args: {
    societyId: v.id("societies"),
    kind: v.string(),
    fiscalYear: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, { societyId, kind, fiscalYear }) => {
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
  },
});

export const ensureSocietyerConnection = mutation({
  args: { societyId: v.id("societies"), actingUserId: v.optional(v.id("users")) },
  returns: v.any(),
  handler: async (ctx, { societyId, actingUserId }) => {
    await requireRole(ctx, { actingUserId, societyId, required: "Admin" });
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
  },
});

export const seedSocietyChartOfAccounts = mutation({
  args: { societyId: v.id("societies"), actingUserId: v.optional(v.id("users")) },
  returns: v.any(),
  handler: async (ctx, { societyId, actingUserId }) => {
    await requireRole(ctx, { actingUserId, societyId, required: "Admin" });
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
    const existingCodes = new Set(existingAccounts.map((account) => account.code).filter(Boolean));
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
  },
});

export const upsertFiscalPeriod = mutation({
  args: {
    id: v.optional(v.id("accountingFiscalPeriods")),
    societyId: v.id("societies"),
    fiscalYear: v.string(),
    periodLabel: v.string(),
    startDate: v.string(),
    endDate: v.string(),
    status: v.string(),
    notes: v.optional(v.string()),
    actingUserId: v.optional(v.id("users")),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    await requireRole(ctx, { actingUserId: args.actingUserId, societyId: args.societyId, required: "Director" });
    requireOption(args.status, FISCAL_PERIOD_STATUSES, "Fiscal period status");
    const { id, actingUserId, ...payload } = args;
    const now = new Date().toISOString();
    if (id) {
      await ctx.db.patch(id, { ...payload, updatedAtISO: now });
      return id;
    }
    return await ctx.db.insert("accountingFiscalPeriods", { ...payload, createdAtISO: now, updatedAtISO: now });
  },
});

export const closeFiscalPeriod = mutation({
  args: { id: v.id("accountingFiscalPeriods"), actingUserId: v.optional(v.id("users")) },
  returns: v.any(),
  handler: async (ctx, { id, actingUserId }) => {
    const period = await ctx.db.get(id);
    if (!period) throw new Error("Fiscal period not found.");
    await requireRole(ctx, { actingUserId, societyId: period.societyId, required: "Admin" });
    await ctx.db.patch(id, {
      status: "closed",
      closedAtISO: new Date().toISOString(),
      closedByUserId: actingUserId,
      updatedAtISO: new Date().toISOString(),
    });
    return id;
  },
});

export const reopenFiscalPeriod = mutation({
  args: { id: v.id("accountingFiscalPeriods"), notes: v.optional(v.string()), actingUserId: v.optional(v.id("users")) },
  returns: v.any(),
  handler: async (ctx, { id, notes, actingUserId }) => {
    const period = await ctx.db.get(id);
    if (!period) throw new Error("Fiscal period not found.");
    await requireRole(ctx, { actingUserId, societyId: period.societyId, required: "Admin" });
    await ctx.db.patch(id, {
      status: "open",
      closedAtISO: undefined,
      closedByUserId: undefined,
      notes: [period.notes, notes].filter(Boolean).join("\n"),
      updatedAtISO: new Date().toISOString(),
    });
    return id;
  },
});

export const upsertCounterparty = mutation({
  args: {
    id: v.optional(v.id("accountingCounterparties")),
    societyId: v.id("societies"),
    name: v.string(),
    kind: v.string(),
    provider: v.optional(v.string()),
    externalId: v.optional(v.string()),
    email: v.optional(v.string()),
    taxIdentifier: v.optional(v.string()),
    notes: v.optional(v.string()),
    actingUserId: v.optional(v.id("users")),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    await requireRole(ctx, { actingUserId: args.actingUserId, societyId: args.societyId, required: "Director" });
    requireOption(args.kind, COUNTERPARTY_KINDS, "Counterparty kind");
    const { id, actingUserId, ...payload } = args;
    const now = new Date().toISOString();
    if (id) {
      await ctx.db.patch(id, { ...payload, updatedAtISO: now });
      return id;
    }
    return await ctx.db.insert("accountingCounterparties", { ...payload, createdAtISO: now, updatedAtISO: now });
  },
});

export const upsertFundRestriction = mutation({
  args: {
    id: v.optional(v.id("fundRestrictions")),
    societyId: v.id("societies"),
    name: v.string(),
    purpose: v.string(),
    status: v.string(),
    linkedGrantId: v.optional(v.id("grants")),
    linkedFinancialAccountId: v.optional(v.id("financialAccounts")),
    startDate: v.optional(v.string()),
    endDate: v.optional(v.string()),
    sourceDocumentIds: v.optional(v.array(v.id("documents"))),
    notes: v.optional(v.string()),
    actingUserId: v.optional(v.id("users")),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    await requireRole(ctx, { actingUserId: args.actingUserId, societyId: args.societyId, required: "Director" });
    requireOption(args.status, FUND_RESTRICTION_STATUSES, "Fund restriction status");
    const { id, actingUserId, ...payload } = args;
    const now = new Date().toISOString();
    if (id) {
      await ctx.db.patch(id, { ...payload, updatedAtISO: now });
      return id;
    }
    return await ctx.db.insert("fundRestrictions", { ...payload, createdAtISO: now, updatedAtISO: now });
  },
});

export const upsertAccountMapping = mutation({
  args: {
    id: v.optional(v.id("accountingAccountMappings")),
    societyId: v.id("societies"),
    provider: v.string(),
    externalAccountId: v.optional(v.string()),
    externalAccountCode: v.optional(v.string()),
    externalAccountName: v.string(),
    externalCategory: v.optional(v.string()),
    financialAccountId: v.id("financialAccounts"),
    confidence: v.optional(v.string()),
    status: v.string(),
    notes: v.optional(v.string()),
    actingUserId: v.optional(v.id("users")),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    await requireRole(ctx, { actingUserId: args.actingUserId, societyId: args.societyId, required: "Director" });
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
  },
});

export const upsertJournalEntry = mutation({
  args: {
    id: v.optional(v.id("journalEntries")),
    societyId: v.id("societies"),
    connectionId: v.optional(v.id("financialConnections")),
    fiscalPeriodId: v.optional(v.id("accountingFiscalPeriods")),
    entryNumber: v.optional(v.string()),
    reference: v.optional(v.string()),
    date: v.string(),
    memo: v.string(),
    source: v.string(),
    sourceExternalId: v.optional(v.string()),
    status: v.string(),
    fiscalYear: v.optional(v.string()),
    sourceDocumentIds: v.optional(v.array(v.id("documents"))),
    rawJson: v.optional(v.string()),
    allowClosedPeriodAdjustment: v.optional(v.boolean()),
    lines: v.array(
      v.object({
        id: v.optional(v.id("journalLines")),
        accountId: v.id("financialAccounts"),
        amountCents: v.number(),
        side: v.string(),
        description: v.optional(v.string()),
        counterpartyId: v.optional(v.id("accountingCounterparties")),
        grantId: v.optional(v.id("grants")),
        fundRestrictionId: v.optional(v.id("fundRestrictions")),
        financialTransactionId: v.optional(v.id("financialTransactions")),
        transactionCandidateId: v.optional(v.id("transactionCandidates")),
        documentIds: v.optional(v.array(v.id("documents"))),
        sourceExternalId: v.optional(v.string()),
        rawJson: v.optional(v.string()),
      }),
    ),
    actingUserId: v.optional(v.id("users")),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    await requireRole(ctx, { actingUserId: args.actingUserId, societyId: args.societyId, required: "Director" });
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
  },
});

export const postTransactionCandidate = mutation({
  args: {
    transactionCandidateId: v.id("transactionCandidates"),
    cashAccountId: v.id("financialAccounts"),
    offsetAccountId: v.id("financialAccounts"),
    counterpartyId: v.optional(v.id("accountingCounterparties")),
    grantId: v.optional(v.id("grants")),
    fundRestrictionId: v.optional(v.id("fundRestrictions")),
    fiscalPeriodId: v.optional(v.id("accountingFiscalPeriods")),
    fiscalYear: v.optional(v.string()),
    memo: v.optional(v.string()),
    allowClosedPeriodAdjustment: v.optional(v.boolean()),
    actingUserId: v.optional(v.id("users")),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const candidate = await ctx.db.get(args.transactionCandidateId);
    if (!candidate) throw new Error("Transaction candidate not found.");
    await requireRole(ctx, { actingUserId: args.actingUserId, societyId: candidate.societyId, required: "Director" });
    const amountCents = candidate.amountCents ?? signedAmountFromDebitCredit(candidate.debitCents, candidate.creditCents);
    if (!amountCents) throw new Error("Transaction candidate needs an amount before it can be posted.");
    await assertPeriodOpen(ctx, {
      societyId: candidate.societyId,
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
  },
});

export const postTransactionCandidateAllocation = mutation({
  args: {
    transactionCandidateId: v.id("transactionCandidates"),
    cashAccountId: v.id("financialAccounts"),
    allocations: v.array(
      v.object({
        accountId: v.id("financialAccounts"),
        amountCents: v.number(),
        description: v.optional(v.string()),
        counterpartyId: v.optional(v.id("accountingCounterparties")),
        grantId: v.optional(v.id("grants")),
        fundRestrictionId: v.optional(v.id("fundRestrictions")),
        documentIds: v.optional(v.array(v.id("documents"))),
      }),
    ),
    fiscalPeriodId: v.optional(v.id("accountingFiscalPeriods")),
    fiscalYear: v.optional(v.string()),
    memo: v.optional(v.string()),
    allowClosedPeriodAdjustment: v.optional(v.boolean()),
    actingUserId: v.optional(v.id("users")),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const candidate = await ctx.db.get(args.transactionCandidateId);
    if (!candidate) throw new Error("Transaction candidate not found.");
    await requireRole(ctx, { actingUserId: args.actingUserId, societyId: candidate.societyId, required: "Director" });
    const amountCents = candidate.amountCents ?? signedAmountFromDebitCredit(candidate.debitCents, candidate.creditCents);
    if (!amountCents) throw new Error("Transaction candidate needs an amount before it can be posted.");
    const absoluteCents = Math.abs(amountCents);
    const allocationTotal = args.allocations.reduce((sum, row) => sum + row.amountCents, 0);
    if (allocationTotal !== absoluteCents) throw new Error("Allocation total must equal the candidate amount.");
    await assertPeriodOpen(ctx, {
      societyId: candidate.societyId,
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
  },
});

export const postOpeningBalances = mutation({
  args: {
    societyId: v.id("societies"),
    date: v.string(),
    fiscalYear: v.optional(v.string()),
    fiscalPeriodId: v.optional(v.id("accountingFiscalPeriods")),
    memo: v.optional(v.string()),
    sourceDocumentIds: v.optional(v.array(v.id("documents"))),
    lines: v.array(
      v.object({
        accountId: v.id("financialAccounts"),
        amountCents: v.number(),
        side: v.string(),
        description: v.optional(v.string()),
        fundRestrictionId: v.optional(v.id("fundRestrictions")),
      }),
    ),
    actingUserId: v.optional(v.id("users")),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    await requireRole(ctx, { actingUserId: args.actingUserId, societyId: args.societyId, required: "Admin" });
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
  },
});

export const createReconciliationRun = mutation({
  args: {
    societyId: v.id("societies"),
    financialAccountId: v.id("financialAccounts"),
    statementDate: v.string(),
    statementBalanceCents: v.number(),
    sourceDocumentIds: v.optional(v.array(v.id("documents"))),
    notes: v.optional(v.string()),
    actingUserId: v.optional(v.id("users")),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    await requireRole(ctx, { actingUserId: args.actingUserId, societyId: args.societyId, required: "Director" });
    const account = await ctx.db.get(args.financialAccountId);
    if (!account || account.societyId !== args.societyId) throw new Error("Account must belong to this society.");
    const [entries, lines] = await Promise.all([
      ctx.db.query("journalEntries").withIndex("by_society_status", (q) => q.eq("societyId", args.societyId).eq("posted")).collect(),
      ctx.db.query("journalLines").withIndex("by_account", (q) => q.eq("accountId", args.financialAccountId)).collect(),
    ]);
    const entryById = new Map(entries.filter((entry) => entry.date <= args.statementDate).map((entry) => [String(entry._id), entry]));
    const includedLines = lines.filter((line) => entryById.has(String(line.journalEntryId)));
    const bookBalanceCents = includedLines.reduce((sum, line) => sum + (line.side === "debit" ? line.amountCents : -line.amountCents), 0);
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
  },
});

export const setReconciliationRunStatus = mutation({
  args: { id: v.id("reconciliationRuns"), status: v.string(), actingUserId: v.optional(v.id("users")) },
  returns: v.any(),
  handler: async (ctx, { id, status, actingUserId }) => {
    requireOption(status, RECONCILIATION_STATUSES, "Reconciliation status");
    const run = await ctx.db.get(id);
    if (!run) throw new Error("Reconciliation run not found.");
    await requireRole(ctx, { actingUserId, societyId: run.societyId, required: "Director" });
    await ctx.db.patch(id, {
      status,
      reconciledAtISO: status === "reconciled" ? new Date().toISOString() : run.reconciledAtISO,
      reconciledByUserId: status === "reconciled" ? actingUserId : run.reconciledByUserId,
      updatedAtISO: new Date().toISOString(),
    });
    return id;
  },
});

function signedAmountFromDebitCredit(debitCents?: number, creditCents?: number) {
  if (typeof debitCents === "number" && debitCents > 0) return -debitCents;
  if (typeof creditCents === "number" && creditCents > 0) return creditCents;
  return 0;
}
