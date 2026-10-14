/**
 * Payee rename rules ("payee aliases"): pure matching shared by the portable
 * handlers, the CSV import and the transactions UI.
 *
 * Bank feeds carry raw strings such as "E-TRANSFER DEPOSIT N AHMADI". An alias
 * maps a raw payee (matched exactly, or by text it contains, ignoring
 * capitals and extra spaces) to the name people want to read. Aliases are
 * applied when transactions are shown and when new lines are imported; the
 * raw bank description is never changed.
 */

import { normalizeRuleText, transactionPayee, type RuleTransaction } from "./transactionRules";

export type PayeeAliasMatchType = "exact" | "contains";

export type PayeeAliasLike = {
  _id?: string;
  match: string;
  matchType: PayeeAliasMatchType | string;
  displayName: string;
};

export const PAYEE_ALIAS_MATCH_LABELS: Record<PayeeAliasMatchType, string> = {
  exact: "is exactly",
  contains: "contains",
};

export const PAYEE_ALIAS_MAX_LENGTH = 120;

export function payeeAliasMatches(alias: PayeeAliasLike, rawPayee: string): boolean {
  const needle = normalizeRuleText(alias.match);
  if (!needle) return false;
  const haystack = normalizeRuleText(rawPayee);
  return alias.matchType === "contains" ? haystack.includes(needle) : haystack === needle;
}

/**
 * The alias for a raw payee. Exact aliases win over "contains" ones, and among
 * "contains" aliases the longest match text wins (the most specific rename).
 */
export function findPayeeAlias<T extends PayeeAliasLike>(aliases: readonly T[], rawPayee: string): T | null {
  let best: T | null = null;
  for (const alias of aliases) {
    if (!payeeAliasMatches(alias, rawPayee)) continue;
    if (!best) {
      best = alias;
      continue;
    }
    const bestExact = best.matchType !== "contains";
    const exact = alias.matchType !== "contains";
    if (exact && !bestExact) best = alias;
    else if (exact === bestExact && normalizeRuleText(alias.match).length > normalizeRuleText(best.match).length) best = alias;
  }
  return best;
}

/** The name to show for a transaction's payee: its alias, else the raw payee. */
export function payeeDisplayName(aliases: readonly PayeeAliasLike[], txn: RuleTransaction): string {
  const raw = transactionPayee(txn);
  return findPayeeAlias(aliases, raw)?.displayName ?? raw;
}

/** How many transactions an alias would rename (for the preview count). */
export function countPayeeAliasMatches(alias: PayeeAliasLike, transactions: readonly RuleTransaction[]): number {
  let count = 0;
  for (const txn of transactions) if (payeeAliasMatches(alias, transactionPayee(txn))) count += 1;
  return count;
}

export function validatePayeeAlias(input: { match?: string; matchType?: string; displayName?: string }): string[] {
  const errors: string[] = [];
  const match = String(input.match ?? "").trim();
  const displayName = String(input.displayName ?? "").trim();
  if (!match) errors.push("Enter the payee text to match.");
  if (!displayName) errors.push("Enter the name to show.");
  if (match.length > PAYEE_ALIAS_MAX_LENGTH || displayName.length > PAYEE_ALIAS_MAX_LENGTH) {
    errors.push(`Keep names under ${PAYEE_ALIAS_MAX_LENGTH} characters.`);
  }
  if (input.matchType !== "exact" && input.matchType !== "contains") errors.push("Choose how the payee is matched.");
  if (match && displayName && normalizeRuleText(match) === normalizeRuleText(displayName) && input.matchType === "exact") {
    errors.push("The new name is the same as the payee.");
  }
  return errors;
}

/** Import-time rename: the counterparty to store for a new line, or undefined to keep it. */
export function aliasedCounterparty(aliases: readonly PayeeAliasLike[], row: RuleTransaction): string | undefined {
  const alias = findPayeeAlias(aliases, transactionPayee(row));
  return alias ? alias.displayName : undefined;
}
