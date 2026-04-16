import { useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { useSociety } from "../hooks/useSociety";
import { PageHeader, SeedPrompt } from "./_helpers";
import { PiggyBank, TrendingUp, TrendingDown, AlertTriangle, DollarSign } from "lucide-react";
import { Badge } from "../components/ui";

function cents(value: number): string {
  const abs = Math.abs(value);
  const str = (abs / 100).toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return value < 0 ? `($${str})` : `$${str}`;
}

function getFiscalYearBounds(fyEnd: string | undefined) {
  const now = new Date();
  const year = now.getFullYear();
  const from = `${year}-01-01`;
  const to = fyEnd ? `${year}-${fyEnd.slice(5)}` : `${year}-12-31`;
  return { from, to, fy: String(year) };
}

export function TreasurerPage() {
  const society = useSociety();
  const { from: defaultFrom, to: defaultTo, fy: defaultFy } = useMemo(
    () => getFiscalYearBounds(society?.fiscalYearEnd),
    [society?.fiscalYearEnd],
  );
  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(defaultTo);
  const [fy, setFy] = useState(defaultFy);

  const pnl = useQuery(
    api.treasury.profitAndLoss,
    society ? { societyId: society._id, from, to } : "skip",
  );
  const variance = useQuery(
    api.treasury.budgetVariance,
    society ? { societyId: society._id, fiscalYear: fy } : "skip",
  );
  const restricted = useQuery(
    api.treasury.restrictedFunds,
    society ? { societyId: society._id } : "skip",
  );

  if (society === undefined) return <div className="page">Loading…</div>;
  if (society === null) return <SeedPrompt />;

  const incomeEntries = pnl
    ? Object.entries(pnl.incomeByCategory as Record<string, number>)
    : [];
  const expenseEntries = pnl
    ? Object.entries(pnl.expenseByCategory as Record<string, number>)
    : [];

  return (
    <div className="page">
      <PageHeader
        title="Treasurer dashboard"
        icon={<PiggyBank size={16} />}
        iconColor="green"
        subtitle="P&L summary, budget variance, and restricted-fund balances."
      />

      {/* date range */}
      <div className="card">
        <div className="card__body row" style={{ gap: 12, flexWrap: "wrap", alignItems: "center" }}>
          <label className="row" style={{ gap: 6 }}>
            <span className="muted">From</span>
            <input type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label className="row" style={{ gap: 6 }}>
            <span className="muted">To</span>
            <input type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
          <label className="row" style={{ gap: 6 }}>
            <span className="muted">FY</span>
            <input className="input" value={fy} onChange={(e) => setFy(e.target.value)} style={{ width: 80 }} />
          </label>
        </div>
      </div>

      {/* P&L */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 12 }}>
        <SummaryCard label="Income" value={pnl?.totalIncomeCents ?? 0} icon={<TrendingUp size={14} />} color="green" />
        <SummaryCard label="Expenses" value={-(pnl?.totalExpenseCents ?? 0)} icon={<TrendingDown size={14} />} color="red" />
        <SummaryCard label="Net" value={pnl?.netCents ?? 0} icon={<DollarSign size={14} />} color={pnl && pnl.netCents < 0 ? "red" : "green"} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div className="card">
          <div className="card__head"><h2 className="card__title">Income by category</h2></div>
          <div className="card__body col" style={{ gap: 4 }}>
            {incomeEntries.length === 0 && <div className="muted">No income transactions in this period.</div>}
            {incomeEntries.map(([cat, amt]) => (
              <div key={cat} className="row" style={{ justifyContent: "space-between" }}>
                <span>{cat}</span>
                <span className="mono">{cents(amt)}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="card">
          <div className="card__head"><h2 className="card__title">Expenses by category</h2></div>
          <div className="card__body col" style={{ gap: 4 }}>
            {expenseEntries.length === 0 && <div className="muted">No expense transactions in this period.</div>}
            {expenseEntries.map(([cat, amt]) => (
              <div key={cat} className="row" style={{ justifyContent: "space-between" }}>
                <span>{cat}</span>
                <span className="mono">{cents(amt)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Budget variance */}
      <div className="card">
        <div className="card__head">
          <h2 className="card__title">Budget variance — FY {fy}</h2>
          <span className="card__subtitle">Budget line vs. actual spend</span>
        </div>
        <div className="card__body">
          {(!variance || variance.length === 0) && (
            <div className="muted">No budgets defined for this fiscal year. Add budgets in Financials.</div>
          )}
          {variance && variance.length > 0 && (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "var(--fs-md)" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--border)" }}>
                  <th style={{ textAlign: "left", padding: "6px 8px" }}>Category</th>
                  <th style={{ textAlign: "right", padding: "6px 8px" }}>Budget</th>
                  <th style={{ textAlign: "right", padding: "6px 8px" }}>Actual</th>
                  <th style={{ textAlign: "right", padding: "6px 8px" }}>Variance</th>
                  <th style={{ textAlign: "center", padding: "6px 8px" }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {variance.map((row) => {
                  const overBudget = row.varianceCents > 0;
                  return (
                    <tr
                      key={row.category}
                      style={{
                        borderBottom: "1px solid var(--border)",
                        background: overBudget ? "var(--red-bg, rgba(255,0,0,0.03))" : undefined,
                      }}
                    >
                      <td style={{ padding: "6px 8px" }}>{row.category}</td>
                      <td className="mono" style={{ textAlign: "right", padding: "6px 8px" }}>
                        {cents(row.plannedCents)}
                      </td>
                      <td className="mono" style={{ textAlign: "right", padding: "6px 8px" }}>
                        {cents(row.actualCents)}
                      </td>
                      <td
                        className="mono"
                        style={{
                          textAlign: "right",
                          padding: "6px 8px",
                          color: overBudget ? "var(--red)" : undefined,
                        }}
                      >
                        {row.varianceCents === 0 ? "—" : cents(row.varianceCents)}
                      </td>
                      <td style={{ textAlign: "center", padding: "6px 8px" }}>
                        {overBudget ? (
                          <Badge>
                            <AlertTriangle size={10} /> Over
                          </Badge>
                        ) : (
                          <span className="muted">On track</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Restricted funds */}
      <div className="card">
        <div className="card__head">
          <h2 className="card__title">Restricted funds</h2>
          <span className="card__subtitle">Active grants with earmarked funds</span>
        </div>
        <div className="card__body col" style={{ gap: 12 }}>
          {(!restricted || restricted.length === 0) && (
            <div className="muted">No active grants with restricted purposes.</div>
          )}
          {(restricted ?? []).map((r) => (
            <div key={r.grantId} className="card" style={{ padding: 12, border: "1px solid var(--border)" }}>
              <div className="row" style={{ justifyContent: "space-between" }}>
                <div>
                  <strong>{r.title}</strong>
                  <span className="muted"> — {r.funder}</span>
                  <div className="muted" style={{ fontSize: "var(--fs-sm)" }}>{r.purpose}</div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div>
                    <span className="muted">Balance</span>{" "}
                    <span className="mono" style={{ fontWeight: 600 }}>{cents(r.balanceCents)}</span>
                  </div>
                  <div className="muted" style={{ fontSize: "var(--fs-sm)" }}>
                    In: {cents(r.inflowCents)} / Out: {cents(r.outflowCents)}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  icon,
  color,
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
  color: string;
}) {
  return (
    <div className="card" style={{ padding: 16 }}>
      <div className="row" style={{ gap: 8, alignItems: "center" }}>
        <span style={{ color: `var(--${color}, inherit)` }}>{icon}</span>
        <span className="muted">{label}</span>
      </div>
      <div className="mono" style={{ fontSize: "var(--fs-xl, 24px)", marginTop: 4, fontWeight: 600 }}>
        {cents(value)}
      </div>
    </div>
  );
}
