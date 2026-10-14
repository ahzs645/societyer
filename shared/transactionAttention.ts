import { isUncategorized } from "./transactionRules";

/**
 * Money out at or above this needs a receipt before the line stops asking for
 * attention. Smaller purchases (bank fees, transit fares) are left alone.
 */
export const RECEIPT_ATTENTION_THRESHOLD_CENTS = 75_00;

export type AttentionReason = "uncategorized" | "receipt" | "unreviewed";

export type CategorizedByValue = "rule" | "suggestion" | "manual" | "imported";

export type AttentionTransaction = {
  amountCents: number;
  category?: string | null;
  categorizedBy?: string | null;
  receiptStatus?: string | null;
  receiptDocumentId?: string | null;
  reviewedAtISO?: string | null;
  reconciledAtISO?: string | null;
};

/** How the category was set; a category with no stamp came in with the import. */
export function categorizedByValue(txn: AttentionTransaction): CategorizedByValue | undefined {
  const stamp = txn.categorizedBy;
  if (stamp === "rule" || stamp === "suggestion" || stamp === "manual") return stamp;
  return isUncategorized(txn) ? undefined : "imported";
}

export function needsReceipt(txn: AttentionTransaction): boolean {
  if (txn.receiptDocumentId || txn.receiptStatus !== "missing") return false;
  return txn.amountCents <= -RECEIPT_ATTENTION_THRESHOLD_CENTS;
}

/**
 * Why a line needs someone: no category, a missing receipt on a larger
 * payment, or a category set automatically (rule or suggestion) that nobody
 * has reviewed and that isn't reconciled yet.
 */
export function attentionReasons(txn: AttentionTransaction): AttentionReason[] {
  const reasons: AttentionReason[] = [];
  if (isUncategorized(txn)) reasons.push("uncategorized");
  if (needsReceipt(txn)) reasons.push("receipt");
  const automatic = txn.categorizedBy === "rule" || txn.categorizedBy === "suggestion";
  if (automatic && !txn.reviewedAtISO && !txn.reconciledAtISO) reasons.push("unreviewed");
  return reasons;
}

export const ATTENTION_LABELS: Record<AttentionReason, string> = {
  uncategorized: "No category",
  receipt: "Receipt missing",
  unreviewed: "Not reviewed",
};

export const CATEGORIZED_BY_LABELS: Record<CategorizedByValue, string> = {
  rule: "Rule",
  suggestion: "Suggested",
  manual: "Manual",
  imported: "Imported",
};
