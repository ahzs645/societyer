import { BILL_STATUS_LABEL } from "../../../shared/bills";
import { downloadDelimitedText, exportFileName, toDelimitedText } from "../../lib/tableExport";
import type { BillRow } from "./types";

const money = (cents: number) => (cents / 100).toFixed(2);

/** Download bills as CSV: one row per bill line, so account totals add up in a spreadsheet. */
export function exportBillsCsv(bills: readonly BillRow[], name: string) {
  const header = ["Vendor", "Bill #", "Bill date", "Due date", "Status", "Bill total", "Paid", "Outstanding", "Line account", "Line memo", "Line amount"];
  const body: string[][] = [];
  for (const bill of bills) {
    const base = [bill.vendorName ?? "", bill.billNumber ?? "", bill.billDate, bill.dueDate, BILL_STATUS_LABEL[bill.status], money(bill.totalCents), money(bill.paidCents), money(bill.balanceCents)];
    if (!bill.lines.length) body.push([...base, "", "", ""]);
    for (const line of bill.lines) body.push([...base, line.accountLabel ?? "", line.memo ?? "", money(line.amountCents)]);
  }
  const fileName = exportFileName(name, "csv");
  downloadDelimitedText(fileName, toDelimitedText([header, ...body], "csv"), "csv");
  return fileName;
}
