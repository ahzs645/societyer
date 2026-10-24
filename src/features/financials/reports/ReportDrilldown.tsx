import { useMemo } from "react";
import { useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import { SkeletonRows } from "../../../components/ui";
import { formatDate } from "../../../lib/format";
import { reportDrillLines, type AccountingBasis, type ReportLine, type ReportLineFilter } from "../../../../shared/booksReports";
import { FinanceDrilldownDrawer } from "../components/FinanceDrilldownDrawer";
import { ledgerLineToDrilldownItem } from "../components/TrialBalanceReport";
import { BASIS_LABELS } from "./reportFilters";
import { formatPeriodRange } from "./reportPeriods";
import type { CompleteBooks } from "./useCompleteBooks";
import type { ReportContext } from "./types";

export type DrillScope = "balance" | "period" | "cash";

/** One clicked amount: the accounts behind it, how it is built and the dates it covers. */
export type DrillTarget = {
  accountIds: string[];
  scope: DrillScope;
  /** Omitted for balances, which count every line through `to`. */
  from?: string;
  to: string;
  title: string;
  columnLabel: string;
  totalCents: number | null;
};

function scopeText(target: DrillTarget) {
  if (target.scope === "balance") return `Balance through ${formatDate(target.to)}: every posted line up to that date.`;
  const range = formatPeriodRange(target.from ?? target.to, target.to);
  if (target.scope === "cash") return `The other side of cash and bank entries posted ${range}.`;
  return `Lines posted ${range}.`;
}

/**
 * Drawer behind a statement amount: fetches the journal lines on the report's
 * basis, filter and currency, and lists them with links to each entry.
 */
export function ReportDrilldown({
  context,
  books,
  target,
  basis,
  filter,
  filterText,
  currency,
  onClose,
}: {
  context: ReportContext;
  books?: CompleteBooks;
  target: DrillTarget | null;
  basis: AccountingBasis;
  filter: ReportLineFilter | undefined;
  filterText: string | null;
  currency: string;
  onClose: () => void;
}) {
  const queriedLines = useQuery(
    api.accounting.booksReportLines,
    target && !books
      ? {
          societyId: context.societyId,
          accountIds: target.accountIds,
          scope: target.scope,
          ...(target.from ? { from: target.from } : {}),
          to: target.to,
          basis,
          currency,
          ...(filter ? { filter } : {}),
        }
      : "skip",
  ) as ReportLine[] | undefined;

  const lines = useMemo(() => books && target ? reportDrillLines({ ...books, basis, currency, filter, accountIds: target.accountIds, scope: target.scope, start: target.from, end: target.to }) : queriedLines, [books, target, basis, currency, filter, queriedLines]);
  const items = useMemo(() => (lines ?? []).map((line) => ledgerLineToDrilldownItem(line, context.fundNames)), [lines, context.fundNames]);

  return (
    <FinanceDrilldownDrawer
      open={Boolean(target)}
      onClose={onClose}
      title={target?.title ?? ""}
      subtitle={
        target ? (
          <>
            {scopeText(target)} {BASIS_LABELS[basis]} basis{filterText ? ` · ${filterText}` : ""}.
          </>
        ) : undefined
      }
      totalCents={target?.totalCents}
      totalLabel={target?.columnLabel}
      currency={currency}
      items={items}
      composition={target && lines === undefined ? <SkeletonRows rows={4} columns={3} /> : undefined}
      emptyText={lines === undefined ? "Loading entries…" : "No posted lines make up this amount."}
    />
  );
}
