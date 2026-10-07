import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import { DatePicker } from "@/components/DatePicker";
import { Field } from "@/components/ui";
import { useFinancePermissions } from "@/hooks/useFinancePermissions";
import { useToast } from "@/components/Toast";
import { useConfirm } from "@/components/Modal";
import { Select } from "@/components/Select";
import { escapeCsvCell } from "@/lib/csv";
import { buildAccountingStatements, buildProgramSummary, type StatementRow } from "../../../../shared/accountingStatements";
import type { Id } from "../../../../convex/_generated/dataModel";
import { todayDateOnly } from "../../../../shared/dateOnly";

/** Locale currency formatting in the statement's own currency (matches the trial balance's "$34,480"). */
function formatCurrency(cents: number, currency: string) {
  try {
    return new Intl.NumberFormat("en-CA", { style: "currency", currency: currency || "CAD", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(cents / 100);
  } catch {
    return `${currency} ${(cents / 100).toFixed(2)}`;
  }
}

export function AccountingStatementsCard({ societyId }: { societyId: Id<"societies"> }) {
  const today = todayDateOnly();
  const [from, setFrom] = useState(`${today.slice(0, 4)}-01-01`);
  const [to, setTo] = useState(today);
  const { canExport, canWrite } = useFinancePermissions();
  const toast = useToast();
  const confirm = useConfirm();
  const [budgetYear, setBudgetYear] = useState(today.slice(0, 4));
  const [budgetForm, setBudgetForm] = useState({ programCode: "", accountId: "", amount: "" });
  const [saving, setSaving] = useState(false);
  const accounts = useQuery(api.accounting.chartAccounts, { societyId });
  const budgets = useQuery(api.financialHub.budgets, { societyId, fiscalYear: budgetYear });
  const upsertBudget = useMutation(api.financialHub.upsertBudget);
  const removeBudget = useMutation(api.financialHub.removeBudget);
  const ledger = useQuery(api.accounting.generalLedger, { societyId });
  let report: ReturnType<typeof buildAccountingStatements> | undefined;
  let error = "";
  try { if (ledger) report = buildAccountingStatements(ledger as any, from, to); }
  catch (e) { error = e instanceof Error ? e.message : "Choose a valid report date range."; }
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
  return <section className="card" aria-label="Financial statements">
    <div className="card__head"><h2 className="card__title">Financial statements</h2><button className="btn-action" onClick={download} disabled={!canExport || !report || !accounts || !budgets || (!report.statements.length && !programs.length)}>Download statements CSV</button></div>
    <p className="muted">Balance sheet as at the end date and income statement for the selected period, from posted journals. Import and reconcile source records before comparing with historical statements. Currencies are reported separately.</p>
    <div className="financials-control-row"><Field label="Report from"><DatePicker value={from} onChange={setFrom} /></Field><Field label="Report to"><DatePicker value={to} onChange={setTo} /></Field></div>
    {error && <p role="alert">{error}</p>}
    {ledger === undefined && <p className="muted">Loading posted journals…</p>}
    {report?.warnings.map(warning => <p role="alert" key={warning}>{warning}</p>)}
    {report?.statements.length === 0 && <p className="muted">No posted journal lines through this date. Historical statement snapshots do not post a ledger automatically.</p>}
    {report?.statements.map(statement => {
      const money = (cents: number) => formatCurrency(cents, statement.currency);
      const section = (label: string, rows: StatementRow[], total: number) => <><tr><th colSpan={2}>{label}</th></tr>{rows.map(row => <tr key={row.accountId}><td>{row.code} {row.name}</td><td className="mono" style={{ textAlign: "right" }}>{money(row.amountCents)}</td></tr>)}<tr><th>Total {label.toLowerCase()}</th><td className="mono" style={{ textAlign: "right" }}>{money(total)}</td></tr></>;
      return <div key={statement.currency}><h3>{statement.currency} · Balance sheet as at {to}</h3>
        <div className="accounting-table-wrap"><table className="table"><tbody>{section("Assets", statement.assets, statement.totalAssetsCents)}{section("Liabilities", statement.liabilities, statement.totalLiabilitiesCents)}{section("Equity", statement.equity, statement.totalEquityCents)}<tr><td>Unclosed earnings through {to}</td><td className="mono" style={{ textAlign: "right" }}>{money(statement.unclosedEarningsCents)}</td></tr><tr><th>Liabilities and equity including unclosed earnings</th><td className="mono" style={{ textAlign: "right" }}>{money(statement.totalLiabilitiesCents + statement.totalEquityCents + statement.unclosedEarningsCents)}</td></tr></tbody></table></div>
        {statement.balanceDifferenceCents !== 0 && <p role="alert">Balance difference: {money(statement.balanceDifferenceCents)}. Review account classifications, opening balances, and journal completeness.</p>}
        <h3>{statement.currency} · Income statement {from} to {to}</h3><div className="accounting-table-wrap"><table className="table"><tbody>{section("Income", statement.income, statement.totalIncomeCents)}{section("Expenses", statement.expenses, statement.totalExpenseCents)}<tr><th>Net income / (deficit)</th><td className="mono" style={{ textAlign: "right" }}>{money(statement.netIncomeCents)}</td></tr></tbody></table></div>
      </div>;
    })}
    <h3>Program / project budget and actual</h3>
    <p className="muted">Actuals use the selected report dates and each journal line’s program code. The budget is the full fiscal year shown below; it is not prorated. Untagged income and expense lines appear as Unallocated. Historical review snapshots remain separate from posted actuals.</p>
    <Field label="Budget fiscal year"><input className="input" value={budgetYear} onChange={e => setBudgetYear(e.target.value)} /></Field>
    <div className="accounting-table-wrap"><table className="table"><thead><tr><th>Program / project</th><th>Account</th><th>Currency</th><th>Actual</th><th>Budget FY {budgetYear}</th><th>Actual − budget</th></tr></thead><tbody>{programs.map(row => <tr key={JSON.stringify([row.currency, row.programCode, row.accountId])}><td>{row.programCode}</td><td>{row.code} {row.name}</td><td>{row.currency}</td><td className="mono">{formatCurrency(row.actualCents, row.currency)}</td><td className="mono">{formatCurrency(row.budgetCents, row.currency)}</td><td className="mono">{formatCurrency(row.varianceCents, row.currency)}</td></tr>)}{programs.length === 0 && <tr><td colSpan={6} className="muted">No posted program actuals or account-mapped program budgets.</td></tr>}</tbody></table></div>
    {canWrite && <div className="col"><h4>Add or update program budget</h4><Field label="Program / project code"><input className="input" value={budgetForm.programCode} placeholder="100 - OPERATIONS" onChange={e => setBudgetForm({ ...budgetForm, programCode: e.target.value })} /></Field><Field label="Budget account"><Select value={budgetForm.accountId} onChange={accountId => setBudgetForm({ ...budgetForm, accountId })} options={[{ value: "", label: "Choose income or expense account" }, ...(accounts ?? []).filter((account: any) => ["Income", "Expense"].includes(account.accountType)).map((account: any) => ({ value: account._id, label: `${account.code ?? ""} ${account.name} (${account.currency})` }))]} /></Field><Field label="Annual program budget amount"><input className="input" type="number" step="0.01" value={budgetForm.amount} onChange={e => setBudgetForm({ ...budgetForm, amount: e.target.value })} /></Field><button className="btn-action" disabled={saving} onClick={saveBudget}>Save program budget</button>
      {(budgets ?? []).filter((row: any) => row.programCode && row.accountId).map((row: any) => <div key={row._id}>{row.programCode} · {row.category} · {formatCurrency(row.plannedCents, row.currency)} <button className="btn btn--ghost btn--sm" disabled={saving} onClick={async () => { if (!(await confirm({ title: "Remove program budget?", message: `The FY ${budgetYear} budget of ${formatCurrency(row.plannedCents, row.currency)} for ${row.programCode} · ${row.category} will be removed. Posted actuals are not affected.`, confirmLabel: "Remove budget", tone: "danger" }))) return; setSaving(true); try { await removeBudget({ id: row._id }); } catch (e) { toast.error(e instanceof Error ? e.message : "Budget removal failed"); } finally { setSaving(false); } }}>Remove program budget</button></div>)}
    </div>}
  </section>;
}
