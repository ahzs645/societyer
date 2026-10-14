import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { Badge, EmptyState } from "../../../components/ui";
import { ReportTable, type ReportColumn, type ReportRow } from "../../../components/ReportTable";
import { formatDate } from "../../../lib/format";

function auditStatusTone(status: string) {
  if (status === "Audited") return "success";
  if (["ReviewEngagement", "Review engagement", "Compilation", "Compiled", "T2/GIFI"].includes(status)) return "info";
  return "warn";
}

function auditStatusLabel(status: string) {
  if (status === "ReviewEngagement") return "Review engagement";
  return status;
}

type Meta = { metric: string };

/**
 * Recorded financial statements side by side, newest fiscal year first, with
 * the change against the prior year. Each year's header opens its detail page,
 * and any amount drills into that year's statement and evidence.
 */
export function YearOverYearFinancialsCard({
  rows,
  onOpenFinancialYear,
  loading,
}: {
  rows: any[];
  onOpenFinancialYear: (fiscalYear: string) => void;
  loading?: boolean;
}) {
  const years = rows.slice().sort((a, b) => String(b.fiscalYear).localeCompare(String(a.fiscalYear)));
  const columnId = (row: any) => `fy:${row.fiscalYear}`;
  const columns: ReportColumn[] = years.map((row, index) => ({
    id: columnId(row),
    title: `FY ${row.fiscalYear}`,
    emphasis: index === 0 && years.length > 1,
    label: (
      <button
        type="button"
        className="yoy-year-link"
        aria-label={`Open FY ${row.fiscalYear} financial detail`}
        onClick={() => onOpenFinancialYear(row.fiscalYear)}
      >
        FY {row.fiscalYear}
        <ChevronRight size={12} aria-hidden="true" />
      </button>
    ),
  }));
  const valuesFor = (pick: (row: any) => number | null | undefined) =>
    Object.fromEntries(years.map((row) => [columnId(row), pick(row)]));
  const cellsFor = (render: (row: any) => ReactNode) =>
    Object.fromEntries(years.map((row) => [columnId(row), render(row)]));
  const hasNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

  const reportRows: ReportRow<Meta>[] = [
    {
      id: "operations",
      kind: "section",
      label: "Operations",
      children: [
        { id: "revenue", kind: "row", label: "Revenue", favourable: "increase", values: valuesFor((row) => row.revenueCents), meta: { metric: "revenue" } },
        { id: "expenses", kind: "row", label: "Expenses", favourable: "decrease", values: valuesFor((row) => row.expensesCents), meta: { metric: "expenses" } },
      ],
    },
    {
      id: "surplus",
      kind: "subtotal",
      label: "Surplus / (deficit)",
      calculated: true,
      favourable: "increase",
      note: "Revenue less expenses from each year's recorded statement.",
      values: valuesFor((row) => (hasNumber(row.revenueCents) && hasNumber(row.expensesCents) ? row.revenueCents - row.expensesCents : null)),
    },
    {
      id: "position",
      kind: "section",
      label: "Financial position",
      children: [
        { id: "net-assets", kind: "row", label: "Net assets", favourable: "increase", values: valuesFor((row) => row.netAssetsCents), meta: { metric: "netAssets" } },
        { id: "restricted", kind: "row", label: "Restricted funds", values: valuesFor((row) => row.restrictedFundsCents), meta: { metric: "restricted" } },
        {
          id: "unrestricted",
          kind: "row",
          label: "Unrestricted net assets",
          calculated: true,
          drilldown: false,
          favourable: "increase",
          note: "Net assets less restricted funds.",
          values: valuesFor((row) => (hasNumber(row.netAssetsCents) && hasNumber(row.restrictedFundsCents) ? row.netAssetsCents - row.restrictedFundsCents : null)),
        },
      ],
    },
    {
      id: "status",
      kind: "section",
      label: "Statement status",
      children: [
        { id: "period-end", kind: "row", label: "Period end", cells: cellsFor((row) => formatDate(row.periodEnd)) },
        {
          id: "audit",
          kind: "row",
          label: "Audit",
          cells: cellsFor((row) => (
            <span className="yoy-audit">
              <Badge tone={auditStatusTone(row.auditStatus)}>{auditStatusLabel(row.auditStatus)}</Badge>
              {row.auditorName && <span className="yoy-audit__by">{row.auditorName}</span>}
            </span>
          )),
        },
        { id: "board", kind: "row", label: "Board approval", cells: cellsFor((row) => (row.approvedByBoardAt ? formatDate(row.approvedByBoardAt) : <span className="money money--empty">—</span>)) },
      ],
    },
  ];

  return (
    <div className="card yoy-card">
      <div className="card__head">
        <h2 className="card__title">Year-over-year</h2>
        <span className="card__subtitle">Recorded statements by fiscal year. Select a year or an amount to open its detail.</span>
      </div>
      <div className="card__body">
        {!loading && years.length === 0 ? (
          <EmptyState
            size="sm"
            title="No financial statements yet"
            description="Record each year's approved statements, or import them from Finance imports, to compare years here."
          />
        ) : (
          <ReportTable<Meta>
            ariaLabel="Year-over-year financial statements"
            labelHeader="Line"
            loading={loading}
            columns={columns}
            rows={reportRows}
            comparison={years.length > 1 ? { current: columnId(years[0]), prior: columnId(years[1]), deltaLabel: `Change vs FY ${years[1].fiscalYear}` } : null}
            onDrilldown={(_row, column) => {
              const fiscalYear = column.id.replace(/^fy:/, "");
              if (fiscalYear) onOpenFinancialYear(fiscalYear);
            }}
            maxHeight="none"
          />
        )}
      </div>
    </div>
  );
}
