import type { BillsWorkspace } from "../../../shared/functions/bills";

/** The bills workspace query (bills:workspace), typed from the portable handler. */
export type { BillsWorkspace };
export type BillRow = BillsWorkspace["bills"][number];
export type BillPaymentRow = BillRow["payments"][number];
export type BillVendor = BillsWorkspace["vendors"][number];
export type MoneyOutTransaction = BillsWorkspace["transactions"][number];
export type AccountOption = BillsWorkspace["accounts"]["expense"][number];

/** A bill row as the record table shows it (with display-only columns). */
export type BillRecord = BillRow & {
  accountSummary: string;
  approvalSummary: string;
  hasDocument: boolean;
};

export function errorMessage(error: unknown, fallback = "Something went wrong.") {
  return error instanceof Error && error.message ? error.message.replace(/^.*Uncaught Error:\s*/, "").split("\n")[0] : fallback;
}
