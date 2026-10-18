/**
 * PORTABLE FUNCTIONS: the Accounts page (money accounts: bank, credit card,
 * payment processor, cash).
 *
 * Reads `financialAccounts`, `financialConnections`, `financialTransactions`
 * and the reconciliation periods; writes account names and the per-account
 * details kept in `bankAccountProfiles` (institution, last four, opening
 * balance, linked ledger account, archived). "Add account" creates a manual
 * money account that is its own ledger account, with the next free chart code
 * for its type (shared/bankAccounts.ts). Each handler runs unchanged on hosted
 * Convex, the local Dexie runtime, and the convex-test oracle.
 */

import type { PortableDoc, PortableMutationCtx, PortableQueryCtx } from "../portable/ctx";
import { getOwned, requireSocietyMembership } from "./access";
import { requirePermissionPortable } from "./permissions";
import { periodsPortable } from "./reconciliation";
import {
  BANK_ACCOUNT_KIND_LABELS,
  BANK_ACCOUNT_SOURCE_LABELS,
  BANK_ACCOUNT_TABS,
  bankAccountBalanceCents,
  bankAccountHealth,
  bankAccountKind,
  bankAccountMatchesTab,
  bankAccountSource,
  isMoneyAccount,
  nextLedgerCode,
  validateNewBankAccount,
  type BankAccountKind,
  type BankAccountTab,
} from "../bankAccounts";

type AccountRow = PortableDoc & {
  societyId: string;
  connectionId: string;
  externalId: string;
  name: string;
  code?: string;
  currency?: string;
  accountType: string;
  subtype?: string;
  balanceCents?: number;
  isRestricted?: boolean;
  sourceSystem?: string;
};

type ProfileRow = PortableDoc & {
  societyId: string;
  accountId: string;
  origin?: string;
  institution?: string;
  lastFour?: string;
  openingBalanceCents?: number;
  openingDate?: string;
  ledgerAccountId?: string;
  archivedAtISO?: string;
  archivedByName?: string;
};

type ConnectionRow = PortableDoc & { provider: string; status: string; lastSyncAtISO?: string; lastError?: string; demo?: boolean; accountLabel?: string };
type TxnRow = PortableDoc & { accountId: string; date: string; amountCents: number; externalId?: string };

const LEDGER_LINK_TYPES = new Set(["bank", "credit", "asset", "liability"]);

async function profileFor(ctx: PortableQueryCtx, accountId: string): Promise<ProfileRow | null> {
  const rows = await ctx.db.query<ProfileRow>("bankAccountProfiles").withIndex("by_account", (q) => q.eq("accountId", accountId)).collect();
  return rows[0] ?? null;
}

async function actorName(ctx: PortableQueryCtx, societyId: string): Promise<string> {
  const user = await requireSocietyMembership(ctx, societyId);
  return String(user.displayName ?? user.name ?? "Workspace owner");
}

async function upsertProfile(ctx: PortableMutationCtx, account: AccountRow, patch: Partial<ProfileRow>) {
  const nowISO = new Date().toISOString();
  const existing = await profileFor(ctx, String(account._id));
  if (existing) {
    await ctx.db.patch(existing._id, { ...patch, updatedAtISO: nowISO });
    return existing._id;
  }
  return ctx.db.insert("bankAccountProfiles", { societyId: account.societyId, accountId: account._id, ...patch, createdAtISO: nowISO, updatedAtISO: nowISO });
}

async function requireMoneyAccount(ctx: PortableMutationCtx, id: string): Promise<AccountRow> {
  const row = await ctx.db.get<AccountRow>(id, "financialAccounts");
  if (!row || typeof row.societyId !== "string") throw new Error("financialAccounts not found.");
  await requirePermissionPortable(ctx, row.societyId, "financials:write");
  if (!isMoneyAccount(row)) throw new Error("Only bank, credit card and cash accounts are managed on the Accounts page.");
  return row;
}

const ledgerLabel = (account: Pick<AccountRow, "code" | "name">) => (account.code ? `${account.code} · ${account.name}` : account.name);

/**
 * Money accounts for the Accounts page: source, feed health, last activity,
 * current balance and linked ledger account, plus the ledger accounts an
 * account can be linked to and counts per tab.
 */
export async function overviewPortable(ctx: PortableQueryCtx, { societyId }: { societyId: string }) {
  await requireSocietyMembership(ctx, societyId);
  const [accounts, connections, profiles, txns, recon] = await Promise.all([
    ctx.db.query<AccountRow>("financialAccounts").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect(),
    ctx.db.query<ConnectionRow>("financialConnections").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect(),
    ctx.db.query<ProfileRow>("bankAccountProfiles").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect(),
    ctx.db.query<TxnRow>("financialTransactions").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect(),
    periodsPortable(ctx, { societyId }),
  ]);
  const accountById = new Map(accounts.map((row) => [String(row._id), row]));
  const connectionById = new Map(connections.map((row) => [String(row._id), row]));
  const profileByAccount = new Map(profiles.map((row) => [String(row.accountId), row]));
  const reconByAccount = new Map(recon.accounts.map((row) => [String(row._id), row]));
  const linesByAccount = new Map<string, TxnRow[]>();
  for (const txn of txns) {
    const list = linesByAccount.get(String(txn.accountId)) ?? [];
    list.push(txn);
    linesByAccount.set(String(txn.accountId), list);
  }

  const rows = accounts.filter(isMoneyAccount).map((account) => {
    const id = String(account._id);
    const profile = profileByAccount.get(id) ?? null;
    const connection = connectionById.get(String(account.connectionId)) ?? null;
    const lines = linesByAccount.get(id) ?? [];
    const kind = bankAccountKind(account);
    const source = bankAccountSource({
      profileOrigin: profile?.origin,
      connectionProvider: connection?.provider,
      sourceSystem: account.sourceSystem,
      hasCsvLines: lines.some((line) => String(line.externalId ?? "").startsWith("csv")),
    });
    const reconAccount = reconByAccount.get(id);
    const health = bankAccountHealth({ source, connectionStatus: connection?.status, connectionError: connection?.lastError, outOfBalanceCount: reconAccount?.outOfBalanceCount ?? 0 });
    const linked = profile?.ledgerAccountId ? accountById.get(String(profile.ledgerAccountId)) : undefined;
    const ledgerAccount = linked
      ? { _id: String(linked._id), label: ledgerLabel(linked), isSelf: false }
      : account.code
        ? { _id: id, label: ledgerLabel(account), isSelf: true }
        : null;
    const lastActivityDate = lines.reduce<string | undefined>((max, line) => (!max || line.date > max ? line.date : max), undefined);
    return {
      _id: id,
      name: account.name,
      code: account.code,
      accountType: account.accountType,
      kind,
      kindLabel: BANK_ACCOUNT_KIND_LABELS[kind],
      currency: account.currency ?? "CAD",
      isRestricted: account.isRestricted === true,
      institution: profile?.institution,
      lastFour: profile?.lastFour,
      source,
      sourceLabel: BANK_ACCOUNT_SOURCE_LABELS[source],
      status: health.status,
      statusLabel: health.label,
      statusReasons: health.reasons,
      connectionId: connection ? String(connection._id) : undefined,
      connectionStatus: connection?.status,
      canSync: source === "wave" && Boolean(connection),
      lastSyncAtISO: source === "wave" ? connection?.lastSyncAtISO : undefined,
      lastActivityDate,
      transactionCount: lines.length,
      balanceCents: bankAccountBalanceCents(account, profile, lines),
      openingBalanceCents: profile?.openingBalanceCents,
      openingDate: profile?.openingDate,
      ledgerAccount,
      reconciledThrough: reconAccount?.lastReconciledThrough,
      archived: Boolean(profile?.archivedAtISO),
      archivedAtISO: profile?.archivedAtISO,
    };
  });
  rows.sort((a, b) => Number(a.archived) - Number(b.archived) || String(a.code ?? "9999").localeCompare(String(b.code ?? "9999")) || a.name.localeCompare(b.name));

  const active = rows.filter((row) => !row.archived);
  const counts = Object.fromEntries(BANK_ACCOUNT_TABS.map((tab) => [tab.id, active.filter((row) => bankAccountMatchesTab(row, tab.id)).length])) as Record<BankAccountTab, number>;
  const linkedLedgerIds = new Set(profiles.map((row) => String(row.ledgerAccountId ?? "")).filter(Boolean));
  const ledgerOptions = accounts
    .filter((row) => row.code && LEDGER_LINK_TYPES.has(String(row.accountType).toLowerCase()))
    .map((row) => ({ _id: String(row._id), label: ledgerLabel(row), accountType: row.accountType, inUse: linkedLedgerIds.has(String(row._id)) }))
    .sort((a, b) => a.label.localeCompare(b.label));
  const wave = connections.find((row) => row.provider === "wave");
  return {
    rows,
    counts,
    archivedCount: rows.length - active.length,
    totalBalanceCents: active.filter((row) => row.currency === "CAD").reduce((sum, row) => sum + row.balanceCents, 0),
    ledgerOptions,
    // Chart codes in use, so "Add account" can preview the code it will take.
    usedCodes: accounts.map((row) => row.code).filter((code): code is string => Boolean(code)),
    waveConnection: wave
      ? { _id: String(wave._id), status: wave.status, lastSyncAtISO: wave.lastSyncAtISO, lastError: wave.lastError, demo: wave.demo === true, accountLabel: wave.accountLabel }
      : null,
  };
}

async function ensureManualConnection(ctx: PortableMutationCtx, societyId: string): Promise<string> {
  const connections = await ctx.db.query<ConnectionRow>("financialConnections").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect();
  const existing = connections.find((row) => row.provider === "manual");
  if (existing) return existing._id;
  return ctx.db.insert("financialConnections", {
    societyId,
    provider: "manual",
    status: "connected",
    accountLabel: "Manual entries",
    syncMode: "manual",
    connectedAtISO: new Date().toISOString(),
    demo: false,
  });
}

const ACCOUNT_TYPE_FOR_KIND: Record<BankAccountKind, { accountType: string; subtype: string; normalBalance: "debit" | "credit" }> = {
  bank: { accountType: "Bank", subtype: "chequing", normalBalance: "debit" },
  cash: { accountType: "Bank", subtype: "cash", normalBalance: "debit" },
  payments: { accountType: "Bank", subtype: "payments", normalBalance: "debit" },
  credit: { accountType: "Credit", subtype: "credit_card", normalBalance: "credit" },
};

/**
 * Add a manual money account. It becomes its own ledger account under the
 * next free chart code for its type, starting at its opening balance on the
 * opening date (the first reconciliation's beginning balance).
 */
export async function createManualAccountPortable(
  ctx: PortableMutationCtx,
  args: { societyId: string; name: string; kind: string; openingBalanceCents: number; openingDate: string; institution?: string; lastFour?: string; currency?: string },
) {
  await requirePermissionPortable(ctx, args.societyId, "financials:write");
  const errors = validateNewBankAccount(args);
  if (errors.length) throw new Error(errors[0]);
  const kind = args.kind as BankAccountKind;
  const existing = await ctx.db.query<AccountRow>("financialAccounts").withIndex("by_society", (q) => q.eq("societyId", args.societyId)).collect();
  const name = args.name.trim();
  if (existing.some((row) => isMoneyAccount(row) && row.name.trim().toLowerCase() === name.toLowerCase())) {
    throw new Error(`An account named “${name}” already exists.`);
  }
  const code = nextLedgerCode(existing.map((row) => row.code), kind);
  const connectionId = await ensureManualConnection(ctx, args.societyId);
  const type = ACCOUNT_TYPE_FOR_KIND[kind];
  const accountId = await ctx.db.insert("financialAccounts", {
    societyId: args.societyId,
    connectionId,
    externalId: `manual:${code}`,
    code,
    name,
    currency: (args.currency || "CAD").toUpperCase(),
    accountType: type.accountType,
    subtype: type.subtype,
    balanceCents: args.openingBalanceCents,
    isRestricted: false,
    sourceSystem: "societyer",
    normalBalance: type.normalBalance,
  });
  const nowISO = new Date().toISOString();
  await ctx.db.insert("bankAccountProfiles", {
    societyId: args.societyId,
    accountId,
    origin: "manual",
    institution: args.institution?.trim() || undefined,
    lastFour: args.lastFour?.trim() || undefined,
    openingBalanceCents: args.openingBalanceCents,
    openingDate: args.openingDate,
    createdAtISO: nowISO,
    updatedAtISO: nowISO,
  });
  await ctx.db.insert("activity", {
    societyId: args.societyId,
    actor: await actorName(ctx, args.societyId),
    entityType: "financialAccount",
    action: "bank-account-added",
    summary: `Added ${BANK_ACCOUNT_KIND_LABELS[kind].toLowerCase()} “${name}” (ledger account ${code}).`,
    createdAtISO: nowISO,
  });
  return { accountId, code };
}

/** Rename an account, or change its institution and last four digits. */
export async function updateAccountPortable(
  ctx: PortableMutationCtx,
  args: { id: string; name?: string; institution?: string; lastFour?: string },
) {
  const account = await requireMoneyAccount(ctx, args.id);
  if (args.name !== undefined) {
    const name = args.name.trim();
    if (!name) throw new Error("Name the account.");
    if (name.length > 120) throw new Error("Keep the name under 120 characters.");
    await ctx.db.patch(account._id, { name });
  }
  if (args.lastFour !== undefined && args.lastFour.trim() && !/^\d{4}$/.test(args.lastFour.trim())) {
    throw new Error("Enter the last four digits of the account number.");
  }
  if (args.institution !== undefined || args.lastFour !== undefined) {
    await upsertProfile(ctx, account, {
      ...(args.institution !== undefined ? { institution: args.institution.trim() || undefined } : {}),
      ...(args.lastFour !== undefined ? { lastFour: args.lastFour.trim() || undefined } : {}),
    });
  }
  return args.id;
}

/**
 * Link an account to its ledger account: an existing chart account (bank,
 * credit, asset or liability), or a new chart code on the account itself.
 * `unlink` returns an account with its own code to being its own ledger account.
 */
export async function linkLedgerAccountPortable(
  ctx: PortableMutationCtx,
  args: { id: string; ledgerAccountId?: string; createLedgerAccount?: boolean; unlink?: boolean },
) {
  const account = await requireMoneyAccount(ctx, args.id);
  if (args.createLedgerAccount) {
    if (account.code) throw new Error(`This account is already ledger account ${account.code}.`);
    const existing = await ctx.db.query<AccountRow>("financialAccounts").withIndex("by_society", (q) => q.eq("societyId", account.societyId)).collect();
    const code = nextLedgerCode(existing.map((row) => row.code), bankAccountKind(account));
    await ctx.db.patch(account._id, { code });
    await upsertProfile(ctx, account, { ledgerAccountId: undefined });
    return { code };
  }
  if (args.unlink) {
    await upsertProfile(ctx, account, { ledgerAccountId: undefined });
    return { code: account.code };
  }
  if (!args.ledgerAccountId) throw new Error("Choose a ledger account.");
  if (String(args.ledgerAccountId) === String(account._id)) throw new Error("Choose a different ledger account.");
  const ledger = await getOwned<AccountRow>(ctx, "financialAccounts", args.ledgerAccountId, account.societyId);
  if (!ledger.code || !LEDGER_LINK_TYPES.has(String(ledger.accountType).toLowerCase())) {
    throw new Error("Link to a bank, credit, asset or liability account in the chart of accounts.");
  }
  if ((ledger.currency ?? "CAD") !== (account.currency ?? "CAD")) throw new Error("The ledger account must use the same currency.");
  await upsertProfile(ctx, account, { ledgerAccountId: String(ledger._id) });
  return { code: ledger.code };
}

/** Archive (hide from the Accounts page and pickers) or restore an account. Its history stays. */
export async function setArchivedPortable(ctx: PortableMutationCtx, { id, archived }: { id: string; archived: boolean }) {
  const account = await requireMoneyAccount(ctx, id);
  const name = await actorName(ctx, account.societyId);
  if (archived) {
    const periods = await ctx.db.query("reconciliationPeriods").withIndex("by_account", (q) => q.eq("accountId", id)).collect();
    if (periods.some((row) => row.status === "in_progress")) throw new Error("Finish or discard the open reconciliation for this account first.");
  }
  await upsertProfile(ctx, account, archived ? { archivedAtISO: new Date().toISOString(), archivedByName: name } : { archivedAtISO: undefined, archivedByName: undefined });
  await ctx.db.insert("activity", {
    societyId: account.societyId,
    actor: name,
    entityType: "financialAccount",
    action: archived ? "bank-account-archived" : "bank-account-restored",
    summary: `${archived ? "Archived" : "Restored"} account “${account.name}”.`,
    createdAtISO: new Date().toISOString(),
  });
  return id;
}
