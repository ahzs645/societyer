import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { BookOpen } from "lucide-react";
import { ReportTable, type ReportColumn, type ReportRow } from "../../../components/ReportTable";
import { EmptyState } from "../../../components/ui";
import { formatDate } from "../../../lib/format";
import { buildBooksReport, buildReportPeriods, type BooksReport, type BooksReportRow, type ReportPeriod } from "../../../../shared/booksReports";
import { useCompleteBooks } from "./useCompleteBooks";
import { ReportChartStrip } from "./ReportChartStrip";
import { ReportPdfDownload } from "./ReportPdfDownload";
import { statementPdfData } from "./brandedReportData";
import { ReportDrilldown, type DrillTarget } from "./ReportDrilldown";
import { BASIS_LABELS, REPORT_TITLES, STATEMENT_KINDS, describeFilter, isFiltered, toReportFilter, type StatementSlug } from "./reportFilters";
import { STATEMENT_PRESETS, formatPeriodRange, statementRangeProblem } from "./reportPeriods";
import { FrequencyControl, PeriodControl, ReportFilterControls, ReportToolbar } from "./ReportToolbar";
import type { ReportState, ReportStateActions } from "./useReportState";
import type { BooksSettingsView, ReportContext } from "./types";

type Meta = { drill?: BooksReportRow["drill"] };

const PERIOD_NOUN = { MTD: "month", QTD: "quarter", YTD: "fiscal year" } as const;
/** Placeholder columns so the loading skeleton has the statement's shape. */
const LOADING_COLUMNS: ReportColumn[] = [0, 1, 2].map((index) => ({ id: `loading-${index}`, label: "", title: "Loading" }));

type ToolbarOptions = { programs: string[]; currencies: string[] };

function toTableRows(rows: BooksReportRow[]): ReportRow<Meta>[] {
  return rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    label: row.label,
    title: row.title,
    code: row.code,
    values: row.values,
    note: row.note,
    calculated: row.calculated,
    favourable: row.favourable,
    // Only rows that say how they are built can be drilled into.
    drilldown: row.drill ? row.drilldown : false,
    meta: { drill: row.drill },
    children: row.children ? toTableRows(row.children) : undefined,
  }));
}

function periodHelp(period: ReportPeriod) {
  if (period.toDate) {
    return `Through ${formatDate(period.end, "MMM d")}. The ${PERIOD_NOUN[period.toDate]} is still running, so this column covers ${formatPeriodRange(period.start, period.end)}.`;
  }
  if (period.clipped) return `Covers ${formatPeriodRange(period.start, period.end)} only: the report range cuts this period short.`;
  return undefined;
}

function toColumns(report: BooksReport): ReportColumn[] {
  const last = report.periods.length - 1;
  const columns: ReportColumn[] = report.periods.map((period, index) => ({
    id: period.id,
    label: period.label,
    title: formatPeriodRange(period.start, period.end),
    help: periodHelp(period),
    emphasis: index === last,
  }));
  if (report.totalColumn && report.periods.length) {
    const first = report.periods[0];
    columns.push({ id: report.totalColumn, label: "Total", title: `Total, ${formatPeriodRange(first.start, report.periods[last].end)}` });
  }
  return columns;
}

/**
 * One multi-period statement (balance sheet, statement of operations or cash
 * flow): toolbar, summary charts, the statement with a column per period and
 * drilldown into the journal lines behind any amount.
 */
export function MultiPeriodReport({
  slug,
  context,
  settings,
  state,
  actions,
}: {
  slug: StatementSlug;
  context: ReportContext;
  settings: BooksSettingsView;
  state: ReportState;
  actions: ReportStateActions;
}) {
  const kind = STATEMENT_KINDS[slug];
  const title = REPORT_TITLES[slug];
  const [drill, setDrill] = useState<DrillTarget | null>(null);
  const filter = useMemo(() => toReportFilter(state.filter, context.tags.groupOf), [state.filter, context.tags]);
  const filterText = useMemo(
    () => describeFilter(state.filter, context.fundNames, { tagName: context.tags.tagName, groupName: (id) => context.tags.group(context.tags.groupOf(id) ?? "")?.name }),
    [state.filter, context.fundNames, context.tags],
  );
  const problem = useMemo(
    () => statementRangeProblem(state.range, state.frequency, state.today, settings.fiscalStartMonth),
    [settings.fiscalStartMonth, state.frequency, state.range, state.today],
  );

  const complete = useCompleteBooks(context.societyId);
  const report = useMemo(() => complete.books && !problem ? buildBooksReport(kind, {
    ...complete.books, periods: buildReportPeriods({ from: state.range.from, to: state.range.to, frequency: state.frequency, today: state.today, fiscalStartMonth: settings.fiscalStartMonth }), basis: state.basis, currency: state.currency, filter,
  }) : undefined, [complete.books, problem, kind, state.range.from, state.range.to, state.frequency, state.today, settings.fiscalStartMonth, state.basis, state.currency, filter]);

  // Keep the last report's program and currency options while the next one loads.
  const [options, setOptions] = useState<ToolbarOptions>({ programs: [], currencies: [] });
  useEffect(() => {
    if (report) setOptions({ programs: report.dimensionValues.programCode, currencies: report.currencies });
  }, [report]);

  const columns = useMemo(() => (report ? toColumns(report) : LOADING_COLUMNS), [report]);
  const rows = useMemo(() => (report ? toTableRows(report.rows) : []), [report]);
  const currency = report?.currency ?? state.currency ?? "CAD";
  const rangeText = report?.periods.length ? formatPeriodRange(report.periods[0].start, report.periods[report.periods.length - 1].end) : formatPeriodRange(state.range.from, state.range.to);
  const download = useMemo(
    () =>
      context.canExport
        ? {
            fileName: `${title} ${state.range.from} to ${state.range.to}`,
            sheetName: title,
            title: [context.societyName, title, `${BASIS_LABELS[state.basis]} basis · ${currency}`, rangeText, ...(filterText ? [filterText] : [])],
          }
        : undefined,
    [context.canExport, context.societyName, currency, filterText, rangeText, state.basis, state.range.from, state.range.to, title],
  );

  const openDrill = (row: ReportRow<Meta>, column: ReportColumn) => {
    const target = row.meta?.drill;
    if (!report || !target) return;
    const period = report.periods.find((candidate) => candidate.id === column.id);
    const start = period?.start ?? report.periods[0]?.start;
    const end = period?.end ?? report.periods[report.periods.length - 1]?.end;
    if (!start || !end) return;
    setDrill({
      accountIds: target.accountIds,
      scope: target.scope,
      from: target.scope === "balance" ? undefined : start,
      to: end,
      title: `${row.code ? `${row.code} · ` : ""}${row.title ?? String(row.label)}`,
      columnLabel: typeof column.label === "string" ? column.label : "Amount",
      totalCents: row.values?.[column.id] ?? null,
    });
  };

  const pdfReport = useMemo(() => report ? statementPdfData(report, title, [
    `${BASIS_LABELS[report.basis]} basis · ${report.currency}`,
    `Period: ${rangeText}`,
    `Requested range: ${state.range.from} to ${state.range.to}; as of ${state.today}`,
    `Columns: ${state.frequency}`,
    filterText ? `Filters: ${filterText}` : "Funds, programs and tags: all",
    "Source: posted journal entries; draft and voided entries excluded.",
  ]) : undefined, [report, title, rangeText, state.range.from, state.range.to, state.today, state.frequency, filterText]);
  const noPostings = report?.postedLineCount === 0;
  const filtered = isFiltered(state.filter);

  return (
    <section className="books-report" aria-label={title}>
      <ReportToolbar label="Report period">
        <PeriodControl presets={STATEMENT_PRESETS} preset={state.preset} range={state.range} onPreset={actions.setPreset} onRange={actions.setRange} />
        <FrequencyControl value={state.frequency} onChange={actions.setFrequency} />
      </ReportToolbar>
      <ReportFilterControls
        basis={state.basis}
        defaultBasis={state.defaultBasis}
        filter={state.filter}
        funds={context.funds}
        tags={context.tags}
        programs={options.programs}
        currencies={options.currencies}
        currency={currency}
        actions={actions}
      />

      <div className="books-report__note" role="status">{complete.books ? `Complete source snapshot loaded at ${complete.books.loadedAtISO}. Refresh after posting or editing entries.` : `Loading complete ledger: ${complete.progress.toLocaleString()} records…`} <button className="btn btn--sm" onClick={complete.refresh}>Refresh complete report</button></div>
      {complete.error && <p className="field__error" role="alert">{complete.error}</p>}
      {context.canExport && !problem && <ReportPdfDownload societyId={context.societyId} report={pdfReport} filename={`${title} ${state.range.from} to ${state.range.to}`} />}

      {problem ? (
        <p className="books-report__note books-report__note--warn" role="alert">{problem}</p>
      ) : noPostings ? (
        <EmptyState
          icon={<BookOpen size={20} />}
          title="Nothing posted yet"
          description={filtered ? "No posted journal lines match these filters on this basis." : "Reports are built from posted journal entries. Post opening balances or bank transactions in the accounting workbench to see figures here."}
          action={
            filtered ? (
              <button type="button" className="btn btn--sm" onClick={actions.clearFilters}>Clear filters</button>
            ) : (
              <Link className="btn btn--sm" to="/app/financials/accounting">Open the workbench</Link>
            )
          }
        />
      ) : (
        <>
          {report?.warnings.map((warning) => (
            <p key={warning} className="books-report__note books-report__note--warn" role="alert">{warning}</p>
          ))}
          {filtered && (
            <p className="books-report__note">
              Filtered to {filterText ?? "a subset of lines"}. A single fund's, program's or tag's lines need not balance on their own.
            </p>
          )}
          <ReportChartStrip kind={kind} report={report} />
          <ReportTable<Meta>
            key={`${slug}:${state.frequency}`}
            ariaLabel={title}
            columns={columns}
            rows={rows}
            currency={currency}
            loading={report === undefined}
            onDrilldown={openDrill}
            drillColumn={columns.find((column) => column.emphasis)?.id}
            maxHeight="none"
            download={download}
            empty="Nothing to report for this range."
          />
        </>
      )}

      <ReportDrilldown books={complete.books} context={context} target={drill} basis={state.basis} filter={filter} filterText={filterText} currency={currency} onClose={() => setDrill(null)} />
    </section>
  );
}
