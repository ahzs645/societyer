import { useMemo, useState } from "react";
import { ReportTable, type ReportColumn, type ReportRow } from "../../../components/ReportTable";
import { formatDate } from "../../../lib/format";
import { formatMoney } from "../../../lib/money";
import { buildAccountingStatements, type CurrencyStatement, type StatementRow } from "../../../../shared/accountingStatements";
import { FinanceDrilldownDrawer } from "./FinanceDrilldownDrawer";
import { ledgerLineToDrilldownItem } from "./TrialBalanceReport";
import { type LedgerLine } from "../lib/ledgerReports";
import { hasOwnAmounts, rollupAccounts, type RollupNode } from "../lib/accountRollup";
import type { HierarchyAccount } from "../../../../shared/accountHierarchy";

type Meta = { accountId?: string; /** The account and its sub-accounts, for a rolled-up row. */ accountIds?: string[]; scope: "balance" | "period" };
type Built = ReturnType<typeof buildAccountingStatements>;
type Drill = { accountIds: string[]; label: string; currency: string; scope: "balance" | "period"; from: string; to: string } | null;

function byAccount(rows: StatementRow[] | undefined) {
  return new Map((rows ?? []).map((row) => [row.accountId, row]));
}

/** Merge current and prior statement rows into one ordered list of accounts. */
function mergedAccounts(current: StatementRow[] | undefined, prior: StatementRow[] | undefined) {
  const merged = new Map<string, StatementRow>();
  for (const row of [...(prior ?? []), ...(current ?? [])]) merged.set(row.accountId, row);
  return Array.from(merged.values()).sort((a, b) => `${a.code}:${a.name}`.localeCompare(`${b.code}:${b.name}`));
}

function sectionRows(
  id: string,
  label: string,
  current: StatementRow[] | undefined,
  prior: StatementRow[] | undefined,
  totalCurrent: number,
  totalPrior: number | undefined,
  scope: "balance" | "period",
  favourable?: "increase" | "decrease",
  chart?: HierarchyAccount[],
): ReportRow<Meta>[] {
  const now = byAccount(current);
  const before = byAccount(prior);
  const accounts = mergedAccounts(current, prior);
  // Sub-accounts nest under their parent, whose row carries the rolled-up total.
  const tree = rollupAccounts(
    accounts.map((account) => ({
      accountId: account.accountId,
      code: account.code || undefined,
      name: account.name,
      values: { current: now.get(account.accountId)?.amountCents ?? 0, prior: before.get(account.accountId)?.amountCents ?? 0 },
    })),
    chart,
  );
  const toRow = (node: RollupNode): ReportRow<Meta> => {
    const row: ReportRow<Meta> = {
      id: `${id}:${node.accountId}`,
      kind: "row",
      code: node.code || undefined,
      label: node.name,
      favourable,
      values: node.total,
      meta: { accountId: node.accountId, accountIds: node.accountIds, scope },
    };
    if (!node.children.length) return row;
    const own: ReportRow<Meta>[] = hasOwnAmounts(node)
      ? [{ id: `${id}:${node.accountId}:own`, kind: "row", label: `${node.name}, other`, title: `${node.name}, posted to the parent account`, favourable, values: node.own!, meta: { accountId: node.accountId, accountIds: [node.accountId], scope } }]
      : [];
    return { ...row, title: `${node.name}, including sub-accounts`, children: [...own, ...node.children.map(toRow)] };
  };
  return [
    {
      id: `section:${id}`,
      kind: "section",
      label,
      children: tree.length
        ? tree.map(toRow)
        : [{ id: `${id}:none`, kind: "note" as const, label: `No ${label.toLowerCase()} accounts with posted lines.` }],
    },
    {
      id: `subtotal:${id}`,
      kind: "subtotal",
      label: `Total ${label.toLowerCase()}`,
      favourable,
      values: { current: totalCurrent, prior: totalPrior },
    },
  ];
}

export type StatementPeriods = { from: string; to: string; priorFrom: string; priorTo: string };

/**
 * Columns and rows for one currency's balance sheet and income statement,
 * shared by the on-screen report and the Excel workbook download.
 */
export function statementTables(statement: CurrencyStatement, priorReport: Built | null, { from, to, priorFrom, priorTo }: StatementPeriods, chart?: HierarchyAccount[]) {
  const comparing = Boolean(priorReport);
  const prior = priorReport?.statements.find((candidate) => candidate.currency === statement.currency);
  const balanceColumns: ReportColumn[] = [
    { id: "current", label: `As at ${formatDate(to)}`, title: `As at ${formatDate(to)}`, emphasis: comparing },
    ...(comparing ? [{ id: "prior", label: `As at ${formatDate(priorTo)}`, title: `As at ${formatDate(priorTo)}` }] : []),
  ];
  const periodColumns: ReportColumn[] = [
    { id: "current", label: `${formatDate(from, "MMM d, yyyy")} – ${formatDate(to, "MMM d, yyyy")}`, title: "Current period", emphasis: comparing },
    ...(comparing ? [{ id: "prior", label: `${formatDate(priorFrom, "MMM d, yyyy")} – ${formatDate(priorTo, "MMM d, yyyy")}`, title: "Prior period" }] : []),
  ];
  const balanceRows: ReportRow<Meta>[] = [
    ...sectionRows("assets", "Assets", statement.assets, prior?.assets, statement.totalAssetsCents, (comparing ? prior?.totalAssetsCents ?? 0 : undefined), "balance", "increase", chart),
    ...sectionRows("liabilities", "Liabilities", statement.liabilities, prior?.liabilities, statement.totalLiabilitiesCents, (comparing ? prior?.totalLiabilitiesCents ?? 0 : undefined), "balance", "decrease", chart),
    ...sectionRows("equity", "Net assets / equity", statement.equity, prior?.equity, statement.totalEquityCents, (comparing ? prior?.totalEquityCents ?? 0 : undefined), "balance", undefined, chart),
    {
      id: "unclosed",
      kind: "row",
      label: `Unclosed earnings through ${formatDate(to)}`,
      calculated: true,
      drilldown: false,
      note: "Revenue less expenses posted but not yet closed to net assets. It is what keeps the statement in balance until year-end closing entries are posted.",
      values: { current: statement.unclosedEarningsCents, prior: (comparing ? prior?.unclosedEarningsCents ?? 0 : undefined) },
    },
    {
      id: "total-le",
      kind: "total",
      label: "Liabilities and net assets including unclosed earnings",
      values: {
        current: statement.totalLiabilitiesCents + statement.totalEquityCents + statement.unclosedEarningsCents,
        prior: prior ? prior.totalLiabilitiesCents + prior.totalEquityCents + prior.unclosedEarningsCents : comparing ? 0 : undefined,
      },
    },
  ];
  const incomeRows: ReportRow<Meta>[] = [
    ...sectionRows("income", "Revenue", statement.income, prior?.income, statement.totalIncomeCents, (comparing ? prior?.totalIncomeCents ?? 0 : undefined), "period", "increase", chart),
    ...sectionRows("expenses", "Expenses", statement.expenses, prior?.expenses, statement.totalExpenseCents, (comparing ? prior?.totalExpenseCents ?? 0 : undefined), "period", "decrease", chart),
    {
      id: "net",
      kind: "total",
      label: "Net income / (deficit)",
      calculated: true,
      favourable: "increase",
      note: "Total revenue less total expenses for the period.",
      values: { current: statement.netIncomeCents, prior: (comparing ? prior?.netIncomeCents ?? 0 : undefined) },
    },
  ];
  return { prior, balanceColumns, periodColumns, balanceRows, incomeRows };
}

/**
 * Balance sheet (statement of financial position) and income statement from
 * posted journals, per currency, with optional prior-period comparatives and
 * amount drilldown into the journal lines.
 */
export function FinancialStatementsReport({
  lines,
  report,
  priorReport,
  from,
  to,
  priorFrom,
  priorTo,
  fundNames,
  fundFiltered,
  accounts,
}: {
  /** Chart of accounts, so sub-accounts nest under their parent. */
  accounts?: HierarchyAccount[];
  lines: LedgerLine[];
  report: Built;
  priorReport: Built | null;
  from: string;
  to: string;
  priorFrom: string;
  priorTo: string;
  fundNames: Map<string, string>;
  fundFiltered: boolean;
}) {
  const [drill, setDrill] = useState<Drill>(null);
  const comparing = Boolean(priorReport);

  const drillItems = useMemo(() => {
    if (!drill) return [];
    return lines
      .filter((line) => drill.accountIds.includes(String(line.accountId)) && line.entry.date <= drill.to && (drill.scope === "balance" || line.entry.date >= drill.from))
      .sort((a, b) => a.entry.date.localeCompare(b.entry.date))
      .map((line) => ledgerLineToDrilldownItem(line, fundNames));
  }, [drill, lines, fundNames]);

  const openDrill = (statement: CurrencyStatement, row: ReportRow<Meta>, columnId: string) => {
    if (!row.meta?.accountId) return;
    const isPrior = columnId === "prior";
    setDrill({
      accountIds: row.meta.accountIds ?? [row.meta.accountId],
      label: `${row.code ? `${row.code} · ` : ""}${row.title ?? String(row.label)}`,
      currency: statement.currency,
      scope: row.meta.scope,
      from: isPrior ? priorFrom : from,
      to: isPrior ? priorTo : to,
    });
  };

  if (report.statements.length === 0) return null;

  return (
    <>
      {report.statements.map((statement) => {
        const { prior, balanceColumns, periodColumns, balanceRows, incomeRows } = statementTables(statement, priorReport, { from, to, priorFrom, priorTo }, accounts);
        return (
          <div key={statement.currency} className="finance-statement-stack">
            <h3 className="finance-report-heading">{statement.currency} · Balance sheet as at {formatDate(to)}</h3>
            <ReportTable<Meta>
              ariaLabel={`${statement.currency} balance sheet`}
              currency={statement.currency}
              download={{
                fileName: `Balance sheet ${statement.currency} ${to}`,
                sheetName: `Balance sheet ${statement.currency}`,
                title: [`Balance sheet as at ${formatDate(to)}`, comparing ? `${statement.currency} · compared with ${formatDate(priorTo)}` : statement.currency],
              }}
              columns={balanceColumns}
              rows={balanceRows}
              comparison={comparing ? { current: "current", prior: "prior" } : null}
              onDrilldown={(row, column) => openDrill(statement, row, column.id)}
              maxHeight="none"
            />
            {!fundFiltered && statement.balanceDifferenceCents !== 0 && (
              <p role="alert">
                Balance difference: {formatMoney(statement.balanceDifferenceCents, { currency: statement.currency, negativeStyle: "parentheses" })}. Review account classifications, opening balances, and journal completeness.
              </p>
            )}
            <h3 className="finance-report-heading">{statement.currency} · Income statement {formatDate(from)} to {formatDate(to)}</h3>
            <ReportTable<Meta>
              ariaLabel={`${statement.currency} income statement`}
              currency={statement.currency}
              download={{
                fileName: `Income statement ${statement.currency} ${from} to ${to}`,
                sheetName: `Income statement ${statement.currency}`,
                title: [`Income statement ${formatDate(from)} to ${formatDate(to)}`, comparing ? `${statement.currency} · compared with ${formatDate(priorFrom)} to ${formatDate(priorTo)}` : statement.currency],
              }}
              columns={periodColumns}
              rows={incomeRows}
              comparison={comparing ? { current: "current", prior: "prior" } : null}
              onDrilldown={(row, column) => openDrill(statement, row, column.id)}
              maxHeight="none"
            />
          </div>
        );
      })}
      <FinanceDrilldownDrawer
        open={Boolean(drill)}
        onClose={() => setDrill(null)}
        title={drill?.label ?? "Account"}
        subtitle={drill ? (drill.scope === "balance" ? `All posted lines through ${formatDate(drill.to)}` : `Posted lines ${formatDate(drill.from)} to ${formatDate(drill.to)}`) : undefined}
        totalCents={drill ? drillItems.reduce((sum, item) => sum + (item.debitCents ?? 0) - (item.creditCents ?? 0), 0) : null}
        totalLabel="Net (debit − credit)"
        currency={drill?.currency}
        items={drillItems}
      />
    </>
  );
}
