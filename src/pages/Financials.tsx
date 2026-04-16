import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { useSociety } from "../hooks/useSociety";
import { useCurrentUserId } from "../hooks/useCurrentUser";
import { SeedPrompt, PageHeader } from "./_helpers";
import { Badge, Field } from "../components/ui";
import { formatDate, formatDateTime, money } from "../lib/format";
import { isDemoMode } from "../lib/demoMode";
import { PiggyBank, Link2, RefreshCw, PlusCircle, Trash2, ExternalLink } from "lucide-react";
import { useState } from "react";
import { useToast } from "../components/Toast";

export function FinancialsPage() {
  const society = useSociety();
  const items = useQuery(api.financials.list, society ? { societyId: society._id } : "skip");
  const connections = useQuery(
    api.financialHub.connections,
    society ? { societyId: society._id } : "skip",
  );
  const hub = useQuery(
    api.financialHub.summary,
    society ? { societyId: society._id } : "skip",
  );
  const accounts = useQuery(
    api.financialHub.accounts,
    society ? { societyId: society._id } : "skip",
  );
  const transactions = useQuery(
    api.financialHub.transactions,
    society ? { societyId: society._id, limit: 25 } : "skip",
  );
  const oauth = useQuery(
    api.financialHub.oauthUrl,
    society ? { societyId: society._id } : "skip",
  );
  const markConnected = useMutation(api.financialHub.markConnectionConnected);
  const disconnect = useMutation(api.financialHub.disconnect);
  const sync = useAction(api.financialHub.sync);
  const upsertBudget = useMutation(api.financialHub.upsertBudget);
  const removeBudget = useMutation(api.financialHub.removeBudget);
  const actingUserId = useCurrentUserId() ?? undefined;
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [budgetForm, setBudgetForm] = useState<{ category: string; planned: string } | null>(null);

  if (society === undefined) return <div className="page">Loading…</div>;
  if (society === null) return <SeedPrompt />;

  const sorted = (items ?? []).slice().sort((a, b) => b.fiscalYear.localeCompare(a.fiscalYear));
  const latest = sorted[0];
  const fiscalYear = latest?.fiscalYear ?? new Date().getFullYear().toString();
  const activeConnection = (connections ?? []).find((c) => c.status === "connected");

  const connect = async () => {
    if (!society) return;
    setBusy(true);
    try {
      const demo = isDemoMode() || oauth?.live !== true;
      const connectionId = await markConnected({
        societyId: society._id,
        provider: "wave",
        accountLabel: demo ? "Riverside demo book" : "Connected Wave book",
        externalBusinessId: demo ? "biz_demo_01" : undefined,
        demo,
        actingUserId,
      });
      await sync({ connectionId });
      toast.success(demo ? "Connected to demo Wave workspace" : "Connected to Wave");
    } catch (err: any) {
      toast.error(err?.message ?? "Connect failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page">
      <PageHeader
        title="Financials"
        icon={<PiggyBank size={16} />}
        iconColor="green"
        subtitle="Connected bank balances, budget vs actuals, restricted funds, and the AGM financial statements. Disclose remuneration ≥ $75k (s.36)."
        actions={
          activeConnection ? (
            <>
              <Badge tone="success">Connected · {activeConnection.provider}</Badge>
              <button
                className="btn-action"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    const result = await sync({ connectionId: activeConnection._id });
                    toast.success(
                      `Synced ${result.accounts} accounts, ${result.transactions} transactions.`,
                    );
                  } catch (err: any) {
                    toast.error(err?.message ?? "Sync failed");
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <RefreshCw size={12} /> Sync
              </button>
              <button
                className="btn-action"
                onClick={async () => {
                  await disconnect({ connectionId: activeConnection._id, actingUserId });
                  toast.info("Disconnected Wave");
                }}
              >
                Disconnect
              </button>
            </>
          ) : (
            <button className="btn-action btn-action--primary" disabled={busy} onClick={connect}>
              <Link2 size={12} /> Connect Wave
            </button>
          )
        }
      />

      {!activeConnection && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card__head">
            <h2 className="card__title">Connect a bookkeeping source</h2>
            <span className="card__subtitle">
              Pull balances, transactions and restricted-fund splits from Wave.{" "}
              {oauth?.live ? (
                <>Live mode — clicking Connect opens Wave's OAuth.</>
              ) : (
                <>Demo mode — connecting seeds a fictional book so the dashboard lights up.</>
              )}
            </span>
          </div>
          <div className="card__body" style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <ProviderCard name="Wave" desc="Free bookkeeping, REST + GraphQL API." status={oauth?.live ? "live" : "demo"} onConnect={connect} busy={busy} />
            <ProviderCard name="QuickBooks" desc="Coming soon — OAuth flow planned." status="planned" />
            <ProviderCard name="Xero" desc="Coming soon — for multi-currency orgs." status="planned" />
          </div>
        </div>
      )}

      {activeConnection && hub && (
        <div className="stat-grid" style={{ marginBottom: 16 }}>
          <Stat label="Total bank balance" value={money(hub.totalBalance)} />
          <Stat label="Unrestricted" value={money(hub.unrestricted)} tone={hub.unrestricted < 0 ? "danger" : "ok"} />
          <Stat label="Restricted funds" value={money(hub.totalBalance - hub.unrestricted)} />
          <Stat
            label="Last sync"
            value={activeConnection.lastSyncAtISO ? formatDateTime(activeConnection.lastSyncAtISO) : "—"}
          />
        </div>
      )}

      {activeConnection && hub && hub.restrictedAccounts.length > 0 && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card__head">
            <h2 className="card__title">Restricted funds</h2>
            <span className="card__subtitle">Earmarked for specific purposes — track separately (CPA guidance).</span>
          </div>
          <table className="table">
            <thead>
              <tr><th>Fund</th><th>Purpose</th><th style={{ textAlign: "right" }}>Balance</th></tr>
            </thead>
            <tbody>
              {hub.restrictedAccounts.map((a, i) => (
                <tr key={i}>
                  <td>{a.name}</td>
                  <td className="muted" style={{ fontSize: 13 }}>{a.purpose ?? "—"}</td>
                  <td className="table__cell--mono" style={{ textAlign: "right" }}>{money(a.balanceCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {activeConnection && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card__head">
            <h2 className="card__title">Budget vs actuals — FY {fiscalYear}</h2>
            <span className="card__subtitle">Plan a category, actuals come from synced transactions.</span>
            <div style={{ marginLeft: "auto" }}>
              <button
                className="btn-action"
                onClick={() => setBudgetForm({ category: "", planned: "" })}
              >
                <PlusCircle size={12} /> Add budget line
              </button>
            </div>
          </div>
          <table className="table">
            <thead>
              <tr>
                <th>Category</th>
                <th style={{ textAlign: "right" }}>Planned</th>
                <th style={{ textAlign: "right" }}>Actual</th>
                <th style={{ textAlign: "right" }}>Variance</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {(hub?.budgetRows ?? []).map((b: any) => {
                const variance = b.plannedCents - b.actualCents;
                return (
                  <tr key={b._id}>
                    <td>{b.category}</td>
                    <td className="table__cell--mono" style={{ textAlign: "right" }}>{money(b.plannedCents)}</td>
                    <td className="table__cell--mono" style={{ textAlign: "right" }}>{money(b.actualCents)}</td>
                    <td
                      className="table__cell--mono"
                      style={{ textAlign: "right", color: variance < 0 ? "var(--danger)" : "var(--success)" }}
                    >
                      {money(variance)}
                    </td>
                    <td style={{ textAlign: "right" }}>
                      <button
                        className="btn btn--ghost btn--sm btn--icon"
                        aria-label={`Delete budget ${b.name}`}
                        onClick={() => removeBudget({ id: b._id, actingUserId })}
                      >
                        <Trash2 size={12} />
                      </button>
                    </td>
                  </tr>
                );
              })}
              {(hub?.budgetRows ?? []).length === 0 && (
                <tr>
                  <td colSpan={5} className="muted" style={{ textAlign: "center", padding: 16 }}>
                    No budget lines yet. Add a category to start tracking variance.
                  </td>
                </tr>
              )}
            </tbody>
          </table>

          {budgetForm && (
            <div className="card__body" style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
              <Field label="Category">
                <input
                  className="input"
                  value={budgetForm.category}
                  onChange={(e) => setBudgetForm({ ...budgetForm, category: e.target.value })}
                  placeholder="e.g. Program supplies"
                />
              </Field>
              <Field label="Planned (CAD)">
                <input
                  className="input"
                  type="number"
                  value={budgetForm.planned}
                  onChange={(e) => setBudgetForm({ ...budgetForm, planned: e.target.value })}
                  placeholder="12000"
                />
              </Field>
              <button
                className="btn btn--accent"
                onClick={async () => {
                  if (!budgetForm.category || !budgetForm.planned) return;
                  await upsertBudget({
                    societyId: society._id,
                    fiscalYear,
                    category: budgetForm.category,
                    plannedCents: Math.round(Number(budgetForm.planned) * 100),
                    actingUserId,
                  });
                  setBudgetForm(null);
                  toast.success("Budget saved");
                }}
              >
                Save
              </button>
              <button className="btn" onClick={() => setBudgetForm(null)}>
                Cancel
              </button>
            </div>
          )}
        </div>
      )}

      {activeConnection && transactions && transactions.length > 0 && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card__head">
            <h2 className="card__title">Recent transactions</h2>
            <span className="card__subtitle">Latest activity from the connected source.</span>
          </div>
          <table className="table">
            <thead>
              <tr><th>Date</th><th>Description</th><th>Account</th><th>Category</th><th style={{ textAlign: "right" }}>Amount</th></tr>
            </thead>
            <tbody>
              {transactions.map((t) => {
                const acct = (accounts ?? []).find((a) => a._id === t.accountId);
                return (
                  <tr key={t._id}>
                    <td className="table__cell--mono">{t.date}</td>
                    <td>{t.description}</td>
                    <td className="muted">{acct?.name ?? "—"}</td>
                    <td><Badge>{t.category ?? "uncategorized"}</Badge></td>
                    <td
                      className="table__cell--mono"
                      style={{ textAlign: "right", color: t.amountCents < 0 ? "var(--danger)" : "var(--success)" }}
                    >
                      {money(t.amountCents)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {latest && (
        <div className="stat-grid">
          <Stat label={`FY ${latest.fiscalYear} revenue`} value={money(latest.revenueCents)} />
          <Stat label="Expenses" value={money(latest.expensesCents)} />
          <Stat
            label="Net surplus / (deficit)"
            value={money(latest.revenueCents - latest.expensesCents)}
            tone={latest.revenueCents - latest.expensesCents >= 0 ? "ok" : "danger"}
          />
          <Stat label="Net assets" value={money(latest.netAssetsCents)} />
        </div>
      )}

      <div className="card">
        <div className="card__head"><h2 className="card__title">Year-over-year</h2></div>
        <table className="table">
          <thead>
            <tr>
              <th>Fiscal year</th>
              <th>Period end</th>
              <th>Revenue</th>
              <th>Expenses</th>
              <th>Net assets</th>
              <th>Restricted</th>
              <th>Audit</th>
              <th>Board approval</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((f) => (
              <tr key={f._id}>
                <td><strong>{f.fiscalYear}</strong></td>
                <td className="table__cell--mono">{formatDate(f.periodEnd)}</td>
                <td className="table__cell--mono">{money(f.revenueCents)}</td>
                <td className="table__cell--mono">{money(f.expensesCents)}</td>
                <td className="table__cell--mono">{money(f.netAssetsCents)}</td>
                <td className="table__cell--mono">{money(f.restrictedFundsCents)}</td>
                <td>
                  <Badge tone={f.auditStatus === "Audited" ? "success" : f.auditStatus === "ReviewEngagement" ? "info" : "warn"}>
                    {f.auditStatus}
                  </Badge>
                  {f.auditorName && <div className="muted" style={{ fontSize: "var(--fs-sm)" }}>{f.auditorName}</div>}
                </td>
                <td className="table__cell--mono">{f.approvedByBoardAt ? formatDate(f.approvedByBoardAt) : "—"}</td>
              </tr>
            ))}
            {sorted.length === 0 && (
              <tr><td colSpan={8} className="muted" style={{ textAlign: "center", padding: 24 }}>No financial statements yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {latest && latest.remunerationDisclosures.length > 0 && (
        <>
          <div className="spacer-6" />
          <div className="card">
            <div className="card__head">
              <h2 className="card__title">Remuneration disclosure — FY {latest.fiscalYear}</h2>
              <span className="card__subtitle">Top employees/contractors paid ≥ $75,000 (s.36 Societies Act).</span>
            </div>
            <table className="table">
              <thead>
                <tr><th>Position</th><th style={{ textAlign: "right" }}>Total compensation</th></tr>
              </thead>
              <tbody>
                {latest.remunerationDisclosures.map((r, i) => (
                  <tr key={i}>
                    <td>{r.role}</td>
                    <td className="table__cell--mono" style={{ textAlign: "right" }}>{money(r.amountCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "ok" | "danger" }) {
  return (
    <div className="stat">
      <div className="stat__label">{label}</div>
      <div className="stat__value" style={{ color: tone === "danger" ? "var(--danger)" : undefined }}>{value}</div>
    </div>
  );
}

function ProviderCard({
  name,
  desc,
  status,
  onConnect,
  busy,
}: {
  name: string;
  desc: string;
  status: "live" | "demo" | "planned";
  onConnect?: () => void;
  busy?: boolean;
}) {
  return (
    <div
      className="panel"
      style={{
        padding: 12,
        border: "1px solid var(--border)",
        borderRadius: 8,
        minWidth: 220,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <strong>{name}</strong>
        <Badge tone={status === "live" ? "success" : status === "demo" ? "info" : "neutral"}>
          {status}
        </Badge>
      </div>
      <div className="muted" style={{ fontSize: 12, margin: "6px 0 10px" }}>
        {desc}
      </div>
      {onConnect ? (
        <button className="btn btn--accent btn--sm" disabled={busy} onClick={onConnect}>
          <Link2 size={12} /> Connect
        </button>
      ) : (
        <button className="btn btn--ghost btn--sm" disabled>
          Coming soon
        </button>
      )}
    </div>
  );
}
