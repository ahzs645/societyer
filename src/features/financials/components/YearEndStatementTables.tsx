import { useMemo, useState, type ReactNode } from "react";
import { ReportTable, type ReportColumn, type ReportRow } from "../../../components/ReportTable";
import { formatMoney } from "../../../lib/money";
import { lineTotalCents, type OrgRevenueStatement, type OrgStatementLine } from "../../../../shared/orgRevenueStatement";
import { FinanceDrilldownDrawer, type DrilldownItem } from "./FinanceDrilldownDrawer";

const ORG_COLUMNS: ReportColumn[] = [
  { id: "general", label: "General Fund", title: "General Fund", help: "Unrestricted activity: transactions on accounts not flagged as restricted." },
  { id: "restricted", label: "Restricted Funds", title: "Restricted Funds", help: "Activity on restricted-purpose funds or accounts." },
  { id: "total", label: "Total", title: "Total", emphasis: true },
];

type OrgMeta = { line: OrgStatementLine; kind: "revenue" | "expense" };

function orgLineRow(line: OrgStatementLine, kind: "revenue" | "expense"): ReportRow<OrgMeta> {
  return {
    id: `${kind}:${line.label}`,
    kind: "row",
    label: line.label,
    values: { general: line.generalCents, restricted: line.restrictedCents, total: lineTotalCents(line) },
    meta: { line, kind },
  };
}

/** In-app Statement of Revenues & Expenses (General / Restricted / Total), matching the exported document. */
export function OrgStatementTable({ statement }: { statement: OrgRevenueStatement }) {
  const [drill, setDrill] = useState<{ meta: OrgMeta; columnId: string } | null>(null);
  const rows: ReportRow<OrgMeta>[] = [
    {
      id: "revenues",
      kind: "section",
      label: "Revenues",
      children: statement.revenues.length
        ? statement.revenues.map((line) => orgLineRow(line, "revenue"))
        : [{ id: "revenues:none", kind: "note", label: "No revenue recorded for this period." }],
    },
    {
      id: "revenue-total",
      kind: "subtotal",
      label: "Total revenues",
      values: { general: statement.revenueTotals.generalCents, restricted: statement.revenueTotals.restrictedCents, total: statement.revenueTotals.totalCents },
    },
    {
      id: "expenses",
      kind: "section",
      label: "Expenses",
      children: statement.expenses.length
        ? statement.expenses.map((line) => orgLineRow(line, "expense"))
        : [{ id: "expenses:none", kind: "note", label: "No expenses recorded for this period." }],
    },
    {
      id: "expense-total",
      kind: "subtotal",
      label: "Total expenses",
      values: { general: statement.expenseTotals.generalCents, restricted: statement.expenseTotals.restrictedCents, total: statement.expenseTotals.totalCents },
    },
    {
      id: "excess",
      kind: "total",
      label: "Excess of revenues over expenses",
      calculated: true,
      note: "Total revenues less total expenses, per fund.",
      values: { general: statement.excess.generalCents, restricted: statement.excess.restrictedCents, total: statement.excess.totalCents },
    },
  ];
  const meta = drill?.meta;
  const columnLabel = drill ? ORG_COLUMNS.find((column) => column.id === drill.columnId)?.title ?? "Total" : "";
  const composition: ReactNode = meta ? (
    <>
      <p>
        “{meta.line.label}” {meta.kind === "revenue" ? "revenue" : "expenses"} for {statement.periodLabel ?? `fiscal year ${statement.fiscalYearLabel}`}:
      </p>
      <p>
        General Fund {formatMoney(meta.line.generalCents)} + Restricted Funds {formatMoney(meta.line.restrictedCents)} = Total{" "}
        {formatMoney(lineTotalCents(meta.line))}.
      </p>
      <p>
        Each figure sums the synced bank transactions in this category (cash basis), split by whether the transaction’s account is flagged as
        restricted. Review the individual transactions under Financials → Transactions.
      </p>
    </>
  ) : null;
  return (
    <>
      <ReportTable<OrgMeta>
        ariaLabel="Statement of revenues and expenses"
        labelHeader="Line"
        download={{
          fileName: `Statement of revenues and expenses ${statement.periodLabel ?? `FY ${statement.fiscalYearLabel}`}`,
          sheetName: "Revenues and expenses",
          title: ["Statement of revenues and expenses", statement.periodLabel ?? `Fiscal year ${statement.fiscalYearLabel}`],
        }}
        columns={ORG_COLUMNS}
        rows={rows}
        drillColumn="total"
        onDrilldown={(row, column) => row.meta && setDrill({ meta: row.meta, columnId: column.id })}
        maxHeight="none"
      />
      <FinanceDrilldownDrawer
        open={Boolean(drill)}
        onClose={() => setDrill(null)}
        title={meta ? `${meta.line.label} · ${columnLabel}` : "Line"}
        totalCents={meta && drill ? (drill.columnId === "general" ? meta.line.generalCents : drill.columnId === "restricted" ? meta.line.restrictedCents : lineTotalCents(meta.line)) : null}
        items={[]}
        composition={composition}
      />
    </>
  );
}

type FundRow = { grantId: string; title: string; funder?: string; purpose?: string; openingCents: number; receiptsCents: number; disbursementsCents: number; closingCents: number };
type FundMeta = { fund: FundRow };

const FUND_COLUMNS: ReportColumn[] = [
  { id: "opening", label: "Opening", title: "Opening", help: "Opening balances are not tracked per period yet, so each fund opens at zero and shows its full activity." },
  { id: "receipts", label: "Receipts", title: "Receipts" },
  { id: "disbursements", label: "Disbursements", title: "Disbursements" },
  { id: "closing", label: "Closing", title: "Closing", emphasis: true },
];

/** In-app Statement of Restricted Funds with drilldown into each grant's restricted-fund ledger entries. */
export function RestrictedFundsTable({
  data,
  grantTransactions,
}: {
  data: { funds: FundRow[]; totals: { openingCents: number; receiptsCents: number; disbursementsCents: number; closingCents: number } };
  grantTransactions: any[] | undefined;
}) {
  const [drill, setDrill] = useState<{ fund: FundRow; columnId: string } | null>(null);
  const rows: ReportRow<FundMeta>[] = [
    ...data.funds.map((fund): ReportRow<FundMeta> => ({
      id: `fund:${fund.grantId}`,
      kind: "row",
      label: fund.title,
      note: [fund.funder, fund.purpose].filter(Boolean).join(" · ") || undefined,
      values: { opening: fund.openingCents, receipts: fund.receiptsCents, disbursements: fund.disbursementsCents, closing: fund.closingCents },
      meta: { fund },
    })),
    {
      id: "total",
      kind: "total",
      label: "Total",
      values: { opening: data.totals.openingCents, receipts: data.totals.receiptsCents, disbursements: data.totals.disbursementsCents, closing: data.totals.closingCents },
    },
  ];
  const items: DrilldownItem[] = useMemo(() => {
    if (!drill || !grantTransactions) return [];
    const direction = drill.columnId === "receipts" ? "inflow" : drill.columnId === "disbursements" ? "outflow" : null;
    return grantTransactions
      .filter((txn) => String(txn.grantId) === String(drill.fund.grantId))
      .filter((txn) => (direction ? txn.direction === direction : txn.direction === "inflow" || txn.direction === "outflow"))
      .sort((a, b) => String(a.date).localeCompare(String(b.date)))
      .map((txn) => ({
        id: String(txn._id),
        date: txn.date,
        primary: txn.description || "Ledger entry",
        secondary: txn.direction === "inflow" ? "Receipt" : "Disbursement",
        amountCents: txn.direction === "outflow" ? -Math.abs(txn.amountCents) : Math.abs(txn.amountCents),
        ledgerHref: "/app/grants?tab=ledger",
      }));
  }, [drill, grantTransactions]);
  return (
    <>
      <ReportTable<FundMeta>
        ariaLabel="Statement of restricted funds"
        labelHeader="Fund"
        download={{ fileName: "Statement of restricted funds", sheetName: "Restricted funds", title: ["Statement of restricted funds"] }}
        columns={FUND_COLUMNS}
        rows={rows}
        drillColumn="closing"
        onDrilldown={(row, column) => row.meta && setDrill({ fund: row.meta.fund, columnId: column.id })}
        empty="No restricted funds recorded."
        maxHeight="none"
      />
      <FinanceDrilldownDrawer
        open={Boolean(drill)}
        onClose={() => setDrill(null)}
        title={drill ? `${drill.fund.title} · ${FUND_COLUMNS.find((column) => column.id === drill.columnId)?.title ?? ""}` : "Fund"}
        subtitle="Entries in the grant’s restricted-fund ledger"
        totalCents={drill ? (drill.fund as any)[`${drill.columnId}Cents`] ?? null : null}
        items={drill?.columnId === "opening" ? [] : items}
        composition={drill?.columnId === "opening" ? <p>Opening balances are not tracked per period yet, so every fund opens at zero.</p> : undefined}
        emptyText={grantTransactions === undefined ? "Loading ledger entries…" : "No ledger entries make up this amount."}
      />
    </>
  );
}
