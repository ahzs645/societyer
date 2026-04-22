import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import { useSociety } from "../hooks/useSociety";
import { useCurrentUserId } from "../hooks/useCurrentUser";
import { SeedPrompt, PageHeader } from "./_helpers";
import { Badge, Drawer, Field, Flag } from "../components/ui";
import { Select } from "../components/Select";
import { formatDate, formatDateTime, money } from "../lib/format";
import { isDemoMode } from "../lib/demoMode";
import { Database, Link2, PiggyBank, PlusCircle, RefreshCw, ShieldCheck, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useToast } from "../components/Toast";
import {
  WaveHealthPanel,
  redactWaveHealthResult,
} from "../features/financials/components/WaveHealthPanel";
import { WaveCacheExplorer } from "../features/financials/components/WaveCacheExplorer";
import { OperatingSubscriptionsCard, ProviderCard, Stat } from "../features/financials/components/FinancialDashboardCards";
import {
  OPERATING_SUBSCRIPTION_INTERVALS,
  OPERATING_SUBSCRIPTION_STATUSES,
  monthlyEstimateCents,
  newOperatingSubscriptionForm,
  operatingSubscriptionFormFromRow,
  optionalText,
} from "../features/financials/lib/operatingSubscriptions";
import {
  type WaveAccountView,
  isBrowserBackedWaveConnection,
} from "../features/financials/lib/waveResources";

export {
  WaveAccountDetailPage,
  WaveResourceDetailPage,
  WaveResourceTablePage,
} from "../features/financials/pages/WavePages";
export { FinancialYearDetailPage } from "../features/financials/pages/FinancialYearDetailPage";

function auditStatusTone(status: string) {
  if (status === "Audited") return "success";
  if (["ReviewEngagement", "Review engagement", "Compilation", "Compiled", "T2/GIFI"].includes(status)) return "info";
  return "warn";
}

function auditStatusLabel(status: string) {
  if (status === "ReviewEngagement") return "Review engagement";
  return status;
}

export function FinancialsPage() {
  const society = useSociety();
  const navigate = useNavigate();
  const items = useQuery(api.financials.list, society ? { societyId: society._id } : "skip");
  const orgHistory = useQuery(api.organizationHistory.list, society ? { societyId: society._id } : "skip");
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
  const operatingSubscriptions = useQuery(
    api.financialHub.operatingSubscriptions,
    society ? { societyId: society._id } : "skip",
  );
  const oauth = useQuery(
    api.financialHub.oauthUrl,
    society ? { societyId: society._id } : "skip",
  );
  const markConnected = useMutation(api.financialHub.markConnectionConnected);
  const disconnect = useMutation(api.financialHub.disconnect);
  const sync = useAction(api.financialHub.sync);
  const syncWaveCache = useAction(api.waveCache.sync);
  const checkWaveHealth = useAction(api.waveCache.healthCheck);
  const waveSummary = useQuery(
    api.waveCache.summary,
    society ? { societyId: society._id } : "skip",
  );
  const upsertBudget = useMutation(api.financialHub.upsertBudget);
  const removeBudget = useMutation(api.financialHub.removeBudget);
  const upsertOperatingSubscription = useMutation(api.financialHub.upsertOperatingSubscription);
  const removeOperatingSubscription = useMutation(api.financialHub.removeOperatingSubscription);
  const actingUserId = useCurrentUserId() ?? undefined;
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [waveHealthBusy, setWaveHealthBusy] = useState(false);
  const [waveHealth, setWaveHealth] = useState<any>(null);
  const [budgetForm, setBudgetForm] = useState<{ category: string; planned: string } | null>(null);
  const [subscriptionForm, setSubscriptionForm] = useState<any>(null);
  const [waveMode, setWaveMode] = useState<"resources" | "structures">("resources");
  const [waveResourceType, setWaveResourceType] = useState("account");
  const [waveAccountView, setWaveAccountView] = useState<WaveAccountView>("transaction");
  const [waveSearch, setWaveSearch] = useState("");
  const [selectedWaveResourceId, setSelectedWaveResourceId] = useState<string | null>(null);
  const [hideZeroWaveAccounts, setHideZeroWaveAccounts] = useState(false);
  const waveResources = useQuery(
    api.waveCache.resources,
    society
      ? {
          societyId: society._id,
          resourceType: waveResourceType === "all" ? undefined : waveResourceType,
          search: waveSearch || undefined,
          limit: 500,
        }
      : "skip",
  );
  const waveStructures = useQuery(
    api.waveCache.structures,
    society ? { societyId: society._id, search: waveSearch || undefined, limit: 100 } : "skip",
  );
  const selectedWaveResource = useQuery(
    api.waveCache.resource,
    selectedWaveResourceId ? { id: selectedWaveResourceId as any } : "skip",
  );

  const sorted = (items ?? []).slice().sort((a, b) => b.fiscalYear.localeCompare(a.fiscalYear));
  const latest = sorted[0];
  const fiscalYear = latest?.fiscalYear ?? new Date().getFullYear().toString();
  const activeConnection = (connections ?? []).find((c) => c.status === "connected");
  const browserBackedWaveConnection = isBrowserBackedWaveConnection(activeConnection);
  const importedBudgetReviewCount = (orgHistory?.budgets ?? []).filter((budget: any) => budget.status === "NeedsReview").length;
  const waveLive = oauth?.live === true;
  const waveDemoAvailable = !waveLive && isDemoMode() && oauth?.demoAvailable === true;
  const canConnectWave = waveLive || waveDemoAvailable;
  const activeOperatingSubscriptions = (operatingSubscriptions ?? []).filter((row) => row.status === "Active");
  const plannedOperatingSubscriptions = (operatingSubscriptions ?? []).filter((row) => row.status === "Planned");
  const activeMonthlyCents = activeOperatingSubscriptions.reduce((sum, row) => sum + (row.monthlyEstimateCents ?? monthlyEstimateCents(row)), 0);
  const plannedMonthlyCents = plannedOperatingSubscriptions.reduce((sum, row) => sum + (row.monthlyEstimateCents ?? monthlyEstimateCents(row)), 0);
  const projectedMonthlyCents = activeMonthlyCents + plannedMonthlyCents;
  const waveResourceTypes = useMemo(() => {
    const counts = waveSummary?.resourceCounts ?? {};
    const ordered = ["account", "vendor", "product", "customer", "invoice", "estimate", "salesTax", "business", "availableBusiness"];
    const types = ordered.filter((type) => counts[type] != null);
    for (const type of Object.keys(counts)) {
      if (!types.includes(type)) types.push(type);
    }
    return types;
  }, [waveSummary]);

  if (society === undefined) return <div className="page">Loading…</div>;
  if (society === null) return <SeedPrompt />;

  const openFinancialYear = (fiscalYear: string) => {
    navigate(`/app/financials/fy/${encodeURIComponent(fiscalYear)}`);
  };

  const connect = async () => {
    if (!society) return;
    if (!canConnectWave) {
      toast.warn("Wave credentials are not configured for this workspace.");
      return;
    }
    setBusy(true);
    try {
      const demo = !waveLive && waveDemoAvailable;
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

  const refreshWaveCache = async () => {
    if (!society) return;
    setBusy(true);
    try {
      const result = await syncWaveCache({
        societyId: society._id,
        connectionId: activeConnection?._id,
      });
      toast.success(
        `Cached ${result.resourceCount} Wave resources and ${result.structureCount} structures.`,
      );
    } catch (err: any) {
      toast.error(err?.message ?? "Wave cache refresh failed");
    } finally {
      setBusy(false);
    }
  };

  const runWaveHealthCheck = async () => {
    if (!society) return;
    setWaveHealthBusy(true);
    try {
      const result = redactWaveHealthResult(await checkWaveHealth({
        businessId: activeConnection?.externalBusinessId,
      }));
      setWaveHealth(result);
      if (result.ok) {
        toast.success("Wave health check passed");
      } else {
        const failingStep = result.steps?.find((step: any) => step.status === "fail");
        toast.warn("Wave health check needs attention", failingStep?.message ?? "Review the Wave diagnostics.");
      }
    } catch (err: any) {
      toast.error(err?.message ?? "Wave health check failed");
    } finally {
      setWaveHealthBusy(false);
    }
  };

  return (
    <div className="page page--wide">
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
                disabled={busy}
                onClick={refreshWaveCache}
              >
                <Database size={12} /> Cache
              </button>
              <button
                className="btn-action"
                disabled={busy || waveHealthBusy}
                onClick={runWaveHealthCheck}
              >
                <ShieldCheck size={12} /> Check
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
            <>
              <button
                className="btn-action btn-action--primary"
                disabled={busy || !canConnectWave}
                onClick={connect}
                title={!canConnectWave ? "Configure Wave credentials before connecting this workspace." : undefined}
              >
                <Link2 size={12} /> Connect Wave
              </button>
              <button
                className="btn-action"
                disabled={busy || waveHealthBusy}
                onClick={runWaveHealthCheck}
              >
                <ShieldCheck size={12} /> Check
              </button>
            </>
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
                <>Live mode — sync uses configured Wave API credentials.</>
              ) : waveDemoAvailable ? (
                <>Demo mode — connecting seeds a fictional book so the dashboard lights up.</>
              ) : (
                <>Wave credentials are not configured, so this workspace will not receive demo financial data.</>
              )}
            </span>
          </div>
          <div className="card__body" style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <ProviderCard
              name="Wave"
              desc="Free bookkeeping, REST + GraphQL API."
              status={waveLive ? "live" : waveDemoAvailable ? "demo" : "setup"}
              onConnect={canConnectWave ? connect : undefined}
              busy={busy}
            />
            <ProviderCard name="QuickBooks" desc="Coming soon — OAuth flow planned." status="planned" />
            <ProviderCard name="Xero" desc="Coming soon — for multi-currency orgs." status="planned" />
          </div>
        </div>
      )}

      {waveHealth && <WaveHealthPanel result={waveHealth} />}

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

      {activeConnection && (
        <WaveCacheExplorer
          societyId={society._id}
          syncConnectionId={activeConnection?._id}
          syncFinancials={browserBackedWaveConnection ? undefined : sync}
          busy={busy}
          mode={waveMode}
          onModeChange={setWaveMode}
          onRefresh={refreshWaveCache}
          resources={waveResources ?? []}
          resourceType={waveResourceType}
          resourceTypes={waveResourceTypes}
          accountView={waveAccountView}
          search={waveSearch}
          selectedResource={selectedWaveResource}
          selectedResourceId={selectedWaveResourceId}
          hideZeroAccounts={hideZeroWaveAccounts}
          structures={waveStructures ?? []}
          summary={waveSummary}
          onHideZeroAccountsChange={setHideZeroWaveAccounts}
          onAccountViewChange={setWaveAccountView}
          onResourceTypeChange={(type) => {
            setWaveResourceType(type);
            setSelectedWaveResourceId(null);
          }}
          onSearchChange={setWaveSearch}
          onSelectResource={(id) => setSelectedWaveResourceId(id)}
        />
      )}

      <OperatingSubscriptionsCard
        rows={operatingSubscriptions ?? []}
        loading={operatingSubscriptions === undefined}
        activeMonthlyCents={activeMonthlyCents}
        plannedMonthlyCents={plannedMonthlyCents}
        projectedMonthlyCents={projectedMonthlyCents}
        onNew={() => setSubscriptionForm(newOperatingSubscriptionForm())}
        onEdit={(row) => setSubscriptionForm(operatingSubscriptionFormFromRow(row))}
        onRemove={async (row) => {
          await removeOperatingSubscription({ id: row._id, actingUserId });
          toast.info("Subscription cost removed");
        }}
      />

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

      {importedBudgetReviewCount > 0 && (
        <div style={{ marginBottom: 16 }}>
          <Flag level="warn">
            <strong>{importedBudgetReviewCount} imported budget record{importedBudgetReviewCount === 1 ? "" : "s"}</strong>{" "}
            awaiting review.{" "}
            <Link to="/app/org-history?section=budgets">Review in history →</Link>
          </Flag>
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
              <tr
                key={f._id}
                role="button"
                tabIndex={0}
                aria-label={`Open FY ${f.fiscalYear} financial detail`}
                onClick={() => openFinancialYear(f.fiscalYear)}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" && event.key !== " ") return;
                  event.preventDefault();
                  openFinancialYear(f.fiscalYear);
                }}
              >
                <td><strong>{f.fiscalYear}</strong></td>
                <td className="table__cell--mono">{formatDate(f.periodEnd)}</td>
                <td className="table__cell--mono">{money(f.revenueCents)}</td>
                <td className="table__cell--mono">{money(f.expensesCents)}</td>
                <td className="table__cell--mono">{money(f.netAssetsCents)}</td>
                <td className="table__cell--mono">{money(f.restrictedFundsCents)}</td>
                <td>
                  <Badge tone={auditStatusTone(f.auditStatus)}>
                    {auditStatusLabel(f.auditStatus)}
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

      <Drawer
        open={!!subscriptionForm}
        onClose={() => setSubscriptionForm(null)}
        title={subscriptionForm?.id ? "Edit subscription cost" : "Add subscription cost"}
        footer={
          <>
            <button className="btn" onClick={() => setSubscriptionForm(null)}>Cancel</button>
            <button
              className="btn btn--accent"
              disabled={!subscriptionForm?.name || !subscriptionForm?.amountCad}
              onClick={async () => {
                if (!subscriptionForm) return;
                await upsertOperatingSubscription({
                  id: subscriptionForm.id,
                  societyId: society._id,
                  name: subscriptionForm.name,
                  vendorName: optionalText(subscriptionForm.vendorName),
                  category: subscriptionForm.category || "Operations",
                  amountCents: Math.round(Number(subscriptionForm.amountCad) * 100),
                  currency: "CAD",
                  interval: subscriptionForm.interval,
                  status: subscriptionForm.status,
                  nextRenewalDate: optionalText(subscriptionForm.nextRenewalDate),
                  notes: optionalText(subscriptionForm.notes),
                  actingUserId,
                });
                toast.success("Subscription cost saved");
                setSubscriptionForm(null);
              }}
            >
              Save
            </button>
          </>
        }
      >
        {subscriptionForm && (
          <div>
            <Field label="Service">
              <input
                className="input"
                value={subscriptionForm.name}
                onChange={(e) => setSubscriptionForm({ ...subscriptionForm, name: e.target.value })}
                placeholder="e.g. Google Workspace"
              />
            </Field>
            <Field label="Vendor">
              <input
                className="input"
                value={subscriptionForm.vendorName ?? ""}
                onChange={(e) => setSubscriptionForm({ ...subscriptionForm, vendorName: e.target.value })}
                placeholder="e.g. Google"
              />
            </Field>
            <div className="row" style={{ gap: 12 }}>
              <Field label="Category">
                <input
                  className="input"
                  value={subscriptionForm.category}
                  onChange={(e) => setSubscriptionForm({ ...subscriptionForm, category: e.target.value })}
                  placeholder="Software"
                />
              </Field>
              <Field label="Status">
                <Select
                  value={subscriptionForm.status}
                  onChange={(value) => setSubscriptionForm({ ...subscriptionForm, status: value })}
                  options={OPERATING_SUBSCRIPTION_STATUSES}
                />
              </Field>
            </div>
            <div className="row" style={{ gap: 12 }}>
              <Field label="Amount (CAD)">
                <input
                  className="input"
                  type="number"
                  min="0"
                  step="0.01"
                  value={subscriptionForm.amountCad}
                  onChange={(e) => setSubscriptionForm({ ...subscriptionForm, amountCad: e.target.value })}
                  placeholder="49.00"
                />
              </Field>
              <Field label="Billing cadence">
                <Select
                  value={subscriptionForm.interval}
                  onChange={(value) => setSubscriptionForm({ ...subscriptionForm, interval: value })}
                  options={OPERATING_SUBSCRIPTION_INTERVALS}
                />
              </Field>
            </div>
            <Field label="Next renewal">
              <input
                className="input"
                type="date"
                value={subscriptionForm.nextRenewalDate ?? ""}
                onChange={(e) => setSubscriptionForm({ ...subscriptionForm, nextRenewalDate: e.target.value })}
              />
            </Field>
            <Field label="Notes">
              <textarea
                className="textarea"
                value={subscriptionForm.notes ?? ""}
                onChange={(e) => setSubscriptionForm({ ...subscriptionForm, notes: e.target.value })}
                placeholder="Seats, contract notes, cancellation owner, or review reminder."
              />
            </Field>
            <div className="muted" style={{ fontSize: 13 }}>
              Monthly estimate: {money(monthlyEstimateCents({
                amountCents: Math.round(Number(subscriptionForm.amountCad || 0) * 100),
                interval: subscriptionForm.interval,
              }))}
            </div>
          </div>
        )}
      </Drawer>
    </div>
  );
}
