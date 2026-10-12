/**
 * LOCAL STAND-IN for `holdingsAsOf` (shared/equityLedger.ts).
 *
 * The shared field contract gives the share ledger (Agent SHARES) ownership of
 * `holdingsAsOf(transfers, isoDate)` in shared/equityLedger.ts. That helper is
 * not in this branch yet, so the dividend record-date snapshot uses this file,
 * which has the same name and signature. At merge, delete this file and
 * import `holdingsAsOf` from "./equityLedger" in shared/functions/dividends.ts
 * (and the static mirror); `toDividendHoldingRows` accepts either result shape.
 */

import { deriveCurrentHoldings, type CurrentHolding, type RightsholdingTransferRecord } from "./equityLedger";

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** The effective day of a ledger row: its transfer date, never its entry time. */
function effectiveDay(transfer: Pick<RightsholdingTransferRecord, "transferDate">): string | null {
  const day = String(transfer.transferDate ?? "").slice(0, 10);
  return DATE_ONLY.test(day) ? day : null;
}

/**
 * Holdings per holder per class as at the end of `isoDate` (inclusive), from
 * posted ledger rows dated on or before that day. Undated rows cannot be placed
 * in time and are left out; `undatedPostedTransfers` reports them.
 */
export function holdingsAsOf(transfers: readonly RightsholdingTransferRecord[], isoDate: string): CurrentHolding[] {
  const day = String(isoDate ?? "").slice(0, 10);
  if (!DATE_ONLY.test(day)) throw new Error("Choose a valid as-of date.");
  return deriveCurrentHoldings(transfers.filter((transfer) => {
    const effective = effectiveDay(transfer);
    return effective !== null && effective <= day;
  }));
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
