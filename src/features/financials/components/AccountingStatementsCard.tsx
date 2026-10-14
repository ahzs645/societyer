import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import { DatePicker } from "@/components/DatePicker";
import { Field, EmptyState, SkeletonRows } from "@/components/ui";
import { useFinancePermissions } from "@/hooks/useFinancePermissions";
import { useToast } from "@/components/Toast";
import { useConfirm } from "@/components/Modal";
import { Select } from "@/components/Select";
import { InfoPopover } from "@/components/InfoPopover";
import { Money } from "@/components/Money";
import { budgetVariance, formatMoney } from "@/lib/money";
import { escapeCsvCell } from "@/lib/csv";
import { buildAccountingStatements, buildProgramSummary } from "../../../../shared/accountingStatements";
import type { Id } from "../../../../convex/_generated/dataModel";
import { todayDateOnly } from "../../../../shared/dateOnly";
import { FinancialStatementsReport } from "./FinancialStatementsReport";
import { Download, FileSpreadsheet } from "lucide-react";
import { downloadXlsx } from "@/lib/xlsx";
import { statementsWorkbook } from "../lib/statementsWorkbook";
import { CompareToggle, FundFilterChips } from "./FinanceReportControls";
import { VarianceCell, VARIANCE_HELP } from "./VarianceCell";
import {
  fundsWithActivity,
  hasUnrestrictedLines,
  matchesFund,
  shiftIsoYears,
  type FundFilter,
  type LedgerLine,
} from "../lib/ledgerReports";

export function AccountingStatementsCard({ societyId }: { societyId: Id<"societies"> }) {
  const today = todayDateOnly();
  const [from, setFrom] = useState(`${today.slice(0, 4)}-01-01`);
  const [to, setTo] = useState(today);
  const [compare, setCompare] = useState(true);
  const [fund, setFund] = useState<FundFilter>("all");
  const { canExport, canWrite } = useFinancePermissions();
  const toast = useToast();
  const confirm = useConfirm();
  const [budgetYear, setBudgetYear] = useState(today.slice(0, 4));
  const [budgetForm, setBudgetForm] = useState({ programCode: "", accountId: "", amount: "" });
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const accounts = useQuery(api.accounting.chartAccounts, { societyId });
  const budgets = useQuery(api.financialHub.budgets, { societyId, fiscalYear: budgetYear });
  const restrictions = useQuery(api.accounting.fundRestrictions, { societyId }) as Array<{ _id: string; name: string }> | undefined;
  const upsertBudget = useMutation(api.financialHub.upsertBudget);
  const removeBudget = useMutation(api.financialHub.removeBudget);
  const ledger = useQuery(api.accounting.generalLedger, { societyId }) as LedgerLine[] | undefined;
  const funds = useMemo(() => fundsWithActivity(ledger ?? [], restrictions ?? []), [ledger, restrictions]);
  const fundNames = useMemo(() => new Map((restrictions ?? []).map((row) => [String(row._id), row.name])), [restrictions]);
  const fundLines = useMemo(() => (ledger ?? []).filter((line) => matchesFund(line, fund)), [ledger, fund]);
  const priorFrom = shiftIsoYears(from, -1);
  const priorTo = shiftIsoYears(to, -1);
  let report: ReturnType<typeof buildAccountingStatements> | undefined;
  let priorReport: ReturnType<typeof buildAccountingStatements> | null = null;
  let error = "";
  try {
    if (ledger) {
      report = buildAccountingStatements(fundLines as any, from, to);
      if (compare) priorReport = buildAccountingStatements(fundLines as any, priorFrom, priorTo);
    }
  } catch (e) { error = e instanceof Error ? e.message : "Choose a valid report date range."; }
  let programs: ReturnType<typeof buildProgramSummary> = [];
  if (report && ledger && budgets && accounts) programs = buildProgramSummary(ledger as any, budgets, from, to, budgetYear, accounts as any);
  const saveBudget = async () => {
    if (!canWrite) return;
    const account = (accounts ?? []).find((row: any) => row._id === budgetForm.accountId);
    const amount = Number(budgetForm.amount);
    if (!account || !budgetForm.programCode.trim() || !budgetYear.trim() || !budgetForm.amount || !Number.isFinite(amount)) { toast.error("Choose a program, income/expense account, fiscal year, and budget amount."); return; }
    const plannedCents = Math.round(amount * 100);
    if (!Number.isSafeInteger(plannedCents)) { toast.error("Budget amount is too large."); return; }
    setSaving(true);
    try {
      const existing = (budgets ?? []).find((row: any) => row.programCode === budgetForm.programCode.trim() && row.accountId === account._id);
      await upsertBudget({ id: existing?._id, societyId, fiscalYear: budgetYear, category: account.name, plannedCents, programCode: budgetForm.programCode.trim(), accountId: account._id, currency: account.currency });
      toast.success("Program budget saved"); setBudgetForm({ programCode: "", accountId: "", amount: "" });
    } catch (e) { toast.error(e instanceof Error ? e.message : "Budget save failed"); }
    finally { setSaving(false); }
  };
  const download = () => {
    if (!canExport || !report) return;
    const rows: unknown[][] = [["report", "from", "to", "currency", "section", "account_code", "account_name", "amount_cents", "program_code", "budget_cents", "variance_cents", "budget_fiscal_year"]];
    for (const statement of report.statements) {
      for (const [kind, section, entries] of [
        ["balance_sheet", "assets", statement.assets], ["balance_sheet", "liabilities", statement.liabilities], ["balance_sheet", "equity", statement.equity],
        ["income_statement", "income", statement.income], ["income_statement", "expenses", statement.expenses],
      ] as const) for (const row of entries) rows.push([kind, kind === "balance_sheet" ? "" : from, to, statement.currency, section, row.code, row.name, row.amountCents, "", "", "", ""]);
      for (const [kind, label, amount] of [
        ["balance_sheet", "Total assets", statement.totalAssetsCents], ["balance_sheet", "Total liabilities", statement.totalLiabilitiesCents],
        ["balance_sheet", "Posted equity", statement.totalEquityCents], ["balance_sheet", "Unclosed earnings", statement.unclosedEarningsCents],
        ["balance_sheet", "Balance difference", statement.balanceDifferenceCents], ["income_statement", "Total income", statement.totalIncomeCents],
        ["income_statement", "Total expenses", statement.totalExpenseCents], ["income_statement", "Net income", statement.netIncomeCents],
      ] as const) rows.push([kind, kind === "balance_sheet" ? "" : from, to, statement.currency, "total", "", label, amount, "", "", "", ""]);
    }
    for (const row of programs) rows.push(["program_summary", from, to, row.currency, row.accountType, row.code, row.name, row.actualCents, row.programCode, row.budgetCents, row.varianceCents, budgetYear]);
    for (const warning of report.warnings) rows.push(["warning", from, to, "", "", "", warning, "", "", "", "", ""]);
    const url = URL.createObjectURL(new Blob([rows.map(row => row.map(value => typeof value === "number" ? String(value) : escapeCsvCell(value)).join(",")).join("\r\n")], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a"); link.href = url; link.download = `financial-statements-${from}-${to}.csv`; link.click(); URL.revokeObjectURL(url);
  };
  /** One workbook: each currency's balance sheet and income statement laid out as on screen, then program budgets. */
  const downloadExcel = async () => {
    if (!canExport || !report || exporting) return;
    setExporting(true);
    try {
      const fundNote = fund === "all" ? undefined : `Fund filter: ${fund === "unrestricted" ? "no fund restriction" : fundNames.get(fund) ?? "one fund"}`;
      const workbook = statementsWorkbook({ report, priorReport, periods: { from, to, priorFrom, priorTo }, programs, budgetYear, fundNote, accounts: accounts as any });
      await downloadXlsx(`financial-statements-${from}-${to}`, workbook);
    } catch (e) {
      toast.error("Download failed", e instanceof Error ? e.message : undefined);
    } finally {
      setExporting(false);
    }
  };
  const downloadDisabled = !canExport || !report || !accounts || !budgets || (!report.statements.length && !programs.length);
  return <section className="card" aria-label="Financial statements">
    <div className="card__head"><h2 className="card__title">Financial statements</h2><InfoPopover label="About financial statements"><p>Balance sheet as at the end date and income statement for the selected period, from posted journals. The prior-year columns repeat the same dates one year earlier (statutory comparatives). Select any amount to see the journal lines behind it. Import and reconcile source records before comparing with historical statements. Currencies are reported separately.</p></InfoPopover><div className="accounting-statements__download" role="group" aria-label="Download statements"><button className="btn-action" onClick={() => void downloadExcel()} disabled={downloadDisabled || exporting} aria-label="Download statements Excel"><FileSpreadsheet size={12} aria-hidden="true" /> Excel</button><button className="btn-action" onClick={download} disabled={downloadDisabled} aria-label="Download statements CSV"><Download size={12} aria-hidden="true" /> CSV</button></div></div>
    <div className="card__body col accounting-statements__body">
    <div className="financials-control-row"><Field label="Report from"><DatePicker value={from} onChange={setFrom} /></Field><Field label="Report to"><DatePicker value={to} onChange={setTo} /></Field></div>
    <div className="finance-report-toolbar">
      <CompareToggle checked={compare} onChange={setCompare} />
      <FundFilterChips funds={funds} value={fund} onChange={setFund} showUnrestricted={hasUnrestrictedLines(ledger ?? [])} />
    </div>
    {fund !== "all" && <p className="finance-report-note">Showing only journal lines tagged {fund === "unrestricted" ? "with no fund restriction" : `to ${fundNames.get(fund) ?? "this fund"}`}. A single fund's lines need not balance on their own.</p>}
    {error && <p role="alert">{error}</p>}
    {ledger === undefined && <SkeletonRows rows={6} columns={3} />}
    {report?.warnings.map(warning => <p role="alert" key={warning}>{warning}</p>)}
    {report?.statements.length === 0 && (
      <EmptyState
        size="sm"
        align="start"
        title="No posted journal lines through this date"
        description="Historical statement snapshots do not post a ledger automatically. Set up the chart of accounts and post opening balances or bank transactions to build statements."
      />
    )}
    {report && report.statements.length > 0 && (
      <FinancialStatementsReport
        lines={fundLines}
        report={report}
        priorReport={priorReport}
        from={from}
        to={to}
        priorFrom={priorFrom}
        priorTo={priorTo}
        fundNames={fundNames}
        fundFiltered={fund !== "all"}
        accounts={accounts as any}
      />
    )}
    <div className="accounting-section-heading"><h3>Program / project budget and actual</h3><InfoPopover label="About program budgets"><p>Actuals use the selected report dates and each journal line’s program code. The budget is the full fiscal year shown below; it is not prorated. Untagged income and expense lines appear as Unallocated. Historical review snapshots remain separate from posted actuals.</p></InfoPopover></div>
    <Field label="Budget fiscal year"><input className="input accounting-budget-year" inputMode="numeric" value={budgetYear} onChange={e => setBudgetYear(e.target.value)} /></Field>
    <div className="finance-table-wrap"><table className="table finance-table"><thead><tr><th>Program / project</th><th>Account</th><th>Currency</th><th className="num">Actual</th><th className="num">Budget FY {budgetYear}</th><th className="num"><span className="report-table__col-label">Variance<InfoPopover label="About variance">{VARIANCE_HELP}</InfoPopover></span></th></tr></thead><tbody>{programs.map(row => <tr key={JSON.stringify([row.currency, row.programCode, row.accountId])}><td>{row.programCode}</td><td>{row.code} {row.name}</td><td>{row.currency}</td><td className="num"><Money cents={row.actualCents} currency={row.currency} /></td><td className="num"><Money cents={row.budgetCents} currency={row.currency} /></td><td className="num"><VarianceCell variance={budgetVariance(row.budgetCents, row.actualCents, row.accountType === "Income" ? "revenue" : "expense")} currency={row.currency} /></td></tr>)}{programs.length === 0 && <tr className="finance-empty-row"><td colSpan={6} className="muted">No posted program actuals or account-mapped program budgets.</td></tr>}</tbody></table></div>
    {canWrite && <div className="col"><h4>Add or update program budget</h4><Field label="Program / project code"><input className="input" value={budgetForm.programCode} placeholder="100 - OPERATIONS" onChange={e => setBudgetForm({ ...budgetForm, programCode: e.target.value })} /></Field><Field label="Budget account"><Select value={budgetForm.accountId} onChange={accountId => setBudgetForm({ ...budgetForm, accountId })} options={[{ value: "", label: "Choose income or expense account" }, ...(accounts ?? []).filter((account: any) => ["Income", "Expense"].includes(account.accountType)).map((account: any) => ({ value: account._id, label: `${account.code ?? ""} ${account.name} (${account.currency})` }))]} /></Field><Field label="Annual program budget amount"><input className="input" type="number" step="0.01" value={budgetForm.amount} onChange={e => setBudgetForm({ ...budgetForm, amount: e.target.value })} /></Field><button className="btn-action btn-action--primary accounting-statements__save" disabled={saving} onClick={saveBudget}>Save program budget</button>
      {(budgets ?? []).filter((row: any) => row.programCode && row.accountId).map((row: any) => <div key={row._id}>{row.programCode} · {row.category} · <Money cents={row.plannedCents} currency={row.currency} /> <button className="btn btn--ghost btn--sm" disabled={saving} onClick={async () => { if (!(await confirm({ title: "Remove program budget?", message: `The FY ${budgetYear} budget of ${formatMoney(row.plannedCents, { currency: row.currency })} for ${row.programCode} · ${row.category} will be removed. Posted actuals are not affected.`, confirmLabel: "Remove budget", tone: "danger" }))) return; setSaving(true); try { await removeBudget({ id: row._id }); } catch (e) { toast.error(e instanceof Error ? e.message : "Budget removal failed"); } finally { setSaving(false); } }}>Remove program budget</button></div>)}
    </div>}
    </div>
  </section>;
}
