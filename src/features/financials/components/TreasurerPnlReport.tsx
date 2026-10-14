import { useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import type { Id } from "../../../../convex/_generated/dataModel";
import { ReportTable, type ReportColumn, type ReportRow } from "../../../components/ReportTable";
import { Segmented } from "../../../components/primitives";
import { formatDate } from "../../../lib/format";
import { formatMoney } from "../../../lib/money";
import { FinanceDrilldownDrawer, type DrilldownItem } from "./FinanceDrilldownDrawer";
import { CompareToggle } from "./FinanceReportControls";
import { shiftIsoYears } from "../lib/ledgerReports";

type View = "summary" | "quarterly" | "monthly";
type Kind = "income" | "expense";
type Meta = { kind: Kind; category: string };
type Pnl = {
  totalIncomeCents: number;
  totalExpenseCents: number;
  netCents: number;
  incomeByCategory: Array<{ category: string; cents: number }>;
  expenseByCategory: Array<{ category: string; cents: number }>;
  transactionCount: number;
};
type Txn = { _id: string; date: string; description?: string; counterparty?: string; amountCents: number; category?: string; accountId?: string };
type Drill = { kind: Kind; category: string; label: string; from: string; to: string; totalCents: number | null } | null;

/** Most recent bank transactions fetched for drilldown and period breakdowns. */
const TXN_LIMIT = 5000;

/** Same classification as the server P&L (cash basis): income account or positive amount. */
function classify(txn: Txn, accountTypeById: Map<string, string>) {
  const type = accountTypeById.get(String(txn.accountId)) ?? "Other";
  const category = txn.category ?? type;
  const kind: Kind = type === "Income" || txn.amountCents > 0 ? "income" : "expense";
  return { kind, category };
}

function monthsBetween(from: string, to: string) {
  const out: string[] = [];
  let [year, month] = from.slice(0, 7).split("-").map(Number);
  const end = to.slice(0, 7);
  for (let guard = 0; guard < 60; guard += 1) {
    const key = `${year}-${String(month).padStart(2, "0")}`;
    out.push(key);
    if (key >= end) break;
    month += 1;
    if (month > 12) { month = 1; year += 1; }
  }
  return out;
}

function lastDayOfMonth(ym: string) {
  const [year, month] = ym.split("-").map(Number);
  return `${ym}-${String(new Date(Date.UTC(year, month, 0)).getUTCDate()).padStart(2, "0")}`;
}

function buildPeriods(view: View, from: string, to: string) {
  const months = monthsBetween(from, to);
  if (view === "monthly") {
    return months.map((ym) => ({
      id: `m:${ym}`,
      label: formatDate(`${ym}-01`, "MMM yyyy"),
      from: ym === from.slice(0, 7) ? from : `${ym}-01`,
      to: ym === to.slice(0, 7) ? to : lastDayOfMonth(ym),
    }));
  }
  const quarters: Array<{ id: string; label: string; from: string; to: string }> = [];
  for (let index = 0; index < months.length; index += 3) {
    const chunk = months.slice(index, index + 3);
    const first = chunk[0];
    const last = chunk[chunk.length - 1];
    quarters.push({
      id: `q:${first}`,
      label: `Q${quarters.length + 1} · ${formatDate(`${first}-01`, "MMM")}–${formatDate(`${last}-01`, "MMM yyyy")}`,
      from: index === 0 ? from : `${first}-01`,
      to: last === to.slice(0, 7) ? to : lastDayOfMonth(last),
    });
  }
  return quarters;
}

/**
 * Treasurer profit & loss (cash basis, from bank transactions): income and
 * expenses by category with a prior-year comparison or a monthly/quarterly
 * breakdown, and drilldown into the transactions behind each amount.
 */
export function TreasurerPnlReport({
  societyId,
  from,
  to,
  pnl,
  accounts,
}: {
  societyId: Id<"societies">;
  from: string;
  to: string;
  pnl: Pnl | undefined;
  accounts: Array<{ _id: string; accountType?: string }> | undefined;
}) {
  const [view, setView] = useState<View>("summary");
  const [compare, setCompare] = useState(true);
  const [drill, setDrill] = useState<Drill>(null);
  const priorFrom = shiftIsoYears(from, -1);
  const priorTo = shiftIsoYears(to, -1);
  const comparing = compare && view === "summary";
  const priorPnl = useQuery(api.treasury.profitAndLoss, comparing ? { societyId, from: priorFrom, to: priorTo } : "skip") as Pnl | undefined;
  const needsTransactions = view !== "summary" || Boolean(drill);
  const transactions = useQuery(api.financialHub.transactions, needsTransactions ? { societyId, limit: TXN_LIMIT } : "skip") as Txn[] | undefined;
  const accountTypeById = useMemo(() => new Map((accounts ?? []).map((account) => [String(account._id), String(account.accountType ?? "")])), [accounts]);
  const validRange = /^\d{4}-\d{2}-\d{2}$/.test(from) && /^\d{4}-\d{2}-\d{2}$/.test(to) && from <= to;

  // Only break down by period when the fetched transactions reach back past the start date.
  const coverage = useMemo(() => {
    if (!transactions) return { loaded: false, complete: false };
    const oldest = transactions[transactions.length - 1]?.date;
    return { loaded: true, complete: transactions.length < TXN_LIMIT || (oldest != null && oldest <= from) };
  }, [transactions, from]);

  const periods = useMemo(() => (view === "summary" || !validRange ? [] : buildPeriods(view, from, to)), [view, from, to, validRange]);

  const breakdown = useMemo(() => {
    const totals = new Map<string, number>();
    if (!transactions || view === "summary") return totals;
    for (const txn of transactions) {
      if (txn.date < from || txn.date > to) continue;
      const { kind, category } = classify(txn, accountTypeById);
      const period = periods.find((candidate) => txn.date >= candidate.from && txn.date <= candidate.to);
      if (!period) continue;
      const key = `${kind}|${category}|${period.id}`;
      totals.set(key, (totals.get(key) ?? 0) + Math.abs(txn.amountCents));
    }
    return totals;
  }, [transactions, view, from, to, periods, accountTypeById]);

  const columns: ReportColumn[] = view === "summary"
    ? [
        { id: "current", label: `${formatDate(from)} – ${formatDate(to)}`, title: "Selected period", emphasis: comparing },
        ...(comparing ? [{ id: "prior", label: `${formatDate(priorFrom)} – ${formatDate(priorTo)}`, title: "Same period last year" }] : []),
      ]
    : [...periods.map((period) => ({ id: period.id, label: period.label, title: period.label })), { id: "current", label: "Total", title: "Total", emphasis: true }];

  const rows = useMemo(() => {
    if (!pnl) return [];
    const categoryRows = (kind: Kind, current: Array<{ category: string; cents: number }>, prior: Array<{ category: string; cents: number }> | undefined) => {
      const priorBy = new Map((prior ?? []).map((row) => [row.category, row.cents]));
      const names = Array.from(new Set([...current.map((row) => row.category), ...(prior ?? []).map((row) => row.category)]));
      const currentBy = new Map(current.map((row) => [row.category, row.cents]));
      return names
        .sort((a, b) => (currentBy.get(b) ?? 0) - (currentBy.get(a) ?? 0) || a.localeCompare(b))
        .map((category): ReportRow<Meta> => {
          const values: Record<string, number | undefined> = { current: currentBy.get(category) ?? 0 };
          if (comparing) values.prior = priorBy.get(category) ?? 0;
          for (const period of periods) values[period.id] = breakdown.get(`${kind}|${category}|${period.id}`) ?? 0;
          return { id: `${kind}:${category}`, kind: "row", label: category, favourable: kind === "income" ? "increase" : "decrease", values, meta: { kind, category } };
        });
    };
    const periodTotals = (kind: Kind) => Object.fromEntries(periods.map((period) => [
      period.id,
      Array.from(breakdown.entries()).filter(([key]) => key.startsWith(`${kind}|`) && key.endsWith(`|${period.id}`)).reduce((sum, [, cents]) => sum + cents, 0),
    ]));
    const incomeTotals = { current: pnl.totalIncomeCents, prior: comparing ? priorPnl?.totalIncomeCents : undefined, ...periodTotals("income") };
    const expenseTotals = { current: pnl.totalExpenseCents, prior: comparing ? priorPnl?.totalExpenseCents : undefined, ...periodTotals("expense") };
    const net: Record<string, number | undefined> = {};
    for (const key of Object.keys(incomeTotals)) {
      const income = (incomeTotals as Record<string, number | undefined>)[key];
      const expense = (expenseTotals as Record<string, number | undefined>)[key];
      net[key] = income == null && expense == null ? undefined : (income ?? 0) - (expense ?? 0);
    }
    const incomeChildren = categoryRows("income", pnl.incomeByCategory, comparing ? priorPnl?.incomeByCategory : undefined);
    const expenseChildren = categoryRows("expense", pnl.expenseByCategory, comparing ? priorPnl?.expenseByCategory : undefined);
    const out: ReportRow<Meta>[] = [
      {
        id: "income",
        kind: "section",
        label: "Income",
        children: incomeChildren.length ? incomeChildren : [{ id: "income:none", kind: "note", label: "No income transactions in this period." }],
      },
      { id: "income-total", kind: "subtotal", label: "Total income", favourable: "increase", values: incomeTotals },
      {
        id: "expense",
        kind: "section",
        label: "Expenses",
        children: expenseChildren.length ? expenseChildren : [{ id: "expense:none", kind: "note", label: "No expense transactions in this period." }],
      },
      { id: "expense-total", kind: "subtotal", label: "Total expenses", favourable: "decrease", values: expenseTotals },
      { id: "net", kind: "total", label: "Net surplus / (deficit)", calculated: true, favourable: "increase", note: "Total income less total expenses.", values: net },
    ];
    return out;
  }, [pnl, priorPnl, comparing, periods, breakdown]);

  const drillItems: DrilldownItem[] = useMemo(() => {
    if (!drill || !transactions || !coverage.complete) return [];
    return transactions
      .filter((txn) => txn.date >= drill.from && txn.date <= drill.to)
      .filter((txn) => {
        const { kind, category } = classify(txn, accountTypeById);
        return kind === drill.kind && category === drill.category;
      })
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((txn) => ({
        id: String(txn._id),
        date: txn.date,
        primary: txn.description || txn.counterparty || "Bank transaction",
        secondary: txn.counterparty && txn.description ? txn.counterparty : undefined,
        amountCents: txn.amountCents,
        transactionHref: `/app/financials?tab=transactions&transaction=${encodeURIComponent(String(txn._id))}`,
      }));
  }, [drill, transactions, coverage.complete, accountTypeById]);

  const viewDisabledReason = coverage.loaded && !coverage.complete
    ? `Only the ${TXN_LIMIT.toLocaleString("en-CA")} most recent transactions are loaded, which don't reach back to ${formatDate(from)}.`
    : null;

  return (
    <>
      <ReportTable<Meta>
        ariaLabel="Profit and loss"
        labelHeader="Category"
        loading={pnl === undefined || (view !== "summary" && !coverage.loaded)}
        columns={columns}
        rows={rows}
        comparison={comparing ? { current: "current", prior: "prior" } : null}
        drillColumn="current"
        onDrilldown={(row, column) => {
          if (!row.meta) return;
          const period = periods.find((candidate) => candidate.id === column.id);
          const isPrior = column.id === "prior";
          setDrill({
            kind: row.meta.kind,
            category: row.meta.category,
            label: `${row.meta.category} · ${row.meta.kind === "income" ? "income" : "expenses"}`,
            from: period ? period.from : isPrior ? priorFrom : from,
            to: period ? period.to : isPrior ? priorTo : to,
            totalCents: row.values?.[column.id] ?? null,
          });
        }}
        toolbar={
          <>
            <Segmented<View>
              value={view}
              onChange={(next) => setView(next)}
              items={[
                { id: "summary", label: "Summary" },
                { id: "quarterly", label: "Quarterly" },
                { id: "monthly", label: "Monthly" },
              ]}
            />
            {view === "summary" && <CompareToggle checked={compare} onChange={setCompare} />}
          </>
        }
        empty="No transactions in this period."
      />
      {view !== "summary" && viewDisabledReason && (
        <p className="finance-report-note" role="status">
          Period columns are incomplete: {viewDisabledReason} Use the summary view for full-period totals.
        </p>
      )}
      <FinanceDrilldownDrawer
        open={Boolean(drill)}
        onClose={() => setDrill(null)}
        title={drill?.label ?? "Category"}
        subtitle={drill ? `Bank transactions ${formatDate(drill.from)} to ${formatDate(drill.to)} (cash basis)` : undefined}
        totalCents={drill?.totalCents ?? null}
        items={drillItems}
        composition={
          drill && (!coverage.loaded ? (
            <p>Loading transactions…</p>
          ) : !coverage.complete ? (
            <p>
              This amount is the sum of every bank transaction categorised “{drill.category}” in the period
              {drill.totalCents != null ? ` (${formatMoney(drill.totalCents)})` : ""}. {viewDisabledReason} Open
              Financials → Transactions to review them.
            </p>
          ) : undefined)
        }
        emptyText="No bank transactions in this category for the period."
      />
    </>
  );
}
