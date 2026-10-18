/**
 * PORTABLE FUNCTIONS: the financial hub read/write domain (connections,
 * accounts, transactions, transaction lookups by external id, budgets,
 * operating subscriptions).
 *
 * Pure connection status changes also run locally. Live connection setup,
 * provider synchronization and scheduler operations remain hosted capabilities.
 *
 * Each handler reads/writes exclusively through the portable `ctx.db` contract
 * and runs unchanged on hosted Convex, the local Dexie runtime, and the
 * convex-test oracle. Role-gated mutations call `requireRolePortable` so live
 * and offline enforce the same rule. `normalizeCategoryLabel` and
 * `monthlyEquivalentCents` are pure helpers shared by the ported handlers.
 */

import { assertValid, validateBudgetLineInput } from "../recordValidation";
import type { PortableMutationCtx, PortableQueryCtx } from "../portable/ctx";
import { getOwned, requireRolePortable, requireSocietyMembership } from "./access";
import { fiscalWindow } from "./treasury";
import { todayDateOnly } from "../dateOnly";
import { RULE_TOUCHED_FIELDS, snapshotRuleFields } from "../transactionRules";
import { categoryAmounts, isSplitTransaction } from "../transactionLines";
import { assertTransactionBooksOpen, createTransactionBooksLock, createTransactionJournalSync, patchTransactionWithJournal } from "./accounting";
import { requireBudgetForTransaction } from "./spendBudgets";
import { releaseInboxMatches } from "./receiptInbox";

function normalizeCategoryLabel(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

function monthlyEquivalentCents(amountCents: number, interval: string) {
  if (interval === "week") return Math.round((amountCents * 52) / 12);
  if (interval === "quarter") return Math.round(amountCents / 3);
  if (interval === "year") return Math.round(amountCents / 12);
  return amountCents;
}

/** A debit-normal account (Bank/Asset/Expense) increases on debit; everything
 *  else (Credit/Liability/Income/Equity) increases on credit. Used to sign
 *  journal lines when no explicit normalBalance is stored on the account. */
function defaultNormalBalance(accountType?: string): "debit" | "credit" {
  return ["Bank", "Asset", "Expense"].includes(String(accountType ?? "")) ? "debit" : "credit";
}

/** Derive each account's balance from POSTED journal lines (double-entry: a
 *  line moves the balance up when its side matches the account's normal
 *  balance, down otherwise). Returns a per-account posted balance plus whether
 *  the account had any posted lines at all, so callers can prefer the ledger
 *  where it exists and fall back to the imported balance otherwise. */
function computeLedgerBalances(accounts: any[], entries: any[], lines: any[]) {
  const postedEntryIds = new Set(
    entries.filter((e) => e.status === "posted").map((e) => String(e._id)),
  );
  const normalByAccount = new Map<string, "debit" | "credit">(
    accounts.map((a) => [
      String(a._id),
      (a.normalBalance === "debit" || a.normalBalance === "credit"
        ? a.normalBalance
        : defaultNormalBalance(a.accountType)) as "debit" | "credit",
    ]),
  );
  const result = new Map<string, { postedBalanceCents: number; hasPostedLines: boolean }>();
  for (const line of lines) {
    if (!postedEntryIds.has(String(line.journalEntryId))) continue;
    const acctId = String(line.accountId);
    const normal = normalByAccount.get(acctId) ?? "debit";
    const signed = line.side === normal ? line.amountCents : -line.amountCents;
    const cur = result.get(acctId) ?? { postedBalanceCents: 0, hasPostedLines: false };
    cur.postedBalanceCents += signed;
    cur.hasPostedLines = true;
    result.set(acctId, cur);
  }
  return result;
}

export async function connectionsPortable(ctx: PortableQueryCtx, { societyId }: { societyId: string }) {
  await requireSocietyMembership(ctx, societyId);
  return ctx.db
    .query("financialConnections")
    .withIndex("by_society", (q) => q.eq("societyId", societyId))
    .collect();
}

/** Disconnect changes local metadata; it neither deletes cached records nor
 * asserts that a remote provider revoked its credential. */
export async function disconnectPortable(ctx: PortableMutationCtx, { connectionId, actingUserId }: { connectionId: string; actingUserId?: string }) {
  const connection = await ctx.db.get(connectionId, "financialConnections");
  if (!connection) throw new Error("Financial connection not found.");
  await requireRolePortable(ctx, { societyId: String(connection.societyId), actingUserId, required: "Admin" });
  await getOwned(ctx, "financialConnections", connectionId, String(connection.societyId));
  await ctx.db.patch(connectionId, { status: "disconnected" });
  return null;
}

/** Offline connection setup is explicitly a demo record, never a live OAuth
 * connection. Existing imported records remain unchanged on reconnect. */
export async function markDemoConnectionConnectedPortable(ctx: PortableMutationCtx, args: { societyId: string; provider: string; accountLabel?: string; externalBusinessId?: string; demo: boolean; actingUserId?: string }) {
  await requireRolePortable(ctx, { societyId: args.societyId, actingUserId: args.actingUserId, required: "Admin" });
  const society = await ctx.db.get(args.societyId, "societies");
  if (!args.demo || society?.demoMode !== true) throw new Error("Local connection setup requires a demo workspace. Live Wave connections require the configured server.");
  if (args.provider !== "wave") throw new Error("This local demo supports the Wave provider only.");
  const existing = await ctx.db.query("financialConnections").withIndex("by_society", (q) => q.eq("societyId", args.societyId)).collect();
  const connection = existing.find((row: any) => row.provider === args.provider);
  if (connection && connection.demo !== true) throw new Error("A live connection cannot be changed into a demo connection. Use the configured server to manage it.");
  const payload = { societyId: args.societyId, provider: args.provider, status: "connected", accountLabel: args.accountLabel, externalBusinessId: args.externalBusinessId, syncMode: "demo", demo: true, connectedAtISO: new Date().toISOString() };
  if (connection) { await ctx.db.patch(connection._id, payload); return connection._id; }
  return ctx.db.insert("financialConnections", payload);
}

export async function accountsPortable(ctx: PortableQueryCtx, { societyId }: { societyId: string }) {
  await requireSocietyMembership(ctx, societyId);
  return ctx.db
    .query("financialAccounts")
    .withIndex("by_society", (q) => q.eq("societyId", societyId))
    .collect();
}

export async function transactionsPortable(
  ctx: PortableQueryCtx,
  { societyId, limit }: { societyId: string; limit?: number },
) {
  await requireSocietyMembership(ctx, societyId);
  return ctx.db
    .query("financialTransactions")
    .withIndex("by_society_date", (q) => q.eq("societyId", societyId))
    .order("desc")
    .take(limit ?? 100);
}

export async function transactionsForAccountExternalIdPortable(
  ctx: PortableQueryCtx,
  { societyId, externalId, limit }: { societyId: string; externalId: string; limit?: number },
) {
  await requireSocietyMembership(ctx, societyId);
  const accounts = await ctx.db
    .query("financialAccounts")
    .withIndex("by_society", (q) => q.eq("societyId", societyId))
    .collect();
  const account = accounts.find((row) => row.externalId === externalId);
  if (!account) {
    return { account: null, transactions: [], total: 0 };
  }
  const rows = await ctx.db
    .query("financialTransactions")
    .withIndex("by_account", (q) => q.eq("accountId", account._id))
    .collect();
  const transactions = rows
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, limit ?? 500);
  return {
    account,
    transactions,
    total: rows.length,
  };
}

export async function transactionsForCounterpartyExternalIdPortable(
  ctx: PortableQueryCtx,
  {
    societyId,
    externalId,
    resourceType,
    limit,
  }: { societyId: string; externalId: string; resourceType?: string; limit?: number },
) {
  await requireSocietyMembership(ctx, societyId);
  const transactionQuery = resourceType
    ? ctx.db
        .query("financialTransactions")
        .withIndex("by_society_counterparty_external_type", (q) =>
          q.eq("societyId", societyId).eq("counterpartyExternalId", externalId).eq("counterpartyResourceType", resourceType),
        )
    : ctx.db
        .query("financialTransactions")
        .withIndex("by_society_counterparty_external", (q) =>
          q.eq("societyId", societyId).eq("counterpartyExternalId", externalId),
        );
  const [accounts, transactionRows, snapshots] = (await Promise.all([
    ctx.db
      .query("financialAccounts")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect(),
    transactionQuery.collect(),
    ctx.db
      .query("waveCacheSnapshots")
      .withIndex("by_society_provider", (q) => q.eq("societyId", societyId).eq("provider", "wave"))
      .order("desc")
      .take(1),
  ])) as [any[], any[], any[]];
  const accountById = new Map<string, any>(accounts.map((account) => [String(account._id), account]));
  const accountResourceByExternalId = new Map<string, any>();
  const latestSnapshot = snapshots[0];
  if (latestSnapshot) {
    const waveResources: any[] = await ctx.db
      .query("waveCacheResources")
      .withIndex("by_snapshot", (q) => q.eq("snapshotId", latestSnapshot._id))
      .collect();
    for (const resource of waveResources) {
      if (resource.resourceType === "account" && resource.externalId) {
        accountResourceByExternalId.set(resource.externalId, {
          _id: resource._id,
          label: resource.label,
          resourceType: resource.resourceType,
        });
      }
    }
  }
  const rows = transactionRows.sort((a, b) => b.date.localeCompare(a.date));
  const linkedTotalCents = rows.reduce((sum, row) => sum + row.amountCents, 0);
  return {
    transactions: rows.slice(0, limit ?? 500).map((row) => ({
      ...row,
      account: accountById.get(String(row.accountId)) ?? null,
      accountResource: accountById.get(String(row.accountId))?.externalId
        ? accountResourceByExternalId.get(accountById.get(String(row.accountId))!.externalId) ?? null
        : null,
    })),
    total: rows.length,
    linkedTotalCents,
  };
}

export async function transactionsForCategoryAccountExternalIdPortable(
  ctx: PortableQueryCtx,
  {
    societyId,
    externalId,
    label,
    limit,
  }: { societyId: string; externalId: string; label?: string; limit?: number },
) {
  await requireSocietyMembership(ctx, societyId);
  const labelText = label?.trim();
  const normalizedLabel = normalizeCategoryLabel(labelText);
  const [accounts, rowsByExternalId, rowsByLabel, snapshots] = (await Promise.all([
    ctx.db
      .query("financialAccounts")
      .withIndex("by_society", (q) => q.eq("societyId", societyId))
      .collect(),
    ctx.db
      .query("financialTransactions")
      .withIndex("by_society_category_account_external", (q) =>
        q.eq("societyId", societyId).eq("categoryAccountExternalId", externalId),
      )
      .collect(),
    labelText
      ? ctx.db
          .query("financialTransactions")
          .withIndex("by_society_category", (q) => q.eq("societyId", societyId).eq("category", labelText))
          .collect()
      : Promise.resolve([]),
    ctx.db
      .query("waveCacheSnapshots")
      .withIndex("by_society_provider", (q) => q.eq("societyId", societyId).eq("provider", "wave"))
      .order("desc")
      .take(1),
  ])) as [any[], any[], any[], any[]];
  const accountById = new Map<string, any>(accounts.map((account) => [String(account._id), account]));
  const accountResourceByExternalId = new Map<string, any>();
  const latestSnapshot = snapshots[0];
  if (latestSnapshot) {
    const waveResources: any[] = await ctx.db
      .query("waveCacheResources")
      .withIndex("by_snapshot", (q) => q.eq("snapshotId", latestSnapshot._id))
      .collect();
    for (const resource of waveResources) {
      if (resource.resourceType === "account" && resource.externalId) {
        accountResourceByExternalId.set(resource.externalId, {
          _id: resource._id,
          label: resource.label,
          resourceType: resource.resourceType,
        });
      }
    }
  }
  const rowById = new Map<string, any>(rowsByExternalId.map((row) => [String(row._id), row]));
  for (const row of rowsByLabel) {
    if (!row.categoryAccountExternalId && normalizedLabel && normalizeCategoryLabel(row.category) === normalizedLabel) {
      rowById.set(String(row._id), row);
    }
  }
  const rows = Array.from(rowById.values()).sort((a, b) => b.date.localeCompare(a.date));
  const linkedTotalCents = rows.reduce((sum, row) => sum + row.amountCents, 0);
  return {
    transactions: rows.slice(0, limit ?? 500).map((row) => {
      const account = accountById.get(String(row.accountId)) ?? null;
      return {
        ...row,
        account,
        accountResource: account?.externalId ? accountResourceByExternalId.get(account.externalId) ?? null : null,
      };
    }),
    total: rows.length,
    linkedTotalCents,
  };
}

export async function budgetsPortable(
  ctx: PortableQueryCtx,
  { societyId, fiscalYear }: { societyId: string; fiscalYear?: string },
) {
  await requireSocietyMembership(ctx, societyId);
  const rows = await ctx.db
    .query("budgets")
    .withIndex("by_society_fy", (q) =>
      fiscalYear ? q.eq("societyId", societyId).eq("fiscalYear", fiscalYear) : q.eq("societyId", societyId),
    )
    .collect();
  return rows;
}

export async function operatingSubscriptionsPortable(ctx: PortableQueryCtx, { societyId }: { societyId: string }) {
  await requireSocietyMembership(ctx, societyId);
  const rows = await ctx.db
    .query("operatingSubscriptions")
    .withIndex("by_society", (q) => q.eq("societyId", societyId))
    .collect();
  return rows
    .map((row) => {
      const monthlyEstimateCents = monthlyEquivalentCents(row.amountCents, row.interval);
      return {
        ...row,
        monthlyEstimateCents,
        annualEstimateCents: monthlyEstimateCents * 12,
      };
    })
    .sort((a: any, b: any) => `${a.status}:${a.name}`.localeCompare(`${b.status}:${b.name}`));
}

export async function upsertBudgetPortable(
  ctx: PortableMutationCtx,
  args: {
    id?: string;
    societyId: string;
    fiscalYear: string;
    category: string;
    plannedCents: number;
    programCode?: string;
    accountId?: string;
    currency?: string;
    notes?: string;
    actingUserId?: string;
  },
) {
  await requireSocietyMembership(ctx, args.societyId);
  await requireRolePortable(ctx, {
    actingUserId: args.actingUserId,
    societyId: args.societyId,
    required: "Director",
  });
  if (!Number.isSafeInteger(args.plannedCents)) throw new Error("Budget amount must be integer cents.");
  const existingBudgets = await ctx.db
    .query("budgets")
    .withIndex("by_society_fy", (q) => q.eq("societyId", args.societyId).eq("fiscalYear", args.fiscalYear))
    .collect();
  assertValid(validateBudgetLineInput(args, existingBudgets as any, args.id));
  args = { ...args, category: args.category.trim() };
  if (args.programCode && !args.accountId) throw new Error("A program budget needs a ledger account.");
  if (args.accountId) {
    const account = await getOwned(ctx, "financialAccounts", args.accountId, args.societyId);
    if (!["Income", "Expense"].includes(account.accountType)) throw new Error("Program budgets use income or expense accounts.");
    if (args.currency && args.currency !== account.currency) throw new Error("Budget currency must match its account.");
    args = { ...args, currency: account.currency, programCode: args.programCode?.trim() || undefined };
  }
  const { id, actingUserId, ...rest } = args;
  if (id) {
    await getOwned(ctx, "budgets", id, args.societyId);
    await ctx.db.patch(id, rest);
    return id;
  }
  return await ctx.db.insert("budgets", rest);
}

/**
 * Save a fiscal year's category budget lines from the budget grid in one
 * atomic step. Every line is validated against the final set (so a rename
 * and a new line with the old name can land together); if any line fails,
 * nothing is written and the per-line errors come back by input index.
 * Only plain category lines (no program/account) are editable here.
 */
export async function saveBudgetLinesPortable(
  ctx: PortableMutationCtx,
  args: {
    societyId: string;
    fiscalYear: string;
    upserts: Array<{ id?: string; category: string; plannedCents: number; notes?: string }>;
    removeIds: string[];
    actingUserId?: string;
  },
) {
  await requireSocietyMembership(ctx, args.societyId);
  await requireRolePortable(ctx, {
    actingUserId: args.actingUserId,
    societyId: args.societyId,
    required: "Director",
  });
  if (!String(args.fiscalYear ?? "").trim()) throw new Error("Choose a fiscal year.");
  if (args.upserts.length + args.removeIds.length > 500) throw new Error("Save at most 500 budget lines at a time.");
  const existing = await ctx.db
    .query("budgets")
    .withIndex("by_society_fy", (q) => q.eq("societyId", args.societyId).eq("fiscalYear", args.fiscalYear))
    .collect();
  const editable = new Map(
    existing.filter((row: any) => !row.programCode && !row.accountId).map((row: any) => [String(row._id), row]),
  );
  const rowErrors: Array<{ index: number; field: string; message: string }> = [];
  // Ids that are not this society's category lines for this year are counted,
  // never echoed back, so a foreign id cannot be probed through this endpoint.
  let unknownRemovals = 0;
  for (const id of args.removeIds) if (!editable.has(String(id))) unknownRemovals += 1;
  const removing = new Set(args.removeIds.map(String).filter((id) => editable.has(id)));
  const finalRows: Array<{ _id?: string; fiscalYear: string; category: string; programCode?: string }> = existing
    .filter((row: any) => !removing.has(String(row._id)))
    .filter((row: any) => !args.upserts.some((u) => u.id && String(u.id) === String(row._id)))
    .map((row: any) => ({ _id: String(row._id), fiscalYear: row.fiscalYear, category: row.category, programCode: row.programCode }));
  args.upserts.forEach((line, index) => {
    if (line.id && (!editable.has(String(line.id)) || removing.has(String(line.id)))) {
      rowErrors.push({ index, field: "category", message: "This budget line no longer exists. Discard and reload the grid." });
      return;
    }
    if (!Number.isSafeInteger(line.plannedCents)) {
      rowErrors.push({ index, field: "plannedCents", message: "Budget amount must be integer cents." });
      return;
    }
    const candidate = { fiscalYear: args.fiscalYear, category: String(line.category ?? "").trim(), plannedCents: line.plannedCents };
    const errors = validateBudgetLineInput(candidate, finalRows as any);
    for (const [field, message] of Object.entries(errors)) rowErrors.push({ index, field, message: String(message) });
    finalRows.push({ _id: `pending-${index}`, ...candidate });
  });
  if (unknownRemovals > 0) {
    rowErrors.push({ index: -1, field: "removeIds", message: `${unknownRemovals} removed line${unknownRemovals === 1 ? " was" : "s were"} not found.` });
  }
  if (rowErrors.length > 0) return { ok: false as const, rowErrors };

  let inserted = 0;
  let updated = 0;
  for (const id of removing) await ctx.db.delete(id);
  for (const line of args.upserts) {
    const patch = {
      category: line.category.trim(),
      plannedCents: line.plannedCents,
      notes: line.notes?.trim() || undefined,
    };
    if (line.id) {
      await ctx.db.patch(String(line.id), patch);
      updated += 1;
    } else {
      await ctx.db.insert("budgets", { societyId: args.societyId, fiscalYear: args.fiscalYear, ...patch });
      inserted += 1;
    }
  }
  return { ok: true as const, inserted, updated, removed: removing.size };
}

export async function upsertOperatingSubscriptionPortable(
  ctx: PortableMutationCtx,
  args: {
    id?: string;
    societyId: string;
    name: string;
    vendorName?: string;
    category: string;
    amountCents: number;
    currency: string;
    interval: string;
    status: string;
    nextRenewalDate?: string;
    notes?: string;
    actingUserId?: string;
  },
) {
  await requireSocietyMembership(ctx, args.societyId);
  await requireRolePortable(ctx, {
    actingUserId: args.actingUserId,
    societyId: args.societyId,
    required: "Director",
  });
  const { id, actingUserId, ...rest } = args;
  const now = new Date().toISOString();
  if (id) {
    await getOwned(ctx, "operatingSubscriptions", id, args.societyId);
    await ctx.db.patch(id, { ...rest, updatedAtISO: now });
    return id;
  }
  return await ctx.db.insert("operatingSubscriptions", {
    ...rest,
    createdAtISO: now,
    updatedAtISO: now,
  });
}

export async function removeOperatingSubscriptionPortable(
  ctx: PortableMutationCtx,
  { id, actingUserId }: { id: string; actingUserId?: string },
) {
  const row = await ctx.db.get(id, "operatingSubscriptions");
  if (!row) return;
  await requireSocietyMembership(ctx, String(row.societyId));
  await requireRolePortable(ctx, { actingUserId, societyId: String(row.societyId), required: "Director" });
  await getOwned(ctx, "operatingSubscriptions", id, String(row.societyId));
  await ctx.db.delete(id);
}

export async function removeBudgetPortable(
  ctx: PortableMutationCtx,
  { id, actingUserId }: { id: string; actingUserId?: string },
) {
  const row = await ctx.db.get(id, "budgets");
  if (!row) return;
  await requireSocietyMembership(ctx, String(row.societyId));
  await requireRolePortable(ctx, { actingUserId, societyId: String(row.societyId), required: "Director" });
  await getOwned(ctx, "budgets", id, String(row.societyId));
  await ctx.db.delete(id);
}

export async function getConnectionPortable(ctx: PortableQueryCtx, { id }: { id: string }) {
  const connection = await ctx.db.get(id, "financialConnections");
  if (!connection) return null;
  await requireSocietyMembership(ctx, String(connection.societyId));
  return getOwned(ctx, "financialConnections", id, String(connection.societyId));
}

// Edit a single imported/synced transaction. Only the user-correctable fields
// (date, description, category, counterparty, amount, notes and the receipt
// document) are patchable; the account binding and external/source
// identifiers stay immutable. The receipt status follows the receipt document.
// A change that re-posts the journal entry (category, amount, date) is refused
// when that entry is dated on or before the books close date, or would move there.
// `spendBudgetId` charges a money-out line to an active spend budget (null clears it).
export async function updateTransactionPortable(
  ctx: PortableMutationCtx,
  {
    id,
    patch,
    actingUserId,
  }: {
    id: string;
    patch: {
      date?: string;
      description?: string;
      category?: string;
      counterparty?: string;
      amountCents?: number;
      memo?: string;
      /** A document id attaches it as the receipt; null removes the receipt. */
      receiptDocumentId?: string | null;
      spendBudgetId?: string | null;
    };
    actingUserId?: string;
  },
) {
  const row = await ctx.db.get(id, "financialTransactions");
  if (!row) throw new Error("Transaction not found.");
  await requireSocietyMembership(ctx, String(row.societyId));
  await requireRolePortable(ctx, { actingUserId, societyId: String(row.societyId), required: "Director" });
  await getOwned(ctx, "financialTransactions", id, String(row.societyId));
  const { receiptDocumentId, memo, spendBudgetId, ...rest } = patch;
  if (patch.category !== undefined && patch.category !== row.category && isSplitTransaction({ lines: row.lines })) {
    throw new Error("This transaction is split into lines. Change the categories on its lines in the transaction panel.");
  }
  if (patch.amountCents !== undefined && patch.amountCents !== row.amountCents && isSplitTransaction({ lines: row.lines })) {
    throw new Error("This transaction is split into lines. Change the line amounts in the transaction panel so they still add up to the total.");
  }
  if (patch.category !== undefined || patch.amountCents !== undefined || patch.date !== undefined) {
    await assertTransactionBooksOpen(ctx, String(row.societyId), id, patch.date);
  }
  const next: Record<string, unknown> = { ...rest };
  if (spendBudgetId !== undefined) {
    if (spendBudgetId) {
      await requireBudgetForTransaction(ctx, String(row.societyId), spendBudgetId, { amountCents: patch.amountCents ?? row.amountCents, date: patch.date ?? row.date, matchedKind: row.matchedKind, matchedId: row.matchedId });
      next.spendBudgetId = spendBudgetId;
    } else {
      next.spendBudgetId = undefined;
    }
  }
  if (memo !== undefined) {
    const trimmed = String(memo).trim();
    if (trimmed.length > 2000) throw new Error("Keep notes under 2,000 characters.");
    next.memo = trimmed || undefined;
  }
  if (receiptDocumentId !== undefined) {
    if (receiptDocumentId) {
      await getOwned(ctx, "documents", receiptDocumentId, String(row.societyId));
      next.receiptDocumentId = receiptDocumentId;
      next.receiptStatus = "attached";
    } else {
      next.receiptDocumentId = undefined;
      next.receiptStatus = "missing";
    }
  }
  // A hand-edited category replaces any rule provenance.
  const provenance = patch.category !== undefined && patch.category !== row.category
    ? { categorizedBy: "manual", ruleId: undefined, ruleApplication: undefined }
    : {};
  await ctx.db.patch(id, { ...next, ...provenance });
  // A receipt removed or replaced here no longer matches its inbox item.
  if (receiptDocumentId !== undefined) await releaseInboxMatches(ctx, id, receiptDocumentId || undefined);
  // A posted transaction's journal entry follows a new category, amount or date.
  if (patch.category !== undefined || patch.amountCents !== undefined || patch.date !== undefined) {
    await createTransactionJournalSync(ctx, String(row.societyId))(id);
  }
  return id;
}

/** Most transactions one bulk edit (or its undo) may touch. */
export const BULK_TRANSACTION_LIMIT = 500;

const BULK_SNAPSHOT_FIELDS = [...RULE_TOUCHED_FIELDS, "ruleApplication", "lines", "tagIds", "spendBudgetId"] as const;

/** A row's values for every field a bulk edit, a line edit or a tag change can touch (for Undo). */
export function snapshotBulkFields(row: Record<string, unknown>): Record<string, unknown> {
  const values: Record<string, unknown> = snapshotRuleFields(row);
  for (const field of ["ruleApplication", "lines", "tagIds", "spendBudgetId"] as const) {
    if (row[field] !== undefined && row[field] !== null) values[field] = row[field];
  }
  return values;
}

/**
 * Apply one change to several transactions (the bulk island on the
 * transactions table): set a category, assign a fund (null clears it) or mark
 * reviewed (`reviewed: false` puts lines back in the review queue). Returns
 * each changed line's previous values so the client can offer Undo through
 * `restoreTransactions`. Lines from another organization are only counted as
 * skipped, never named. A category is not forced onto a split transaction
 * (its lines keep their categories); those are counted in `splitSkipped`.
 * A category or fund change to a transaction whose journal entry is dated on
 * or before the books close date (or in a closed fiscal period) is skipped
 * and counted in `skippedLocked`; the transaction is left as it was.
 * `spendBudgetId` charges money-out lines to an active spend budget (null
 * clears it); lines the budget can't take (money in, outside its dates, a
 * claim payout it already counts) are counted in `budgetSkipped`.
 */
export async function bulkUpdateTransactionsPortable(
  ctx: PortableMutationCtx,
  {
    societyId,
    ids,
    patch,
    actingUserId,
  }: {
    societyId: string;
    ids: string[];
    patch: { category?: string; fundRestrictionId?: string | null; reviewed?: boolean; spendBudgetId?: string | null };
    actingUserId?: string;
  },
) {
  await requireSocietyMembership(ctx, societyId);
  await requireRolePortable(ctx, { actingUserId, societyId, required: "Director" });
  const unique = [...new Set(ids.map(String))];
  if (unique.length === 0) throw new Error("Select at least one transaction.");
  if (unique.length > BULK_TRANSACTION_LIMIT) throw new Error(`Edit at most ${BULK_TRANSACTION_LIMIT} transactions at once.`);
  const category = patch.category === undefined ? undefined : String(patch.category).trim();
  if (patch.category !== undefined && !category) throw new Error("Choose a category.");
  if (category === undefined && patch.fundRestrictionId === undefined && patch.reviewed === undefined && patch.spendBudgetId === undefined) throw new Error("Nothing to change.");
  if (patch.fundRestrictionId) await getOwned(ctx, "fundRestrictions", patch.fundRestrictionId, societyId);
  if (patch.spendBudgetId) await getOwned(ctx, "spendBudgets", patch.spendBudgetId, societyId);
  const nowISO = new Date().toISOString();
  const previous: Array<{ id: string; values: Record<string, unknown> }> = [];
  const sync = createTransactionJournalSync(ctx, societyId);
  const lockedByBooks = createTransactionBooksLock(ctx, societyId);
  let skipped = 0;
  let splitSkipped = 0;
  let skippedLocked = 0;
  let budgetSkipped = 0;
  for (const id of unique) {
    const row: any = await ctx.db.get(id, "financialTransactions");
    if (!row || String(row.societyId) !== String(societyId)) {
      skipped += 1;
      continue;
    }
    const values = snapshotBulkFields(row);
    const next: Record<string, unknown> = {};
    const split = isSplitTransaction(row);
    if (category !== undefined && category !== row.category) {
      if (split) splitSkipped += 1;
      else Object.assign(next, { category, categorizedBy: "manual", ruleId: undefined, ruleApplication: undefined });
    }
    if (patch.fundRestrictionId !== undefined) {
      const fund = patch.fundRestrictionId || undefined;
      if (split) {
        const lines = (row.lines as Array<{ fundRestrictionId?: string }>).map((line) => ({ ...line, fundRestrictionId: fund }));
        if (lines.some((line, index) => line.fundRestrictionId !== row.lines[index].fundRestrictionId)) Object.assign(next, { lines, fundRestrictionId: fund });
      } else if (fund !== row.fundRestrictionId) {
        next.fundRestrictionId = fund;
      }
    }
    if (patch.spendBudgetId !== undefined && String(patch.spendBudgetId ?? "") !== String(row.spendBudgetId ?? "")) {
      if (!patch.spendBudgetId) next.spendBudgetId = undefined;
      else {
        try {
          await requireBudgetForTransaction(ctx, societyId, patch.spendBudgetId, row);
          next.spendBudgetId = patch.spendBudgetId;
        } catch {
          budgetSkipped += 1;
        }
      }
    }
    if (patch.reviewed && !row.reviewedAtISO) next.reviewedAtISO = nowISO;
    if (patch.reviewed === false && row.reviewedAtISO) next.reviewedAtISO = undefined;
    if (Object.keys(next).length === 0) continue;
    const reposts = "category" in next || "fundRestrictionId" in next;
    if (reposts && (await lockedByBooks(String(row._id)))) {
      skippedLocked += 1;
      continue;
    }
    if (reposts) {
      if (!(await patchTransactionWithJournal(ctx, sync, row, next))) {
        skippedLocked += 1;
        continue;
      }
    } else {
      await ctx.db.patch(row._id, next);
    }
    previous.push({ id: String(row._id), values });
  }
  return { updated: previous.length, skipped, splitSkipped, skippedLocked, budgetSkipped, previous };
}

/**
 * Undo a bulk edit: put back the snapshot `bulkUpdateTransactions` returned.
 * Transactions whose journal entry is now on or before the books close date
 * (or in a closed fiscal period) are left as they are and counted in
 * `skippedLocked`.
 */
export async function restoreTransactionsPortable(
  ctx: PortableMutationCtx,
  {
    societyId,
    rows,
    actingUserId,
  }: {
    societyId: string;
    rows: Array<{ id: string; values: Record<string, unknown> }>;
    actingUserId?: string;
  },
) {
  await requireSocietyMembership(ctx, societyId);
  await requireRolePortable(ctx, { actingUserId, societyId, required: "Director" });
  if (rows.length > BULK_TRANSACTION_LIMIT) throw new Error(`Restore at most ${BULK_TRANSACTION_LIMIT} transactions at once.`);
  let restored = 0;
  let skipped = 0;
  let skippedLocked = 0;
  const sync = createTransactionJournalSync(ctx, societyId);
  const lockedByBooks = createTransactionBooksLock(ctx, societyId);
  for (const entry of rows) {
    const row: any = await ctx.db.get(String(entry.id), "financialTransactions");
    if (!row || String(row.societyId) !== String(societyId)) {
      skipped += 1;
      continue;
    }
    if (await lockedByBooks(String(row._id))) {
      skippedLocked += 1;
      continue;
    }
    const values = entry.values ?? {};
    if (values.fundRestrictionId) await getOwned(ctx, "fundRestrictions", String(values.fundRestrictionId), societyId);
    if (values.accountingAccountId) await getOwned(ctx, "financialAccounts", String(values.accountingAccountId), societyId);
    if (values.spendBudgetId) await getOwned(ctx, "spendBudgets", String(values.spendBudgetId), societyId);
    if (values.ruleId && !(await ctx.db.get(String(values.ruleId), "transactionRules"))) delete (values as any).ruleId;
    if (values.ruleId) await getOwned(ctx, "transactionRules", String(values.ruleId), societyId);
    // Restored lines must still add up and point at this organization's records.
    const lines = Array.isArray(values.lines) ? (values.lines as Array<Record<string, unknown>>) : [];
    if (lines.length && lines.reduce((sum, line) => sum + Number(line.amountCents), 0) !== row.amountCents) throw new Error("The saved lines no longer add up to this transaction.");
    for (const line of lines) {
      if (line.accountingAccountId) await getOwned(ctx, "financialAccounts", String(line.accountingAccountId), societyId);
      if (line.fundRestrictionId) await getOwned(ctx, "fundRestrictions", String(line.fundRestrictionId), societyId);
    }
    const restoredTags = [...(Array.isArray(values.tagIds) ? values.tagIds : []), ...lines.flatMap((line) => (Array.isArray(line.tagIds) ? line.tagIds : []))];
    for (const tagId of new Set(restoredTags.map(String))) await getOwned(ctx, "financeTags", tagId, societyId);
    const patch: Record<string, unknown> = {};
    for (const field of BULK_SNAPSHOT_FIELDS) patch[field] = values[field] ?? undefined;
    if (!(await patchTransactionWithJournal(ctx, sync, row, patch))) {
      skippedLocked += 1;
      continue;
    }
    restored += 1;
  }
  return { restored, skipped, skippedLocked };
}

// A small derived query for the dashboard — balances by purpose/category.
// Prefers balances computed from posted journal lines (the durable double-entry
// ledger) where an account has any, falling back to the imported balanceCents.
export async function summaryPortable(ctx: PortableQueryCtx, { societyId }: { societyId: string }) {
  await requireSocietyMembership(ctx, societyId);
  const [accounts, transactions, budgets, journalEntries, journalLines] = await Promise.all([
    ctx.db.query("financialAccounts").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect(),
    ctx.db.query("financialTransactions").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect(),
    ctx.db.query("budgets").withIndex("by_society_fy", (q) => q.eq("societyId", societyId)).collect(),
    ctx.db.query("journalEntries").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect(),
    ctx.db.query("journalLines").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect(),
  ]);

  const ledger = computeLedgerBalances(accounts, journalEntries, journalLines);
  const effectiveBalance = (a: any) => {
    const entry = ledger.get(String(a._id));
    return entry && entry.hasPostedLines ? entry.postedBalanceCents : a.balanceCents;
  };
  const isLedgerBacked = (a: any) => ledger.get(String(a._id))?.hasPostedLines === true;

  const bank = accounts.filter((a) => a.accountType === "Bank" || a.accountType === "Credit");
  const totalBalance = bank.reduce((sum, a) => sum + effectiveBalance(a), 0);
  const restricted = bank.filter((a) => a.isRestricted);
  const unrestricted = totalBalance - restricted.reduce((sum, a) => sum + effectiveBalance(a), 0);

  // Budget vs actuals covers one fiscal year: the budgeted year containing
  // today (else the latest budgeted year), with actuals from that year's
  // window only, the same rule as treasury.budgetVariance.
  const society: any = await ctx.db.get(societyId, "societies");
  const today = todayDateOnly();
  const categoryBudgets = budgets.filter((b: any) => !b.programCode && !b.accountId);
  const budgetYears = [...new Set(categoryBudgets.map((b: any) => String(b.fiscalYear)))]
    .map((label) => ({ label, ...fiscalWindow(label, society?.fiscalYearEnd) }))
    .sort((a, b) => b.end.localeCompare(a.end));
  const budgetYear = budgetYears.find((year) => year.start <= today && today <= year.end) ?? budgetYears[0];
  const actualsByCategory: Record<string, number> = {};
  for (const t of transactions) {
    if (!budgetYear || t.date < budgetYear.start || t.date > budgetYear.end) continue;
    // A split transaction counts each line toward its own category.
    for (const { category, amountCents } of categoryAmounts({ amountCents: t.amountCents, category: t.category, lines: t.lines })) {
      if (!category) continue;
      actualsByCategory[category] = (actualsByCategory[category] ?? 0) + Math.abs(amountCents);
    }
  }

  const budgetRows = categoryBudgets.filter((b: any) => String(b.fiscalYear) === budgetYear?.label).map((b) => ({
    ...b,
    actualCents: actualsByCategory[b.category] ?? 0,
  }));

  return {
    totalBalance,
    unrestricted,
    // How many bank/credit accounts are now reading from the posted ledger
    // vs the imported balance — lets the UI show ledger coverage.
    ledgerBackedAccounts: bank.filter(isLedgerBacked).length,
    bankAccountCount: bank.length,
    restrictedAccounts: restricted.map((a) => ({
      name: a.name,
      balanceCents: effectiveBalance(a),
      purpose: a.restrictedPurpose,
      ledgerBacked: isLedgerBacked(a),
    })),
    budgetRows,
    budgetFiscalYear: budgetYear?.label ?? null,
    recentTransactions: transactions
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 10),
  };
}
