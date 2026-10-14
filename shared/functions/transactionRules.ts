/**
 * PORTABLE FUNCTIONS: transaction categorisation rules
 * (workspace / upsert / remove / reorder / setEnabled / applyToUncategorized /
 * undoBatch / removeApplication).
 *
 * Rules live in `transactionRules`; applying one stamps provenance
 * (`categorizedBy: "rule"`, `ruleId`, `ruleApplication`) on the
 * `financialTransactions` row together with a snapshot of what it replaced so
 * a batch, or a single application, can be undone exactly.
 */

import type { PortableMutationCtx, PortableQueryCtx } from "../portable/ctx";
import { getOwned, principalUserId, requireOwnedRow, requireSocietyMembership } from "./access";
import {
  conditionMatches,
  findMatchingRule,
  isUncategorized,
  restoreRuleFieldsPatch,
  rulePatchForTransaction,
  sortRules,
  suggestStarterRules,
  validateRule,
  type RuleActions,
  type RuleCondition,
  type TransactionRuleLike,
} from "../transactionRules";

type RuleRow = TransactionRuleLike & { _id: string; societyId: string; [key: string]: any };

async function loadRules(ctx: PortableQueryCtx, societyId: string): Promise<RuleRow[]> {
  const rows = await ctx.db
    .query<RuleRow>("transactionRules")
    .withIndex("by_society", (q) => q.eq("societyId", societyId))
    .collect();
  return sortRules(rows.map((row) => ({ ...row, conditions: (row.conditions ?? []) as RuleCondition[], actions: (row.actions ?? {}) as RuleActions })));
}

async function loadTransactions(ctx: PortableQueryCtx, societyId: string) {
  return ctx.db
    .query("financialTransactions")
    .withIndex("by_society", (q) => q.eq("societyId", societyId))
    .collect();
}

/** Normalise client conditions to the stored shape (drop fields a condition type does not use). */
function cleanConditions(conditions: any[]): RuleCondition[] {
  return (conditions ?? []).map((raw) => {
    const field = String(raw?.field ?? "");
    if (field === "description" || field === "payee") {
      return { field, operator: (raw.operator ?? "contains") as any, value: String(raw.value ?? "").trim() };
    }
    if (field === "amount") {
      const condition: any = { field, operator: raw.operator ?? "gte", amountCents: Math.round(Number(raw.amountCents)) };
      if (raw.operator === "between") condition.amountMaxCents = Math.round(Number(raw.amountMaxCents));
      return condition;
    }
    if (field === "direction") return { field, value: raw.value === "in" ? "in" : "out" };
    if (field === "account") return { field, accountId: String(raw.accountId ?? "") };
    return { field } as any;
  });
}

function cleanActions(actions: any): RuleActions {
  const out: RuleActions = {};
  if (typeof actions?.category === "string" && actions.category.trim()) out.category = actions.category.trim();
  if (actions?.accountingAccountId) out.accountingAccountId = String(actions.accountingAccountId);
  if (actions?.fundRestrictionId) out.fundRestrictionId = String(actions.fundRestrictionId);
  if (actions?.markReviewed) out.markReviewed = true;
  return out;
}

async function assertRuleReferences(ctx: PortableQueryCtx, societyId: string, conditions: RuleCondition[], actions: RuleActions) {
  for (const condition of conditions) {
    if (condition.field === "account") await getOwned(ctx, "financialAccounts", condition.accountId, societyId);
  }
  if (actions.accountingAccountId) await getOwned(ctx, "financialAccounts", actions.accountingAccountId, societyId);
  if (actions.fundRestrictionId) await getOwned(ctx, "fundRestrictions", actions.fundRestrictionId, societyId);
}

/** Everything the rules page needs: rules with live match counts, a light
 * transaction list for client-side previews, pick lists and starter rules. */
export async function workspacePortable(ctx: PortableQueryCtx, { societyId }: { societyId: string }) {
  await requireSocietyMembership(ctx, societyId);
  const [rules, txns, accounts, restrictions] = await Promise.all([
    loadRules(ctx, societyId),
    loadTransactions(ctx, societyId),
    ctx.db.query("financialAccounts").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect(),
    ctx.db.query("fundRestrictions").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect(),
  ]);
  const transactions = txns
    .map((t: any) => ({
      _id: String(t._id),
      date: t.date,
      description: t.description,
      counterparty: t.counterparty,
      amountCents: t.amountCents,
      accountId: t.accountId ? String(t.accountId) : undefined,
      category: t.category,
      categorizedBy: t.categorizedBy,
      ruleId: t.ruleId ? String(t.ruleId) : undefined,
    }))
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const uncategorized = transactions.filter((t) => isUncategorized(t));
  const firstMatch = new Map<string, number>();
  for (const txn of uncategorized) {
    const rule = findMatchingRule(rules, txn);
    if (rule) firstMatch.set(rule._id, (firstMatch.get(rule._id) ?? 0) + 1);
  }
  const appliedCount = new Map<string, number>();
  for (const txn of transactions) if (txn.ruleId) appliedCount.set(txn.ruleId, (appliedCount.get(txn.ruleId) ?? 0) + 1);
  const categories = [...new Set(transactions.map((t) => String(t.category ?? "").trim()).filter((c) => c && !isUncategorized({ category: c })))].sort((a, b) => a.localeCompare(b));
  return {
    rules: rules.map((rule) => ({
      ...rule,
      matchCount: transactions.filter((t) => rule.conditions.length > 0 && rule.conditions.every((c) => conditionMatches(c, t))).length,
      pendingCount: firstMatch.get(rule._id) ?? 0,
      appliedCount: appliedCount.get(rule._id) ?? 0,
    })),
    transactions,
    uncategorizedCount: uncategorized.length,
    pendingMatches: [...firstMatch.values()].reduce((sum, n) => sum + n, 0),
    categories,
    accounts: accounts
      .map((a: any) => ({ _id: String(a._id), name: a.name, code: a.code, accountType: a.accountType, isRestricted: Boolean(a.isRestricted) }))
      .sort((a, b) => String(a.code ?? a.name).localeCompare(String(b.code ?? b.name))),
    fundRestrictions: restrictions
      .filter((r: any) => r.status !== "archived")
      .map((r: any) => ({ _id: String(r._id), name: r.name, purpose: r.purpose })),
    suggestions: suggestStarterRules(transactions, rules, 3),
  };
}

export async function upsertPortable(
  ctx: PortableMutationCtx,
  args: { id?: string; societyId: string; name: string; enabled?: boolean; conditions: any[]; actions: any; actingUserId?: string },
) {
  await requireSocietyMembership(ctx, args.societyId);
  const conditions = cleanConditions(args.conditions);
  const actions = cleanActions(args.actions);
  const errors = validateRule({ name: args.name, conditions, actions });
  if (errors.length) throw new Error(errors[0]);
  await assertRuleReferences(ctx, args.societyId, conditions, actions);
  const nowISO = new Date().toISOString();
  if (args.id) {
    await getOwned(ctx, "transactionRules", args.id, args.societyId);
    await ctx.db.patch(args.id, {
      name: args.name.trim(),
      ...(args.enabled === undefined ? {} : { enabled: args.enabled }),
      conditions,
      actions,
      updatedAtISO: nowISO,
    });
    return args.id;
  }
  const existing = await loadRules(ctx, args.societyId);
  const priority = existing.reduce((max, rule) => Math.max(max, rule.priority), 0) + 1;
  return ctx.db.insert("transactionRules", {
    societyId: args.societyId,
    name: args.name.trim(),
    priority,
    enabled: args.enabled ?? true,
    conditions,
    actions,
    createdByUserId: await principalUserId(ctx, args.societyId).catch(() => undefined),
    createdAtISO: nowISO,
    updatedAtISO: nowISO,
  });
}

export async function removePortable(ctx: PortableMutationCtx, { id }: { id: string }) {
  const rule = await requireOwnedRow<RuleRow>(ctx, "transactionRules", id);
  await ctx.db.delete(id);
  // Keep priorities contiguous.
  const rest = await loadRules(ctx, rule.societyId);
  for (const [index, row] of rest.entries()) {
    if (row.priority !== index + 1) await ctx.db.patch(row._id, { priority: index + 1 });
  }
}

export async function reorderPortable(ctx: PortableMutationCtx, { societyId, orderedIds }: { societyId: string; orderedIds: string[] }) {
  await requireSocietyMembership(ctx, societyId);
  const rules = await loadRules(ctx, societyId);
  const known = new Set(rules.map((rule) => rule._id));
  if (orderedIds.length !== rules.length || orderedIds.some((id) => !known.has(id)) || new Set(orderedIds).size !== orderedIds.length) {
    throw new Error("The rule list changed. Refresh and try again.");
  }
  const nowISO = new Date().toISOString();
  for (const [index, id] of orderedIds.entries()) {
    const rule = rules.find((row) => row._id === id)!;
    if (rule.priority !== index + 1) await ctx.db.patch(id, { priority: index + 1, updatedAtISO: nowISO });
  }
}

export async function setEnabledPortable(ctx: PortableMutationCtx, { id, enabled }: { id: string; enabled: boolean }) {
  await requireOwnedRow(ctx, "transactionRules", id);
  await ctx.db.patch(id, { enabled, updatedAtISO: new Date().toISOString() });
}

/** Apply rules to every uncategorised transaction (or only one rule's matches). */
export async function applyToUncategorizedPortable(
  ctx: PortableMutationCtx,
  { societyId, ruleId }: { societyId: string; ruleId?: string },
) {
  await requireSocietyMembership(ctx, societyId);
  if (ruleId) await getOwned(ctx, "transactionRules", ruleId, societyId);
  const [rules, txns] = await Promise.all([loadRules(ctx, societyId), loadTransactions(ctx, societyId)]);
  const nowISO = new Date().toISOString();
  const batchId = `apply-${nowISO}-${Math.random().toString(36).slice(2, 8)}`;
  const byRule = new Map<string, { ruleId: string; name: string; count: number }>();
  let applied = 0;
  for (const txn of txns as any[]) {
    const result = rulePatchForTransaction(rules, txn, nowISO, batchId);
    if (!result || (ruleId && result.rule._id !== ruleId)) continue;
    await ctx.db.patch(txn._id, result.patch);
    applied += 1;
    const entry = byRule.get(result.rule._id) ?? { ruleId: result.rule._id, name: result.rule.name, count: 0 };
    entry.count += 1;
    byRule.set(result.rule._id, entry);
  }
  for (const id of byRule.keys()) await ctx.db.patch(id, { lastAppliedAtISO: nowISO });
  return { batchId, applied, byRule: [...byRule.values()] };
}

/** Undo every application from one batch, restoring the previous values. */
// The batch key is named `batch` (not `batchId`): it is an opaque key, not a row reference.
export async function undoBatchPortable(ctx: PortableMutationCtx, { societyId, batch }: { societyId: string; batch: string }) {
  await requireSocietyMembership(ctx, societyId);
  const batchId = batch;
  if (!batchId) throw new Error("Nothing to undo.");
  const txns = await loadTransactions(ctx, societyId);
  let restored = 0;
  for (const txn of txns as any[]) {
    if (txn.ruleApplication?.batchId !== batchId) continue;
    await ctx.db.patch(txn._id, restoreRuleFieldsPatch(txn.ruleApplication.previous));
    restored += 1;
  }
  return { restored };
}

/** Remove a rule's application from one transaction. */
export async function removeApplicationPortable(ctx: PortableMutationCtx, { txnId }: { txnId: string }) {
  const txn = await requireOwnedRow<any>(ctx, "financialTransactions", txnId);
  if (txn.categorizedBy !== "rule") throw new Error("This transaction was not categorised by a rule.");
  await ctx.db.patch(txnId, restoreRuleFieldsPatch(txn.ruleApplication?.previous));
  return txnId;
}
