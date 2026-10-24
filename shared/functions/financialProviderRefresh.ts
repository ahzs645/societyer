import type { PortableDoc, PortableMutationCtx, PortableQueryCtx, PortableQuery } from "../portable/ctx";
import { parseDateOnly } from "../dateOnly";
import { operatorWaveBusinessId, providerDeploymentEnv } from "../providerWorkspaceBindings";
import { getOwned, requireRolePortable } from "./access";
import { assertNativePayrollBankPatch, nativePayrollBankLink } from "./payrollPaymentGuard";

export type ProviderAccountInput = {
  externalId: string; name: string; currency: string; accountType: string;
  balanceCents?: number; isRestricted: boolean; restrictedPurpose?: string;
};
export type ProviderTransactionInput = {
  externalId: string; accountExternalId: string; date: string; description: string;
  amountCents: number; category?: string; categoryAccountExternalId?: string;
  counterparty?: string; counterpartyExternalId?: string; counterpartyResourceType?: string;
};
type ProviderRows = { accounts: PortableDoc[]; transactions: PortableDoc[] };
const MAX_ACCOUNTS = 1000, MAX_TRANSACTIONS = 3000;

async function bounded(query: PortableQuery, limit: number, label: string) {
  const rows = await query.take(limit + 1);
  if (rows.length > limit) throw new Error(`${label} exceeds this atomic refresh's ${limit.toLocaleString("en-CA")}-record bound. Import a smaller provider batch; existing records were retained.`);
  return rows;
}
function externalId(value: string, label: string) {
  if (typeof value !== "string" || !value.trim() || value.length > 2000) throw new Error(`${label} needs a nonempty provider ID of at most 2,000 characters.`);
  return value;
}
function uniqueByExternal<T extends { externalId: string }>(rows: T[], limit: number, label: string) {
  if (!Array.isArray(rows) || rows.length > limit) throw new Error(`${label} supports at most ${limit.toLocaleString("en-CA")} records per atomic refresh.`);
  const result = new Map<string, T>();
  for (const row of rows) {
    const key = externalId(row.externalId, label), previous = result.get(key);
    if (previous && JSON.stringify(previous) !== JSON.stringify(row)) throw new Error(`${label} contains conflicting duplicate provider ID ${key}.`);
    result.set(key, row);
  }
  return result;
}
function storedByExternal(rows: PortableDoc[], label: string) {
  const result = new Map<string, PortableDoc>();
  for (const row of rows) {
    if (result.has(row.externalId)) throw new Error(`${label} has duplicate stored provider ID ${row.externalId}. Reconcile those records explicitly before refreshing; referenced IDs were retained.`);
    result.set(row.externalId, row);
  }
  return result;
}
async function providerRows(ctx: PortableQueryCtx, societyId: string, connectionId: string): Promise<ProviderRows> {
  await getOwned(ctx, "financialConnections", connectionId, societyId);
  const accounts = await bounded(ctx.db.query("financialAccounts").withIndex("by_connection", q => q.eq("connectionId", connectionId)), MAX_ACCOUNTS, "Provider accounts");
  const transactions: PortableDoc[] = [];
  // The existing by_account index avoids reading unrelated organizations or
  // connections. Missing provider rows are retained, including payment history.
  for (const account of accounts) {
    if (account.societyId !== societyId) throw new Error("Provider account not found.");
    const rows = await bounded(ctx.db.query("financialTransactions").withIndex("by_account", q => q.eq("accountId", account._id)), MAX_TRANSACTIONS - transactions.length, "Existing provider transactions");
    for (const row of rows) {
      if (row.societyId !== societyId || row.connectionId !== connectionId) throw new Error("Provider transaction ownership is inconsistent. Reconcile its source account before refreshing.");
      transactions.push(row);
    }
  }
  return { accounts, transactions };
}
async function protectedPayment(ctx: PortableQueryCtx, row: PortableDoc) {
  return Boolean(await nativePayrollBankLink(ctx, row)) || ["invoice", "bill"].includes(row.matchedKind) || Boolean(row.billPaymentRelease || row.invoicePaymentRelease);
}
async function postedTransaction(ctx: PortableQueryCtx, row: PortableDoc) {
  const lines = await bounded(ctx.db.query("journalLines").withIndex("by_financial_transaction", q => q.eq("financialTransactionId", row._id)), 100, "Provider transaction journals");
  for (const id of new Set(lines.map(line => line.journalEntryId))) {
    const entry = await getOwned(ctx, "journalEntries", id, String(row.societyId));
    if (entry.status === "posted") return true;
  }
  return false;
}

/** Source refreshes are upserts, never destructive snapshot replacement. Local
 * allocations, receipt links and reconciliation provenance survive unchanged.
 * Removed source rows remain historical records rather than dangling payments. */
export async function refreshFinancialProviderDataPortable(ctx: PortableMutationCtx, args: { societyId: string; connectionId: string; accounts: ProviderAccountInput[]; transactions: ProviderTransactionInput[] }) {
  const incomingAccounts = uniqueByExternal(args.accounts, MAX_ACCOUNTS, "Provider accounts"), incomingTransactions = uniqueByExternal(args.transactions, MAX_TRANSACTIONS, "Provider transactions");
  const rows = await providerRows(ctx, args.societyId, args.connectionId), accounts = storedByExternal(rows.accounts, "Provider accounts"), transactions = storedByExternal(rows.transactions, "Provider transactions");
  if (new Set([...accounts.keys(), ...incomingAccounts.keys()]).size > MAX_ACCOUNTS || new Set([...transactions.keys(), ...incomingTransactions.keys()]).size > MAX_TRANSACTIONS) throw new Error("The retained provider history exceeds this atomic refresh bound. Split the connection/history before importing more records; no existing records were removed.");
  const protectedIds = new Set<string>(), postedIds = new Set<string>(), frozenAccounts = new Set<string>();
  for (const row of rows.transactions) {
    if (await protectedPayment(ctx, row)) { protectedIds.add(row._id); frozenAccounts.add(row.accountId); }
    // Only changed source facts need a journal lookup. All metadata on existing
    // rows remains intact regardless of whether a journal has been posted.
    const incoming = incomingTransactions.get(row.externalId);
    if (incoming && !protectedIds.has(row._id) && (incoming.date !== row.date || incoming.amountCents !== row.amountCents || accounts.get(incoming.accountExternalId)?._id !== row.accountId) && await postedTransaction(ctx, row)) postedIds.add(row._id);
  }
  for (const [id, input] of incomingAccounts) {
    if (typeof input.name !== "string" || !input.name.trim() || typeof input.currency !== "string" || !input.currency.trim() || typeof input.accountType !== "string" || !input.accountType.trim() || typeof input.isRestricted !== "boolean" || input.balanceCents !== undefined && !Number.isSafeInteger(input.balanceCents)) throw new Error(`Provider account ${id} has invalid name, currency, type or integer-cent balance.`);
    const old = accounts.get(id);
    if (old && frozenAccounts.has(old._id) && (old.currency !== input.currency || old.accountType !== input.accountType)) throw new Error(`Provider account ${id} holds a recorded payment. Its currency and account type cannot change during refresh; reconcile the provider correction explicitly.`);
  }
  for (const [id, input] of incomingTransactions) {
    externalId(input.accountExternalId, "Transaction account");
    if (!parseDateOnly(input.date) || !Number.isSafeInteger(input.amountCents) || typeof input.description !== "string") throw new Error(`Provider transaction ${id} requires an actual calendar date, description and integer cents.`);
    if (!accounts.has(input.accountExternalId) && !incomingAccounts.has(input.accountExternalId)) throw new Error(`Provider transaction ${id} references an account missing from the source. Include its actual account facts; no currency or account type is assumed.`);
    const old = transactions.get(id), nextAccountId = accounts.get(input.accountExternalId)?._id;
    if (old && (protectedIds.has(old._id) || postedIds.has(old._id)) && (old.date !== input.date || old.amountCents !== input.amountCents || old.accountId !== nextAccountId)) throw new Error(`Provider transaction ${id} is linked to a recorded payment or posted journal. Its amount, date and source account cannot change during refresh; use an explicit dated correction. Existing payment history was retained.`);
    if (old) await assertNativePayrollBankPatch(ctx, old, { date: input.date, amountCents: input.amountCents, accountId: nextAccountId ?? `new:${input.accountExternalId}` });
  }
  const ids = new Map(rows.accounts.map(row => [row.externalId, row._id]));
  let insertedAccounts = 0, insertedTransactions = 0, updatedTransactions = 0;
  for (const [id, input] of incomingAccounts) {
    const old = accounts.get(id), patch = { societyId: args.societyId, connectionId: args.connectionId, externalId: id, name: input.name, currency: input.currency, accountType: input.accountType, balanceCents: input.balanceCents ?? old?.balanceCents ?? 0, isRestricted: input.isRestricted, ...(input.restrictedPurpose === undefined ? {} : { restrictedPurpose: input.restrictedPurpose }) };
    if (old) await ctx.db.patch(old._id, patch);
    else { ids.set(id, await ctx.db.insert("financialAccounts", patch)); insertedAccounts++; }
  }
  for (const [id, input] of incomingTransactions) {
    const old = transactions.get(id), accountId = ids.get(input.accountExternalId)!;
    const patch: Record<string, unknown> = { societyId: args.societyId, connectionId: args.connectionId, externalId: id, accountId, date: input.date, amountCents: input.amountCents, description: input.description };
    for (const key of ["counterparty", "counterpartyExternalId", "counterpartyResourceType"] as const) if (input[key] !== undefined) patch[key] = input[key];
    const locallyCoded = old && (old.categorizedBy || old.accountingAccountId || old.lines?.length || old.reconciledAtISO || old.matchedKind || old.billPaymentRelease || old.invoicePaymentRelease);
    if (!locallyCoded) for (const key of ["category", "categoryAccountExternalId"] as const) if (input[key] !== undefined && (!old || old[key] === undefined)) patch[key] = input[key];
    if (old) { await assertNativePayrollBankPatch(ctx, old, patch); await ctx.db.patch(old._id, patch); updatedTransactions++; }
    else { await ctx.db.insert("financialTransactions", patch); insertedTransactions++; }
  }
  return { accounts: ids.size, importedAccounts: incomingAccounts.size, transactions: incomingTransactions.size, insertedAccounts, insertedTransactions, updatedTransactions, skippedTransactions: args.transactions.length - incomingTransactions.size, retainedAccounts: rows.accounts.filter(row => !incomingAccounts.has(row.externalId)).length, retainedTransactions: rows.transactions.filter(row => !incomingTransactions.has(row.externalId)).length };
}

/** Demo cleanup must not remove real source evidence attached to a payment. */
export async function assertProviderConnectionRemovable(ctx: PortableQueryCtx, societyId: string, connectionId: string) {
  const rows = await providerRows(ctx, societyId, connectionId);
  for (const row of rows.transactions) if (await protectedPayment(ctx, row) || await postedTransaction(ctx, row)) throw new Error("This connection contains a recorded payment or posted bank journal. Keep its source records; reconcile those references before removing demo data.");
}

export async function importBrowserWaveTransactionsPortable(ctx: PortableMutationCtx, args: { societyId: string; businessId: string; profileKey?: string; profileSocietyId?: string; accounts: ProviderAccountInput[]; transactions: ProviderTransactionInput[]; actingUserId?: string }) {
  operatorWaveBusinessId(args.societyId, args.businessId, providerDeploymentEnv("SOCIETYER_WAVE_WORKSPACE_BINDINGS_JSON"));
  await requireRolePortable(ctx, { societyId: args.societyId, actingUserId: args.actingUserId, required: "Admin" });
  if (args.profileKey && args.profileSocietyId !== args.societyId) throw new Error("Browser profile reference is missing or belongs to another society.");
  const connections = await bounded(ctx.db.query("financialConnections").withIndex("by_society", q => q.eq("societyId", args.societyId)), 100, "Provider connections");
  const matches = connections.filter(row => row.provider === "wave" && row.externalBusinessId === args.businessId && (!args.profileKey || row.browserProfileKey === args.profileKey && row.browserProfileSocietyId === args.societyId));
  if (matches.length > 1) throw new Error("Multiple connections represent this Wave source. Reconcile the duplicate connection before importing; payment identities were retained.");
  const connection = matches[0], now = new Date().toISOString();
  const payload = { societyId: args.societyId, provider: "wave", status: "connected", accountLabel: args.profileKey ? `Wave browser profile ${args.profileKey}` : "Wave browser connector", externalBusinessId: args.businessId, syncMode: "browser", ...(args.profileKey ? { browserProfileKey: args.profileKey, browserProfileSocietyId: args.societyId } : {}), connectedAtISO: connection?.connectedAtISO ?? now, lastSyncAtISO: now, demo: false };
  const connectionId = connection?._id ?? await ctx.db.insert("financialConnections", payload);
  const result = await refreshFinancialProviderDataPortable(ctx, { ...args, connectionId });
  await ctx.db.patch(connectionId, { ...payload, lastError: undefined });
  return { connectionId, ...result, syncedAtISO: now };
}
