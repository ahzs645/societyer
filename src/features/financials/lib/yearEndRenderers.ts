import { escapeHtml } from "../../../lib/html";
import { money } from "../../../lib/format";
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

function numCell(cents: number, opts?: { bold?: boolean }) {
  const inner = opts?.bold ? `<strong>${escapeHtml(money(cents))}</strong>` : escapeHtml(money(cents));
  return `<td style="text-align:right">${inner}</td>`;
}

function lineRows(lines: ProgramStatementLine[]) {
  return lines
    .map(
      (line) =>
        `<tr><td>${escapeHtml(line.label)}${line.notes ? ` <span class="meta">(${escapeHtml(line.notes)})</span>` : ""}</td>${numCell(line.actualCents)}${numCell(line.budgetCents)}</tr>`,
    )
    .join("");
}

/**
 * Reproduces the BC Community Gaming Grants "Program Actual Revenue and Expenses
 * and Budget" supporting document: two columns (prior-year actuals vs
 * current-year budget), itemized revenues and expenses, totals, and
 * surplus/deficit, with the form's footnotes.
 */
export function renderProgramStatementHtml(statement: ProgramStatement, society?: SocietyLike): string {
  const totals = computeStatementTotals(statement);
  return `
    <h1>Program Actual Revenue and Expenses and Budget</h1>
    <p class="meta">${escapeHtml(society?.name ?? "")}${statement.funderName ? ` · ${escapeHtml(statement.funderName)}` : ""}</p>
    <table>
      <thead>
        <tr>
          <th>${escapeHtml(statement.programName || "[Program Name]")}</th>
          <th style="text-align:right">Program Actuals for<br/>${escapeHtml(statement.priorFiscalYearLabel)}</th>
          <th style="text-align:right">Program Budget for<br/>${escapeHtml(statement.currentFiscalYearLabel)}</th>
        </tr>
      </thead>
      <tbody>
        <tr><td><strong>Program Revenues<sup>1</sup></strong></td><td></td><td></td></tr>
        ${lineRows(statement.revenues)}
        <tr><td><strong>Total Revenues</strong></td>${numCell(totals.revenueActualCents, { bold: true })}${numCell(totals.revenueBudgetCents, { bold: true })}</tr>
        <tr><td><strong>Program Expenses</strong></td><td></td><td></td></tr>
        ${lineRows(statement.expenses)}
        <tr><td><strong>Total Expenses</strong></td>${numCell(totals.expenseActualCents, { bold: true })}${numCell(totals.expenseBudgetCents, { bold: true })}</tr>
        <tr><td><strong><em>Surplus / Deficit</em></strong></td>${numCell(totals.surplusActualCents, { bold: true })}${numCell(totals.surplusBudgetCents, { bold: true })}</tr>
      </tbody>
    </table>
    ${statement.narrative ? `<h2>Notes</h2><p>${escapeHtml(statement.narrative)}</p>` : ""}
    <p class="meta"><sup>1</sup> Itemize funding sources. Do not use abbreviations or acronyms.</p>
    <p class="meta"><sup>2</sup> The Community Gaming Grant amount should equal the Program Grant used for this program in the previous fiscal year (actuals) and/or requested for the current fiscal year (budget). If grant funds were used toward organizational costs (up to 15% of the total Program Grant), this amount may be less than the funding received for this program.</p>
  `;
}

function orgNum(cents: number, opts?: { bold?: boolean }) {
  const inner = opts?.bold ? `<strong>${escapeHtml(money(cents))}</strong>` : escapeHtml(money(cents));
  return `<td style="text-align:right">${inner}</td>`;
}

function orgLineRows(lines: OrgStatementLine[]) {
  return lines
    .map(
      (line) =>
        `<tr><td>${escapeHtml(line.label)}</td>${orgNum(line.generalCents)}${orgNum(line.restrictedCents)}${orgNum(lineTotalCents(line), { bold: true })}</tr>`,
    )
    .join("");
}

/**
 * Organisation-wide Statement of Revenues & Expenses for the fiscal year,
 * derived from the finance ledger. Three columns: General Fund (unrestricted) /
 * Restricted Funds / Total, with itemized revenues and expenses, totals, and
 * "Excess of Revenues over Expenses" per fund.
 */
export function renderOrgStatementHtml(statement: OrgRevenueStatement, society?: SocietyLike): string {
  const totalRow = (label: string, c: OrgStatementColumnTotals, italic = false) =>
    `<tr><td>${italic ? "<em>" : "<strong>"}${escapeHtml(label)}${italic ? "</em>" : "</strong>"}</td>${orgNum(c.generalCents, { bold: true })}${orgNum(c.restrictedCents, { bold: true })}${orgNum(c.totalCents, { bold: true })}</tr>`;
  return `
    <h1>Statement of Revenues &amp; Expenses</h1>
    <p class="meta">${escapeHtml(statement.organizationName || society?.name || "[Name of Organization]")}${statement.periodLabel ? ` · ${escapeHtml(statement.periodLabel)}` : ` · Fiscal year ${escapeHtml(statement.fiscalYearLabel)}`}</p>
    <table>
      <thead>
        <tr><th></th><th style="text-align:right">General Fund</th><th style="text-align:right">Restricted Funds</th><th style="text-align:right">Total</th></tr>
      </thead>
      <tbody>
        <tr><td><strong>Revenues<sup>1</sup></strong></td><td></td><td></td><td></td></tr>
        ${statement.revenues.length ? orgLineRows(statement.revenues) : `<tr><td colspan="4" class="muted">No revenue recorded for this period.</td></tr>`}
        ${totalRow("Total Revenues", statement.revenueTotals)}
        <tr><td><strong>Expenses</strong></td><td></td><td></td><td></td></tr>
        ${statement.expenses.length ? orgLineRows(statement.expenses) : `<tr><td colspan="4" class="muted">No expenses recorded for this period.</td></tr>`}
        ${totalRow("Total Expenses", statement.expenseTotals)}
        ${totalRow("Excess of Revenues over Expenses", statement.excess, true)}
      </tbody>
    </table>
    <p class="meta"><sup>1</sup> Organisation-wide statement covering all programs and services for the fiscal year, derived from the finance ledger. Restricted Funds are amounts held in restricted-purpose funds or accounts; everything else is unrestricted General Fund activity.</p>
  `;
}

export function renderAnnualStatementHtml(data: any, society: SocietyLike, fiscalYear: string): string {
  const incomeRows = (data.incomeByCategory ?? [])
    .map((r: any) => `<tr><td>${escapeHtml(r.category)}</td>${numCell(r.cents)}</tr>`)
    .join("");
  const expenseRows = (data.expenseByCategory ?? [])
    .map((r: any) => `<tr><td>${escapeHtml(r.category)}</td>${numCell(r.cents)}</tr>`)
    .join("");
  const budgetRows = (data.budgets ?? [])
    .map(
      (b: any) =>
        `<tr><td>${escapeHtml(b.category)}</td>${numCell(b.plannedCents)}${numCell(b.actualCents)}${numCell(b.varianceCents)}</tr>`,
    )
    .join("");
  const rem = (data.remunerationDisclosures ?? [])
    .map((r: any) => `<tr><td>${escapeHtml(r.role)}</td>${numCell(r.amountCents)}</tr>`)
    .join("");

  return `
    <h1>Annual Financial Statement</h1>
    <p class="meta">${escapeHtml(society?.name ?? "")} · Fiscal year ${escapeHtml(fiscalYear)}${data.approvedByBoardAt ? ` · Approved by the board ${escapeHtml(data.approvedByBoardAt)}` : ""}</p>
    <h2>Statement of Operations</h2>
    <table>
      <tr><th>Total revenue</th>${numCell(data.revenueCents ?? 0, { bold: true })}</tr>
      <tr><th>Total expenses</th>${numCell(data.expensesCents ?? 0, { bold: true })}</tr>
      <tr><th>Surplus / (Deficit)</th>${numCell(data.surplusCents ?? 0, { bold: true })}</tr>
      ${data.netAssetsCents != null ? `<tr><th>Net assets</th>${numCell(data.netAssetsCents, { bold: true })}</tr>` : ""}
      ${data.restrictedFundsCents != null ? `<tr><th>Restricted funds</th>${numCell(data.restrictedFundsCents, { bold: true })}</tr>` : ""}
    </table>
    ${incomeRows ? `<h2>Revenue by category</h2><table><thead><tr><th>Category</th><th style="text-align:right">Amount</th></tr></thead><tbody>${incomeRows}</tbody></table>` : ""}
    ${expenseRows ? `<h2>Expenses by category</h2><table><thead><tr><th>Category</th><th style="text-align:right">Amount</th></tr></thead><tbody>${expenseRows}</tbody></table>` : ""}
    ${budgetRows ? `<h2>Budget vs actual</h2><table><thead><tr><th>Category</th><th style="text-align:right">Budget</th><th style="text-align:right">Actual</th><th style="text-align:right">Variance</th></tr></thead><tbody>${budgetRows}</tbody></table>` : ""}
    ${rem ? `<h2>Remuneration disclosure</h2><table><thead><tr><th>Role</th><th style="text-align:right">Amount</th></tr></thead><tbody>${rem}</tbody></table>` : ""}
    ${data.auditStatus ? `<p class="meta">Audit status: ${escapeHtml(data.auditStatus)}${data.auditorName ? ` · ${escapeHtml(data.auditorName)}` : ""}</p>` : ""}
  `;
}

export function renderRestrictedFundsHtml(data: any, society: SocietyLike): string {
  const rows = (data.funds ?? [])
    .map(
      (f: any) =>
        `<tr><td>${escapeHtml(f.title)} <span class="meta">(${escapeHtml(f.funder)})</span></td>${numCell(f.openingCents)}${numCell(f.receiptsCents)}${numCell(f.disbursementsCents)}${numCell(f.closingCents, { bold: true })}</tr>`,
    )
    .join("");
  const t = data.totals ?? { openingCents: 0, receiptsCents: 0, disbursementsCents: 0, closingCents: 0 };
  return `
    <h1>Statement of Restricted Funds</h1>
    <p class="meta">${escapeHtml(society?.name ?? "")}</p>
    <table>
      <thead>
        <tr><th>Fund</th><th style="text-align:right">Opening</th><th style="text-align:right">Receipts</th><th style="text-align:right">Disbursements</th><th style="text-align:right">Closing</th></tr>
      </thead>
      <tbody>
        ${rows || `<tr><td colspan="5" class="muted">No restricted funds recorded.</td></tr>`}
        <tr><td><strong>Total</strong></td>${numCell(t.openingCents, { bold: true })}${numCell(t.receiptsCents, { bold: true })}${numCell(t.disbursementsCents, { bold: true })}${numCell(t.closingCents, { bold: true })}</tr>
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
        `<tr><td>${mark(item)}</td><td>${escapeHtml(item.label)}</td><td>${escapeHtml(item.detail)}</td></tr>`,
    )
    .join("");
  return `
    <h1>Year-End Readiness Checklist</h1>
    <p class="meta">${escapeHtml(society?.name ?? "")} · Fiscal year ${escapeHtml(fiscalYear)} · ${data.completed ?? 0} of ${data.total ?? 0} complete</p>
    <table>
      <thead><tr><th>Status</th><th>Requirement</th><th>Detail</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}
