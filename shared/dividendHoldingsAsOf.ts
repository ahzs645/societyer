/**
 * Dividend helpers over the share ledger's as-of holdings
 * (`holdingsAsOf` in shared/equityLedger.ts).
 */

import { holdingsAsOf as ledgerHoldingsAsOf, type CurrentHolding, type RightsholdingTransferRecord } from "./equityLedger";

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** The effective day of a ledger row: its transfer date, never its entry time. */
function effectiveDay(transfer: Pick<RightsholdingTransferRecord, "transferDate">): string | null {
  const day = String(transfer.transferDate ?? "").slice(0, 10);
  return DATE_ONLY.test(day) ? day : null;
}

/**
 * Holdings at the end of the record date for a dividend entitlement. Unlike the
 * ledger helper, a row with no transfer date is left out rather than placed on
 * the day it was entered: an entitlement must not rest on a guessed date.
 * `undatedPostedTransfers` reports those rows so they can be fixed.
 */
export function holdingsAsOf(transfers: readonly RightsholdingTransferRecord[], isoDate: string): CurrentHolding[] {
  const day = String(isoDate ?? "").slice(0, 10);
  if (!DATE_ONLY.test(day)) throw new Error("Choose a valid as-of date.");
  return ledgerHoldingsAsOf(transfers.filter((transfer) => effectiveDay(transfer) !== null), day);
}

/** Posted ledger rows with no transfer date (left out of an as-of snapshot). */
export function undatedPostedTransfers<T extends Pick<RightsholdingTransferRecord, "status" | "transferDate">>(transfers: readonly T[]): T[] {
  return transfers.filter((transfer) => transfer.status === "posted" && effectiveDay(transfer) === null);
}

/**
 * Normalize an as-of holdings result to rows. Accepts the array shape used
 * here and by deriveCurrentHoldings, or a nested `{ [holderKey]: { [classId]: quantity } }`
 * record, so the swap to the ledger's own helper cannot silently change totals.
 */
export function toDividendHoldingRows(result: unknown): Array<{ rightsClassId: string; holderKey: string; quantity: number }> {
  if (Array.isArray(result)) {
    return result.map((row: any) => ({
      rightsClassId: String(row.rightsClassId),
      holderKey: String(row.holderKey),
      quantity: Number(row.quantity) || 0,
    }));
  }
  if (result && typeof result === "object") {
    const rows: Array<{ rightsClassId: string; holderKey: string; quantity: number }> = [];
    for (const [holderKey, byClass] of Object.entries(result as Record<string, unknown>)) {
      if (!byClass || typeof byClass !== "object") continue;
      for (const [rightsClassId, quantity] of Object.entries(byClass as Record<string, unknown>)) {
        rows.push({ rightsClassId, holderKey, quantity: Number(quantity) || 0 });
      }
    }
    return rows;
  }
  return [];
}
