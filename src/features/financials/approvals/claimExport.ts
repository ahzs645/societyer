import { downloadDelimitedText, exportFileName, toDelimitedText } from "../../../lib/tableExport";
import { pluralize } from "../../../lib/format";
import type { QueueRow } from "./types";

const dollars = (cents: number | undefined) => (cents === undefined ? "" : (cents / 100).toFixed(2));

/** Every claim as CSV, with mileage details and the spend budget. Returns the file name. */
export function exportClaimsCsv(rows: readonly QueueRow[]): string {
  const header = [
    "Claim", "Type", "Requester", "Category", "Amount", "Currency", "Status", "Incurred", "Submitted", "Paid",
    "Distance (km)", "Rate per km", "From", "To", "Trip", "Spend budget", "Receipt", "Payment reference", "Notes",
  ];
  const body = rows.map((row) => [
    row.title,
    row.claimType === "mileage" ? "Mileage" : "Expense",
    row.claimantName,
    row.category,
    dollars(row.amountCents),
    row.currency,
    row.status,
    String(row.incurredAtISO ?? "").slice(0, 10),
    String(row.submittedAtISO ?? "").slice(0, 10),
    String(row.paidAtISO ?? "").slice(0, 10),
    row.mileage ? String(row.mileage.distanceKm) : "",
    row.mileage ? dollars(row.mileage.rateCentsPerKm) : "",
    row.mileage?.fromLocation ?? "",
    row.mileage?.toLocation ?? "",
    row.mileage?.tripDescription ?? "",
    row.spendBudget?.name ?? "",
    row.receiptDocument?.title ?? (row.claimType === "mileage" ? "Not needed" : ""),
    row.paymentReference ?? "",
    row.notes ?? "",
  ]);
  const fileName = exportFileName(`Expense claims (${pluralize(rows.length, "claim")})`, "csv");
  downloadDelimitedText(fileName, toDelimitedText([header, ...body], "csv"), "csv");
  return fileName;
}
