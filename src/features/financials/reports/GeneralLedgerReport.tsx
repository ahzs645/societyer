import { useEffect, useMemo, useState } from "react";
import { Download, FileSpreadsheet, FileText } from "lucide-react";
import { Menu } from "../../../components/Menu";
import { Select, type SelectOption } from "../../../components/Select";
import { useToast } from "../../../components/Toast";
import { SkeletonRows } from "../../../components/ui";
import { downloadTableExport, rememberExportFormat, type TableExportFormat } from "../../../lib/tableExport";
import { sheetTextRows } from "../../../lib/xlsx/textRows";
import { buildGeneralLedgerReport, reportCurrencies, type GeneralLedgerReport as LedgerReport } from "../../../../shared/booksReports";
import { ReportControl } from "../components/FinanceReportControls";
import { accountLabel, generalLedgerSheet } from "./generalLedgerExport";
import { useCompleteBooks } from "./useCompleteBooks";
import { GeneralLedgerTable } from "./GeneralLedgerTable";
import { ReportPdfDownload } from "./ReportPdfDownload";
import { ledgerPdfData } from "./brandedReportData";
import { BASIS_LABELS, describeFilter, isFiltered, toReportFilter } from "./reportFilters";
import { LEDGER_PRESETS, formatPeriodRange, rangeProblem } from "./reportPeriods";
import { PeriodControl, ReportFilterControls, ReportToolbar } from "./ReportToolbar";
import type { ReportState, ReportStateActions } from "./useReportState";
import type { ChartAccountOption, ReportContext } from "./types";

/** Lines shown (and exported) at most; a narrower range or one account shows the rest. */
const ALL_ACCOUNTS = "__all";

/** Ledger account picker: All accounts, then the chart sorted by code. */
function AccountControl({ accounts, value, onChange }: { accounts: ChartAccountOption[]; value: string | null; onChange: (value: string | null) => void }) {
  const options = useMemo<SelectOption[]>(() => {
    const sorted = [...accounts].sort((a, b) => String(a.code ?? "").localeCompare(String(b.code ?? ""), undefined, { numeric: true }) || a.name.localeCompare(b.name));
    return [{ value: ALL_ACCOUNTS, label: "All accounts" }, ...sorted.map((account) => ({ value: String(account._id), label: accountLabel(account) }))];
  }, [accounts]);
  return (
    <ReportControl label="Account">
      <Select size="sm" searchable value={value ?? ALL_ACCOUNTS} onChange={(next) => onChange(next === ALL_ACCOUNTS ? null : next)} options={options} menuMinWidth={260} />
    </ReportControl>
  );
}

/** Excel / CSV download of the ledger exactly as shown. */
function LedgerExportMenu({ fileName, report, title }: { fileName: string; report: LedgerReport | undefined; title: string[] }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const run = async (format: TableExportFormat) => {
    if (busy || !report) return;
    setBusy(true);
    try {
      const sheet = generalLedgerSheet(report, title);
      const name = await downloadTableExport(fileName, format, { title: sheet.title?.[0] ?? fileName, textRows: () => sheetTextRows(sheet), sheet: () => sheet });
      rememberExportFormat(format);
      toast.success("Downloaded", name);
    } catch (error) {
      toast.error("Download failed", error instanceof Error ? error.message : undefined);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Menu
      align="right"
      trigger={
        <button type="button" className="btn btn--ghost btn--sm" disabled={!report || busy} aria-label="Download general ledger" aria-busy={busy || undefined}>
          <Download size={14} aria-hidden="true" /> Download
        </button>
      }
      sections={[
        {
          id: "download",
          items: [
            { id: "xlsx", label: "Excel (.xlsx)", icon: <FileSpreadsheet size={14} />, onSelect: () => void run("xlsx") },
            { id: "csv", label: "CSV", icon: <FileText size={14} />, onSelect: () => void run("csv") },
          ],
        },
      ]}
    />
  );
}

/**
 * General ledger for a date range: every posted line with its contra accounts,
 * memo and counterparty, optionally narrowed to one account (with opening,
 * running and closing balances), a fund or a program.
 */
export function GeneralLedgerReport({
  context,
  accounts,
  state,
  actions,
}: {
  context: ReportContext;
  accounts: ChartAccountOption[];
  state: ReportState;
  actions: ReportStateActions;
}) {
  const filter = useMemo(() => toReportFilter(state.filter, context.tags.groupOf), [state.filter, context.tags]);
  const filterText = useMemo(
    () => describeFilter(state.filter, context.fundNames, { tagName: context.tags.tagName, groupName: (id) => context.tags.group(context.tags.groupOf(id) ?? "")?.name }),
    [state.filter, context.fundNames, context.tags],
  );
  const problem = rangeProblem(state.range);
  // An account id from another society or a deleted account would fail the query.
  const accountId = state.accountId && accounts.some((account) => String(account._id) === state.accountId) ? state.accountId : null;

  const complete = useCompleteBooks(context.societyId);
  const [displayPage, setDisplayPage] = useState(0);
  const report = useMemo(() => complete.books && !problem ? buildGeneralLedgerReport({ ...complete.books, from: state.range.from, to: state.range.to, basis: state.basis, currency: state.currency, filter, accountId, limit: Number.MAX_SAFE_INTEGER }) : undefined, [complete.books, problem, state.range.from, state.range.to, state.basis, state.currency, filter, accountId]);

  // Keep the last ledger's programs while the next one loads; currencies come from the chart.
  const [programs, setPrograms] = useState<string[]>([]);
  useEffect(() => {
    if (report) setPrograms(report.dimensionValues.programCode);
  }, [report]);
  const currencies = useMemo(() => reportCurrencies(accounts), [accounts]);

  const currency = report?.currency ?? state.currency ?? "CAD";
  const scope = report?.account ? accountLabel(report.account) : "All accounts";
  const rangeText = formatPeriodRange(state.range.from, state.range.to);
  const titleLines = useMemo(
    () => [context.societyName, `General ledger · ${scope}`, `${BASIS_LABELS[state.basis]} basis · ${currency}`, rangeText, ...(filterText ? [filterText] : [])],
    [context.societyName, currency, filterText, rangeText, scope, state.basis],
  );

  const pdfReport = useMemo(() => report ? ledgerPdfData(report, [
    `${BASIS_LABELS[report.basis]} basis · ${report.currency}`,
    `Period: ${report.from} to ${report.to}`,
    `Account: ${scope}`,
    filterText ? `Filters: ${filterText}` : "Funds, programs and tags: all",
    "Source: posted journal entries; draft and voided entries excluded.",
  ]) : undefined, [report, scope, filterText]);

  return (
    <section className="books-report" aria-label="General ledger">
      <ReportToolbar label="Ledger period">
        <PeriodControl presets={LEDGER_PRESETS} preset={state.preset} range={state.range} onPreset={actions.setPreset} onRange={actions.setRange} />
      </ReportToolbar>
      <ReportFilterControls
        basis={state.basis}
        defaultBasis={state.defaultBasis}
        filter={state.filter}
        funds={context.funds}
        tags={context.tags}
        programs={programs}
        currencies={currencies}
        currency={currency}
        actions={actions}
      >
        <AccountControl accounts={accounts} value={accountId} onChange={actions.setAccount} />
      </ReportFilterControls>

      <div className="books-report__note" role="status">{complete.books ? `Complete ledger snapshot loaded at ${complete.books.loadedAtISO}. Exports contain every matching line.` : `Loading complete ledger: ${complete.progress.toLocaleString()} records…`} <button className="btn btn--sm" onClick={complete.refresh}>Refresh complete report</button></div>
      {complete.error && <p className="field__error" role="alert">{complete.error}</p>}
      {context.canExport && !problem && <ReportPdfDownload societyId={context.societyId} report={pdfReport} filename={`General ledger ${state.range.from} to ${state.range.to}`} />}

      {problem ? (
        <p className="books-report__note books-report__note--warn" role="alert">{problem}</p>
      ) : (
        <>
          {report?.warnings.map((warning) => (
            <p key={warning} className="books-report__note books-report__note--warn" role="alert">{warning}</p>
          ))}
          {report?.truncated && (
            <p className="books-report__note books-report__note--warn" role="status">
              Showing the first {report.rows.length.toLocaleString()} lines; the download is limited to the same lines. Totals cover every line. Narrow the range or pick an account to see the rest.
            </p>
          )}
          {isFiltered(state.filter) && <p className="books-report__note">Filtered to {filterText}.</p>}
          <div className="books-ledger__bar">
            <span className="books-ledger__count muted">
              {report ? `${report.rows.length.toLocaleString()} ${report.rows.length === 1 ? "line" : "lines"}` : "Loading lines…"}
            </span>
            {context.canExport && <LedgerExportMenu fileName={`General ledger ${state.range.from} to ${state.range.to}`} report={report} title={titleLines} />}
          </div>
          {report && report.rows.length > 100 && <div className="row" style={{ gap: 8 }}><button className="btn btn--sm" disabled={displayPage <= 0} onClick={() => setDisplayPage((value) => value - 1)}>Previous lines</button><span>Page {Math.min(displayPage, Math.ceil(report.rows.length / 100) - 1) + 1} of {Math.ceil(report.rows.length / 100)} · downloads include all {report.rows.length.toLocaleString()} lines</span><button className="btn btn--sm" disabled={displayPage >= Math.ceil(report.rows.length / 100) - 1} onClick={() => setDisplayPage((value) => value + 1)}>Next lines</button></div>}
          {report ? <GeneralLedgerTable report={{ ...report, rows: report.rows.slice(Math.min(displayPage, Math.max(0, Math.ceil(report.rows.length / 100) - 1)) * 100, (Math.min(displayPage, Math.max(0, Math.ceil(report.rows.length / 100) - 1)) + 1) * 100) }} caption={`General ledger, ${scope}, ${rangeText}`} tags={context.tags} /> : <SkeletonRows rows={8} columns={7} />}
        </>
      )}
    </section>
  );
}
