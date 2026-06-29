import { escapeHtml } from "../../../lib/html";
import {
  computeStatementTotals,
  type ProgramStatement,
  type ProgramStatementLine,
} from "../../../../shared/programStatement";
import {
  lineTotalCents,
  type OrgRevenueStatement,
  type OrgStatementColumnTotals,
  type OrgStatementLine,
} from "../../../../shared/orgRevenueStatement";

type SocietyLike = { name?: string } | null | undefined;

// Always two decimals so columns line up cleanly in the exported statement.
const MONEY = new Intl.NumberFormat("en-CA", {
  style: "currency",
  currency: "CAD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
function fmtMoney(cents?: number): string {
  return MONEY.format((cents ?? 0) / 100);
}

type CellOpts = { bold?: boolean; rule?: "top" | "header"; width?: string };

function moneyCell(cents: number, opts: CellOpts = {}): string {
  const width = opts.width ? `;width:${opts.width}` : "";
  const rule = opts.rule ? ` data-rule="${opts.rule}"` : "";
  const inner = opts.bold ? `<strong>${escapeHtml(fmtMoney(cents))}</strong>` : escapeHtml(fmtMoney(cents));
  return `<td${rule} style="text-align:right${width}">${inner}</td>`;
}
function labelCell(html: string, opts: { rule?: "top" | "header"; bold?: boolean; em?: boolean } = {}): string {
  const rule = opts.rule ? ` data-rule="${opts.rule}"` : "";
  let inner = html;
  if (opts.bold) inner = `<strong>${inner}</strong>`;
  if (opts.em) inner = `<em>${inner}</em>`;
  return `<td${rule}>${inner}</td>`;
}
function blankCells(n: number): string {
  return "<td></td>".repeat(n);
}

/**
 * Reproduces the BC Community Gaming Grants "Program Actual Revenue and Expenses
 * and Budget" supporting document: two columns (prior-year actuals vs
 * current-year budget), itemized revenues and expenses, totals, and
 * surplus/deficit, with the form's footnotes.
 */
export function renderProgramStatementHtml(statement: ProgramStatement, society?: SocietyLike): string {
  const totals = computeStatementTotals(statement);
  const W = "26%";
  const lineRows = (lines: ProgramStatementLine[]) =>
    lines
      .map(
        (line) =>
          `<tr>${labelCell(
            `${escapeHtml(line.label)}${line.notes ? ` <span class="meta">(${escapeHtml(line.notes)})</span>` : ""}`,
          )}${moneyCell(line.actualCents, { width: W })}${moneyCell(line.budgetCents, { width: W })}</tr>`,
      )
      .join("");
  return `
    <h1>Program Actual Revenue and Expenses and Budget</h1>
    <p class="meta">${escapeHtml(statement.programName || "[Program Name]")}${society?.name ? ` · ${escapeHtml(society.name)}` : ""}${statement.funderName ? ` · ${escapeHtml(statement.funderName)}` : ""}</p>
    <table data-variant="statement">
      <thead>
        <tr>
          <th data-rule="header"></th>
          <th data-rule="header" style="text-align:center;width:${W}">Program Actuals for ${escapeHtml(statement.priorFiscalYearLabel)}</th>
          <th data-rule="header" style="text-align:center;width:${W}">Program Budget for ${escapeHtml(statement.currentFiscalYearLabel)}</th>
        </tr>
      </thead>
      <tbody>
        <tr>${labelCell("Program Revenues<sup>1</sup>", { bold: true })}${blankCells(2)}</tr>
        ${lineRows(statement.revenues)}
        <tr>${labelCell("Total Revenues", { bold: true, rule: "top" })}${moneyCell(totals.revenueActualCents, { bold: true, rule: "top", width: W })}${moneyCell(totals.revenueBudgetCents, { bold: true, rule: "top", width: W })}</tr>
        <tr>${labelCell("Program Expenses", { bold: true })}${blankCells(2)}</tr>
        ${lineRows(statement.expenses)}
        <tr>${labelCell("Total Expenses", { bold: true, rule: "top" })}${moneyCell(totals.expenseActualCents, { bold: true, rule: "top", width: W })}${moneyCell(totals.expenseBudgetCents, { bold: true, rule: "top", width: W })}</tr>
        <tr>${labelCell("Surplus / Deficit", { bold: true, em: true, rule: "top" })}${moneyCell(totals.surplusActualCents, { bold: true, rule: "top", width: W })}${moneyCell(totals.surplusBudgetCents, { bold: true, rule: "top", width: W })}</tr>
      </tbody>
    </table>
    ${statement.narrative ? `<h2>Notes</h2><p>${escapeHtml(statement.narrative)}</p>` : ""}
    <p class="meta"><sup>1</sup> Itemize funding sources. Do not use abbreviations or acronyms.</p>
    <p class="meta"><sup>2</sup> The Community Gaming Grant amount should equal the Program Grant used for this program in the previous fiscal year (actuals) and/or requested for the current fiscal year (budget). If grant funds were used toward organizational costs (up to 15% of the total Program Grant), this amount may be less than the funding received for this program.</p>
  `;
}

/**
 * Organisation-wide Statement of Revenues & Expenses for the fiscal year,
 * derived from the finance ledger. Three columns: General Fund (unrestricted) /
 * Restricted Funds / Total, with itemized revenues and expenses, totals, and
 * "Excess of Revenues over Expenses" per fund.
 */
export function renderOrgStatementHtml(statement: OrgRevenueStatement, society?: SocietyLike): string {
  const W = "20%";
  const lineRows = (lines: OrgStatementLine[]) =>
    lines
      .map(
        (line) =>
          `<tr>${labelCell(escapeHtml(line.label))}${moneyCell(line.generalCents, { width: W })}${moneyCell(line.restrictedCents, { width: W })}${moneyCell(lineTotalCents(line), { bold: true, width: W })}</tr>`,
      )
      .join("");
  const totalRow = (label: string, c: OrgStatementColumnTotals, em = false) =>
    `<tr>${labelCell(escapeHtml(label), { bold: !em, em, rule: "top" })}${moneyCell(c.generalCents, { bold: true, rule: "top", width: W })}${moneyCell(c.restrictedCents, { bold: true, rule: "top", width: W })}${moneyCell(c.totalCents, { bold: true, rule: "top", width: W })}</tr>`;
  return `
    <h1>Statement of Revenues &amp; Expenses</h1>
    <p class="meta">${escapeHtml(statement.organizationName || society?.name || "[Name of Organization]")}${statement.periodLabel ? ` · ${escapeHtml(statement.periodLabel)}` : ` · Fiscal year ${escapeHtml(statement.fiscalYearLabel)}`}</p>
    <table data-variant="statement">
      <thead>
        <tr><th data-rule="header"></th><th data-rule="header" style="text-align:center;width:${W}">General Fund</th><th data-rule="header" style="text-align:center;width:${W}">Restricted Funds</th><th data-rule="header" style="text-align:center;width:${W}">Total</th></tr>
      </thead>
      <tbody>
        <tr>${labelCell("Revenues<sup>1</sup>", { bold: true })}${blankCells(3)}</tr>
        ${statement.revenues.length ? lineRows(statement.revenues) : `<tr>${labelCell('<span class="muted">No revenue recorded for this period.</span>')}${blankCells(3)}</tr>`}
        ${totalRow("Total Revenues", statement.revenueTotals)}
        <tr>${labelCell("Expenses", { bold: true })}${blankCells(3)}</tr>
        ${statement.expenses.length ? lineRows(statement.expenses) : `<tr>${labelCell('<span class="muted">No expenses recorded for this period.</span>')}${blankCells(3)}</tr>`}
        ${totalRow("Total Expenses", statement.expenseTotals)}
        ${totalRow("Excess of Revenues over Expenses", statement.excess, true)}
      </tbody>
    </table>
    <p class="meta"><sup>1</sup> Organisation-wide statement covering all programs and services for the fiscal year, derived from the finance ledger. Restricted Funds are amounts held in restricted-purpose funds or accounts; everything else is unrestricted General Fund activity.</p>
  `;
}

export function renderAnnualStatementHtml(data: any, society: SocietyLike, fiscalYear: string): string {
  const W = "26%";
  const categoryTable = (title: string, rows: Array<{ category: string; cents: number }>) =>
    rows.length
      ? `<h2>${escapeHtml(title)}</h2><table data-variant="statement"><thead><tr><th data-rule="header">Category</th><th data-rule="header" style="text-align:center;width:${W}">Amount</th></tr></thead><tbody>${rows
          .map((r) => `<tr>${labelCell(escapeHtml(r.category))}${moneyCell(r.cents, { width: W })}</tr>`)
          .join("")}</tbody></table>`
      : "";

  const budgetRows = (data.budgets ?? [])
    .map(
      (b: any) =>
        `<tr>${labelCell(escapeHtml(b.category))}${moneyCell(b.plannedCents, { width: "20%" })}${moneyCell(b.actualCents, { width: "20%" })}${moneyCell(b.varianceCents, { width: "20%" })}</tr>`,
    )
    .join("");
  const rem = (data.remunerationDisclosures ?? [])
    .map((r: any) => `<tr>${labelCell(escapeHtml(r.role))}${moneyCell(r.amountCents, { width: W })}</tr>`)
    .join("");

  // Income/expense broken down by the counterparty / grant tags on posted
  // journal lines. Only rendered when there is tagged activity.
  const partyTable = (title: string, label: string, rows: any[], nameKey: string) =>
    rows && rows.length
      ? `<h2>${escapeHtml(title)}</h2><table data-variant="statement"><thead><tr><th data-rule="header">${escapeHtml(label)}</th><th data-rule="header" style="text-align:center;width:24%">Income</th><th data-rule="header" style="text-align:center;width:24%">Expense</th></tr></thead><tbody>${rows
          .map((r: any) => `<tr>${labelCell(escapeHtml(r[nameKey] ?? "Unknown"))}${moneyCell(r.incomeCents ?? 0, { width: "24%" })}${moneyCell(r.expenseCents ?? 0, { width: "24%" })}</tr>`)
          .join("")}</tbody></table>`
      : "";

  return `
    <h1>Annual Financial Statement</h1>
    <p class="meta">${escapeHtml(society?.name ?? "")} · Fiscal year ${escapeHtml(fiscalYear)}${data.approvedByBoardAt ? ` · Approved by the board ${escapeHtml(data.approvedByBoardAt)}` : ""}</p>
    <h2>Statement of Operations</h2>
    <table data-variant="statement">
      <tbody>
        <tr>${labelCell("Total revenue")}${moneyCell(data.revenueCents ?? 0, { bold: true, width: W })}</tr>
        <tr>${labelCell("Total expenses")}${moneyCell(data.expensesCents ?? 0, { width: W })}</tr>
        <tr>${labelCell("Surplus / (Deficit)", { bold: true, rule: "top" })}${moneyCell(data.surplusCents ?? 0, { bold: true, rule: "top", width: W })}</tr>
        ${data.netAssetsCents != null ? `<tr>${labelCell("Net assets")}${moneyCell(data.netAssetsCents, { width: W })}</tr>` : ""}
        ${data.restrictedFundsCents != null ? `<tr>${labelCell("Restricted funds")}${moneyCell(data.restrictedFundsCents, { width: W })}</tr>` : ""}
      </tbody>
    </table>
    ${categoryTable("Revenue by category", data.incomeByCategory ?? [])}
    ${categoryTable("Expenses by category", data.expenseByCategory ?? [])}
    ${budgetRows ? `<h2>Budget vs actual</h2><table data-variant="statement"><thead><tr><th data-rule="header">Category</th><th data-rule="header" style="text-align:center;width:20%">Budget</th><th data-rule="header" style="text-align:center;width:20%">Actual</th><th data-rule="header" style="text-align:center;width:20%">Variance</th></tr></thead><tbody>${budgetRows}</tbody></table>` : ""}
    ${partyTable("By counterparty", "Counterparty", data.byCounterparty ?? [], "name")}
    ${partyTable("By grant", "Grant", data.byGrant ?? [], "title")}
    ${rem ? `<h2>Remuneration disclosure</h2><table data-variant="statement"><thead><tr><th data-rule="header">Role</th><th data-rule="header" style="text-align:center;width:${W}">Amount</th></tr></thead><tbody>${rem}</tbody></table>` : ""}
    ${data.auditStatus ? `<p class="meta">Audit status: ${escapeHtml(data.auditStatus)}${data.auditorName ? ` · ${escapeHtml(data.auditorName)}` : ""}</p>` : ""}
  `;
}

export function renderRestrictedFundsHtml(data: any, society: SocietyLike): string {
  const W = "15%";
  const rows = (data.funds ?? [])
    .map(
      (f: any) =>
        `<tr>${labelCell(`${escapeHtml(f.title)} <span class="meta">(${escapeHtml(f.funder)})</span>`)}${moneyCell(f.openingCents, { width: W })}${moneyCell(f.receiptsCents, { width: W })}${moneyCell(f.disbursementsCents, { width: W })}${moneyCell(f.closingCents, { bold: true, width: W })}</tr>`,
    )
    .join("");
  const t = data.totals ?? { openingCents: 0, receiptsCents: 0, disbursementsCents: 0, closingCents: 0 };
  return `
    <h1>Statement of Restricted Funds</h1>
    <p class="meta">${escapeHtml(society?.name ?? "")}</p>
    <table data-variant="statement">
      <thead>
        <tr><th data-rule="header">Fund</th><th data-rule="header" style="text-align:center;width:${W}">Opening</th><th data-rule="header" style="text-align:center;width:${W}">Receipts</th><th data-rule="header" style="text-align:center;width:${W}">Disbursements</th><th data-rule="header" style="text-align:center;width:${W}">Closing</th></tr>
      </thead>
      <tbody>
        ${rows || `<tr>${labelCell('<span class="muted">No restricted funds recorded.</span>')}${blankCells(4)}</tr>`}
        <tr>${labelCell("Total", { bold: true, rule: "top" })}${moneyCell(t.openingCents, { bold: true, rule: "top", width: W })}${moneyCell(t.receiptsCents, { bold: true, rule: "top", width: W })}${moneyCell(t.disbursementsCents, { bold: true, rule: "top", width: W })}${moneyCell(t.closingCents, { bold: true, rule: "top", width: W })}</tr>
      </tbody>
    </table>
    <p class="meta">Opening balances are tracked per period; funds opening at zero show their full-period activity.</p>
  `;
}

export function renderReadinessHtml(data: any, society: SocietyLike, fiscalYear: string): string {
  const mark = (item: any) => (item.ok ? "✓" : item.status === "upcoming" ? "○" : "✗");
  const rows = (data.items ?? [])
    .map(
      (item: any) =>
        `<tr><td style="text-align:center;width:12%">${mark(item)}</td>${labelCell(escapeHtml(item.label), { bold: true })}${labelCell(escapeHtml(item.detail))}</tr>`,
    )
    .join("");
  return `
    <h1>Year-End Readiness Checklist</h1>
    <p class="meta">${escapeHtml(society?.name ?? "")} · Fiscal year ${escapeHtml(fiscalYear)} · ${data.completed ?? 0} of ${data.total ?? 0} complete</p>
    <table data-variant="statement">
      <thead><tr><th data-rule="header" style="text-align:center;width:12%">Status</th><th data-rule="header" style="width:38%">Requirement</th><th data-rule="header">Detail</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}
