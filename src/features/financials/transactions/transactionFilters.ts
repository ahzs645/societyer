import { isUncategorized } from "../../../../shared/transactionRules";
import { isSplitTransaction, transactionHasTag, type TransactionLine } from "../../../../shared/transactionLines";

/**
 * The transactions tab's own filters, applied before the record table's:
 * the To review / Reviewed queue, how a line was categorised, and a tag.
 * Kept in the URL (`review`, `method`, `tag`) so a filtered list can be
 * linked and survives a reload. Pure, so the gate script runs it too.
 */

export type ReviewSegment = "to_review" | "reviewed";

export type CategorisationMethod = "rule" | "auto" | "manual" | "matched" | "uncategorised";

export const CATEGORISATION_METHOD_OPTIONS: ReadonlyArray<{ value: CategorisationMethod; label: string; hint: string }> = [
  { value: "rule", label: "Rule", hint: "Categorised by one of your rules" },
  { value: "auto", label: "Suggestion / auto", hint: "Suggested, or categorised by the bank feed or sync" },
  { value: "manual", label: "Manual", hint: "Categorised or split by hand" },
  { value: "matched", label: "Matched", hint: "Matched to a receipt, invoice, claim, payroll run or filing" },
  { value: "uncategorised", label: "Uncategorised", hint: "No category yet" },
];

export type FilterableTransaction = {
  amountCents: number;
  category?: string | null;
  categorizedBy?: string | null;
  matchedKind?: string | null;
  reviewedAtISO?: string | null;
  tagIds?: readonly string[] | null;
  lines?: readonly TransactionLine[] | null;
};

export type TransactionFilterState = {
  review: ReviewSegment;
  method?: CategorisationMethod;
  tagId?: string;
};

export function reviewSegmentOf(txn: Pick<FilterableTransaction, "reviewedAtISO">): ReviewSegment {
  return txn.reviewedAtISO ? "reviewed" : "to_review";
}

/** Every method that describes the line (a rule-categorised line can also be matched). */
export function categorisationMethods(txn: FilterableTransaction): CategorisationMethod[] {
  const methods: CategorisationMethod[] = [];
  const uncategorised = isUncategorized(txn) && !isSplitTransaction(txn);
  if (uncategorised) methods.push("uncategorised");
  if (txn.categorizedBy === "rule") methods.push("rule");
  else if (txn.categorizedBy === "manual") methods.push("manual");
  else if (txn.categorizedBy === "suggestion" || (!uncategorised && (!txn.categorizedBy || txn.categorizedBy === "imported"))) methods.push("auto");
  // "manual" matches are lines cleared against the bank statement, not a record.
  if (txn.matchedKind && txn.matchedKind !== "manual") methods.push("matched");
  return methods;
}

export function matchesTransactionFilters(txn: FilterableTransaction, state: TransactionFilterState, options: { ignoreReview?: boolean } = {}): boolean {
  if (!options.ignoreReview && reviewSegmentOf(txn) !== state.review) return false;
  if (state.method && !categorisationMethods(txn).includes(state.method)) return false;
  if (state.tagId && !transactionHasTag(txn, state.tagId)) return false;
  return true;
}

export function filterTransactions<T extends FilterableTransaction>(rows: readonly T[], state: TransactionFilterState): T[] {
  return rows.filter((row) => matchesTransactionFilters(row, state));
}

/** How many rows each queue holds under the other filters (for the segment labels). */
export function reviewCounts(rows: readonly FilterableTransaction[], state: TransactionFilterState): Record<ReviewSegment, number> {
  const counts: Record<ReviewSegment, number> = { to_review: 0, reviewed: 0 };
  for (const row of rows) if (matchesTransactionFilters(row, state, { ignoreReview: true })) counts[reviewSegmentOf(row)] += 1;
  return counts;
}

const METHOD_VALUES = new Set<string>(CATEGORISATION_METHOD_OPTIONS.map((option) => option.value));

export function readTransactionFilters(params: URLSearchParams): TransactionFilterState {
  const method = params.get("method");
  const tagId = params.get("tag");
  return {
    review: params.get("review") === "reviewed" ? "reviewed" : "to_review",
    ...(method && METHOD_VALUES.has(method) ? { method: method as CategorisationMethod } : {}),
    ...(tagId ? { tagId } : {}),
  };
}

/** The search params with `state` written in (defaults are left out of the URL). */
export function withTransactionFilters(params: URLSearchParams, state: TransactionFilterState): URLSearchParams {
  const next = new URLSearchParams(params);
  if (state.review === "reviewed") next.set("review", "reviewed");
  else next.delete("review");
  if (state.method) next.set("method", state.method);
  else next.delete("method");
  if (state.tagId) next.set("tag", state.tagId);
  else next.delete("tag");
  return next;
}
