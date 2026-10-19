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
import { assertTransactionBooksOpen, createTransactionBooksLock, createTransactionJournalSync, patchTransactionWithJournal } from "./accounting";
import {
  autoRuleName,
  findApplicableRule,
  inValues,
  isUncategorized,
  restoreRuleFieldsPatch,
  ruleCoverage,
  ruleDisplayName,
  ruleMatches,
  rulePatchForTransaction,
  ruleReferenceIndex,
  ruleProblems,
  sortRules,
  suggestStarterRules,
  validateRule,
  type RuleActions,
  type RuleCondition,
  type RuleReferenceIndex,
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
      if (raw.operator === "in") return { field, operator: "in", value: "", values: inValues(Array.isArray(raw.values) ? raw.values : []) };
      return { field, operator: (raw.operator ?? "contains") as any, value: String(raw.value ?? "").trim() };
    }
    if (field === "category") return { field, value: String(raw.value ?? "").trim() };
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

async function loadReferences(ctx: PortableQueryCtx, societyId: string) {
  const [accounts, restrictions] = await Promise.all([
    ctx.db.query("financialAccounts").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect(),
    ctx.db.query("fundRestrictions").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect(),
  ]);
  const refs: RuleReferenceIndex = ruleReferenceIndex(accounts as any[], restrictions as any[]);
  const nameOf = (rows: any[]) => (id: string) => {
    const row = rows.find((r: any) => String(r._id) === String(id));
    return row ? String(row.name) : undefined;
  };
  return { accounts, restrictions, refs, textOptions: { accountName: nameOf(accounts), fundName: nameOf(restrictions) } };
}

/** Rules that point at a removed account or an archived fund, with the reasons. */
function invalidRules(rules: RuleRow[], refs: RuleReferenceIndex) {
  const out = new Map<string, string[]>();
  for (const rule of rules) {
    const problems = ruleProblems(rule, refs);
    if (problems.length) out.set(rule._id, problems);
  }
  return out;
}

/** Everything the rules page needs: rules with live match counts, overlap
 * (`coverage`) and `problems`, a light transaction list for client-side
 * previews, pick lists and starter rules. */
export async function workspacePortable(ctx: PortableQueryCtx, { societyId }: { societyId: string }) {
  await requireSocietyMembership(ctx, societyId);
  const [rules, txns, references] = await Promise.all([
    loadRules(ctx, societyId),
    loadTransactions(ctx, societyId),
    loadReferences(ctx, societyId),
  ]);
  const { accounts, restrictions, refs, textOptions } = references;
  const invalid = invalidRules(rules, refs);
  const skip = new Set(invalid.keys());
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
      // Split lines only matter as "this is a split": rules pass splits by.
      ...(Array.isArray(t.lines) && t.lines.length > 1 ? { lines: t.lines.map((line: { id: string }) => ({ id: line.id })) } : {}),
    }))
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const uncategorized = transactions.filter((t) => isUncategorized(t));
  const firstMatch = new Map<string, number>();
  for (const txn of transactions) {
    const rule = findApplicableRule(rules, txn, skip);
    if (rule) firstMatch.set(rule._id, (firstMatch.get(rule._id) ?? 0) + 1);
  }
  const coverage = ruleCoverage(rules, transactions, skip);
  const appliedCount = new Map<string, number>();
  for (const txn of transactions) if (txn.ruleId) appliedCount.set(txn.ruleId, (appliedCount.get(txn.ruleId) ?? 0) + 1);
  const categories = [...new Set(transactions.map((t) => String(t.category ?? "").trim()).filter((c) => c && !isUncategorized({ category: c })))].sort((a, b) => a.localeCompare(b));
  return {
    rules: rules.map((rule) => ({
      ...rule,
      name: ruleDisplayName(rule, textOptions),
      autoNamed: Boolean(rule.autoNamed) || !String(rule.name ?? "").trim(),
      matchCount: coverage[rule._id]?.matches ?? 0,
      pendingCount: firstMatch.get(rule._id) ?? 0,
      appliedCount: appliedCount.get(rule._id) ?? 0,
      coverage: coverage[rule._id],
      problems: invalid.get(rule._id) ?? [],
    })),
    invalidRuleCount: invalid.size,
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
    // Archived funds, so a rule that still tags one can name it and say it was archived (not removed).
    archivedFunds: restrictions.filter((r: any) => r.status === "archived").map((r: any) => ({ _id: String(r._id), name: r.name })),
    suggestions: suggestStarterRules(transactions, rules, 3),
  };
}

export async function upsertPortable(
  ctx: PortableMutationCtx,
  args: { id?: string; societyId: string; name?: string; enabled?: boolean; conditions: any[]; actions: any; actingUserId?: string },
) {
  await requireSocietyMembership(ctx, args.societyId);
  const conditions = cleanConditions(args.conditions);
  const actions = cleanActions(args.actions);
  const errors = validateRule({ name: args.name, conditions, actions });
  if (errors.length) throw new Error(errors[0]);
  await assertRuleReferences(ctx, args.societyId, conditions, actions);
  // A blank name is generated from the rule ("Coastal Hydro → Facilities")
  // and regenerated on every save until someone types a name.
  const typedName = String(args.name ?? "").trim();
  const autoNamed = !typedName;
  const name = typedName || autoRuleName(conditions, actions, (await loadReferences(ctx, args.societyId)).textOptions);
  const nowISO = new Date().toISOString();
  if (args.id) {
    await getOwned(ctx, "transactionRules", args.id, args.societyId);
    await ctx.db.patch(args.id, {
      name,
      autoNamed,
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
    name,
    autoNamed,
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

/** Apply rules to every uncategorised transaction (or only one rule's
 * matches), plus "category is" re-codes of lines that are not hand-categorised.
 * Invalid rules are skipped and listed in `skippedRules`. */
export async function applyToUncategorizedPortable(
  ctx: PortableMutationCtx,
  { societyId, ruleId }: { societyId: string; ruleId?: string },
) {
  await requireSocietyMembership(ctx, societyId);
  if (ruleId) await getOwned(ctx, "transactionRules", ruleId, societyId);
  const [rules, txns, references] = await Promise.all([loadRules(ctx, societyId), loadTransactions(ctx, societyId), loadReferences(ctx, societyId)]);
  // Rules that point at a removed account or an archived fund are skipped
  // (and reported) rather than writing a dangling reference.
  const invalid = invalidRules(rules, references.refs);
  if (ruleId && invalid.has(ruleId)) {
    throw new Error(`This rule needs attention: ${invalid.get(ruleId)![0]}. Edit the rule before applying it.`);
  }
  const skip = new Set(invalid.keys());
  const skippedRules = rules
    .filter((rule) => rule.enabled && invalid.has(rule._id) && (!ruleId || rule._id === ruleId))
    .map((rule) => ({ name: ruleDisplayName(rule, references.textOptions), problem: invalid.get(rule._id)![0] }));
  const named = rules.map((rule) => ({ ...rule, name: ruleDisplayName(rule, references.textOptions) }));
  const nowISO = new Date().toISOString();
  const batchId = `apply-${nowISO}-${Math.random().toString(36).slice(2, 8)}`;
  const byRule = new Map<string, { ruleId: string; name: string; count: number }>();
  // A line already posted to suspense moves to the rule's category in the journal too.
  const sync = createTransactionJournalSync(ctx, societyId);
  // Lines whose journal entry is inside the books close date are left alone and counted.
  const lockedByBooks = createTransactionBooksLock(ctx, societyId);
  let applied = 0;
  let skippedLocked = 0;
  for (const txn of txns as any[]) {
    const result = rulePatchForTransaction(named, txn, nowISO, batchId, skip);
    if (!result || (ruleId && result.rule._id !== ruleId)) continue;
    if (await lockedByBooks(String(txn._id))) {
      skippedLocked += 1;
      continue;
    }
    if (!(await patchTransactionWithJournal(ctx, sync, txn, result.patch))) {
      skippedLocked += 1;
      continue;
    }
    applied += 1;
    const entry = byRule.get(result.rule._id) ?? { ruleId: result.rule._id, name: result.rule.name, count: 0 };
    entry.count += 1;
    byRule.set(result.rule._id, entry);
  }
  for (const id of byRule.keys()) await ctx.db.patch(id, { lastAppliedAtISO: nowISO });
  return { batchId, applied, byRule: [...byRule.values()], skippedRules, skippedLocked };
}

/**
 * Undo every application from one batch, restoring the previous values.
 * Lines whose journal entry is now inside the books close date (or a closed
 * fiscal period) keep the rule's values and are counted in `skippedLocked`.
 */
// The batch key is named `batch` (not `batchId`): it is an opaque key, not a row reference.
export async function undoBatchPortable(ctx: PortableMutationCtx, { societyId, batch }: { societyId: string; batch: string }) {
  await requireSocietyMembership(ctx, societyId);
  const batchId = batch;
  if (!batchId) throw new Error("Nothing to undo.");
  const txns = await loadTransactions(ctx, societyId);
  const sync = createTransactionJournalSync(ctx, societyId);
  const lockedByBooks = createTransactionBooksLock(ctx, societyId);
  let restored = 0;
  let skippedLocked = 0;
  for (const txn of txns as any[]) {
    if (txn.ruleApplication?.batchId !== batchId) continue;
    if (await lockedByBooks(String(txn._id))) {
      skippedLocked += 1;
      continue;
    }
    if (!(await patchTransactionWithJournal(ctx, sync, txn, restoreRuleFieldsPatch(txn.ruleApplication.previous)))) {
      skippedLocked += 1;
      continue;
    }
    restored += 1;
  }
  return { restored, skippedLocked };
}

/** Remove a rule's application from one transaction (refused inside the books close date or a closed fiscal period). */
export async function removeApplicationPortable(ctx: PortableMutationCtx, { txnId }: { txnId: string }) {
  const txn = await requireOwnedRow<any>(ctx, "financialTransactions", txnId);
  if (txn.categorizedBy !== "rule") throw new Error("This transaction was not categorised by a rule.");
  await assertTransactionBooksOpen(ctx, String(txn.societyId), txnId);
  // A single edit: a closed fiscal period refuses it (and leaves the transaction as it was).
  await patchTransactionWithJournal(ctx, createTransactionJournalSync(ctx, String(txn.societyId)), txn, restoreRuleFieldsPatch(txn.ruleApplication?.previous), { onLocked: "throw" });
  return txnId;
}
