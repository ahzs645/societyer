import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import { useSociety } from "../hooks/useSociety";
import { useCurrentUserId } from "../hooks/useCurrentUser";
import { SeedPrompt, PageHeader } from "./_helpers";
import { Badge, Drawer, Field, Flag } from "../components/ui";
import { DataTable } from "../components/DataTable";
import { RecordShowPage } from "../components/RecordShowPage";
import { Select } from "../components/Select";
import { formatDate, formatDateTime, money } from "../lib/format";
import { isDemoMode } from "../lib/demoMode";
import { ArrowLeft, Braces, Database, ExternalLink, Link2, PiggyBank, PlusCircle, RefreshCw, ShieldCheck, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useToast } from "../components/Toast";

const OPERATING_SUBSCRIPTION_INTERVALS = [
  { value: "month", label: "Monthly" },
  { value: "year", label: "Annual" },
  { value: "quarter", label: "Quarterly" },
  { value: "week", label: "Weekly" },
];

const OPERATING_SUBSCRIPTION_STATUSES = [
  { value: "Active", label: "Active" },
  { value: "Planned", label: "Planned" },
  { value: "Paused", label: "Paused" },
];

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
          search={waveSearch}
          selectedResource={selectedWaveResource}
          selectedResourceId={selectedWaveResourceId}
          hideZeroAccounts={hideZeroWaveAccounts}
          structures={waveStructures ?? []}
          summary={waveSummary}
          onHideZeroAccountsChange={setHideZeroWaveAccounts}
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

export function FinancialYearDetailPage() {
  const society = useSociety();
  const { fiscalYear: routeFiscalYear } = useParams();
  const fiscalYear = routeFiscalYear ? decodeURIComponent(routeFiscalYear) : "";
  const detail = useQuery(
    api.financials.detailByFiscalYear,
    society && fiscalYear ? { societyId: society._id, fiscalYear } : "skip",
  );

  if (society === undefined || detail === undefined) return <div className="page">Loading…</div>;
  if (society === null) return <SeedPrompt />;

  const financial = detail.financial;
  const imports = detail.imports ?? [];
  const exactImports = financial ? imports.filter((row: any) => isExactStatementImport(financial, row)) : [];
  const relatedImports = imports.filter((row: any) => !exactImports.some((exact: any) => exact._id === row._id));
  const statementImports = exactImports.length > 0 ? [...exactImports, ...relatedImports] : imports;
  const documents = detail.documents ?? [];
  const lineCount = imports.reduce((sum: number, row: any) => sum + (row.lines?.length ?? 0), 0);

  if (!financial && imports.length === 0) {
    return (
      <div className="page">
        <PageHeader
          title={`FY ${fiscalYear || "financials"}`}
          icon={<PiggyBank size={16} />}
          iconColor="green"
          subtitle="No financial statement rows or import evidence were found for this fiscal year."
          actions={<Link className="btn-action" to="/app/financials"><ArrowLeft size={12} /> Back to financials</Link>}
        />
      </div>
    );
  }

  return (
    <RecordShowPage
      title={`FY ${fiscalYear} financials`}
      subtitle={financial ? `Period end ${formatDate(financial.periodEnd)}` : "Import evidence without an approved financial row."}
      icon={<PiggyBank size={16} />}
      iconColor="green"
      actions={<Link className="btn-action" to="/app/financials"><ArrowLeft size={12} /> Back</Link>}
      chips={
        <>
          {financial && <Badge tone={auditStatusTone(financial.auditStatus)}>{auditStatusLabel(financial.auditStatus)}</Badge>}
          {exactImports.length > 0 && <Badge tone="success">{exactImports.length} matched import{exactImports.length === 1 ? "" : "s"}</Badge>}
          {documents.length > 0 && <Badge tone="info">{documents.length} source document{documents.length === 1 ? "" : "s"}</Badge>}
          {lineCount > 0 && <Badge tone="neutral">{lineCount} line item{lineCount === 1 ? "" : "s"}</Badge>}
        </>
      }
      summary={[
        { label: "Revenue", value: financial ? moneyDetailed(financial.revenueCents) : "—" },
        { label: "Expenses", value: financial ? moneyDetailed(financial.expensesCents) : "—" },
        {
          label: "Net surplus / (deficit)",
          value: financial ? moneyDetailed(financial.revenueCents - financial.expensesCents) : "—",
        },
        { label: "Net assets", value: financial ? moneyDetailed(financial.netAssetsCents) : "—" },
        { label: "Restricted", value: financial ? moneyDetailed(financial.restrictedFundsCents) : "—" },
        { label: "Board approval", value: financial?.approvedByBoardAt ? formatDate(financial.approvedByBoardAt) : "—" },
      ]}
      tabs={[
        {
          id: "tables",
          label: "Tables",
          count: lineCount,
          icon: <Database size={14} />,
          content: (
            <StatementImportTables
              imports={statementImports}
              exactImportIds={new Set(exactImports.map((row: any) => row._id))}
            />
          ),
        },
        {
          id: "docs",
          label: "Docs",
          count: documents.length,
          icon: <Link2 size={14} />,
          content: <SourceDocumentsTable documents={documents} />,
        },
        {
          id: "imports",
          label: "Imports",
          count: imports.length,
          icon: <Braces size={14} />,
          content: (
            <ImportSummaryTable
              imports={imports}
              exactImportIds={new Set(exactImports.map((row: any) => row._id))}
            />
          ),
        },
      ]}
      inspector={
        <div className="card">
          <div className="card__head">
            <h2 className="card__title">Evidence status</h2>
          </div>
          <div className="card__body col">
            <DetailCell label="Financial row" value={financial?._id ?? "Not created"} mono />
            <DetailCell label="Matched imports" value={String(exactImports.length)} />
            <DetailCell label="Related imports" value={String(relatedImports.length)} />
            <DetailCell label="Source documents" value={String(documents.length)} />
            <DetailCell label="Line items" value={String(lineCount)} />
            <DetailCell label="Presented at meeting" value={detail.presentedAtMeeting?.title ?? "—"} />
          </div>
        </div>
      }
    />
  );
}

function StatementImportTables({
  imports,
  exactImportIds,
}: {
  imports: any[];
  exactImportIds: Set<string>;
}) {
  if (imports.length === 0) {
    return <div className="card"><div className="card__body muted">No statement import tables are linked to this fiscal year.</div></div>;
  }

  return (
    <div className="col" style={{ gap: 16 }}>
      {imports.map((row) => (
        <div className="card" key={row._id}>
          <div className="card__head">
            <div>
              <h2 className="card__title">{row.title}</h2>
              <span className="card__subtitle">
                {formatDate(row.periodEnd)} · {row.lines?.length ?? 0} line{(row.lines?.length ?? 0) === 1 ? "" : "s"}
              </span>
            </div>
            <div className="row" style={{ gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
              {exactImportIds.has(row._id) && <Badge tone="success">Matches table row</Badge>}
              <Badge tone={row.status === "Verified" ? "success" : row.status === "Rejected" ? "danger" : "warn"}>{row.status}</Badge>
              <Badge tone={row.confidence === "High" ? "success" : row.confidence === "Medium" ? "info" : "warn"}>{row.confidence}</Badge>
            </div>
          </div>
          <div className="stat-grid" style={{ margin: "0 16px 16px" }}>
            <Stat label="Revenue" value={moneyDetailed(row.revenueCents)} />
            <Stat label="Expenses" value={moneyDetailed(row.expensesCents)} />
            <Stat label="Net assets" value={moneyDetailed(row.netAssetsCents)} />
            <Stat label="Restricted" value={moneyDetailed(row.restrictedFundsCents)} />
          </div>
          {row.lines?.length > 0 ? (
            <table className="table">
              <thead>
                <tr>
                  <th>Section</th>
                  <th>Line</th>
                  <th style={{ textAlign: "right" }}>Amount</th>
                  <th>Confidence</th>
                </tr>
              </thead>
              <tbody>
                {row.lines.map((line: any) => (
                  <tr key={line._id}>
                    <td>{line.section}</td>
                    <td>{line.label}</td>
                    <td className="table__cell--mono" style={{ textAlign: "right" }}>{moneyDetailed(line.amountCents)}</td>
                    <td><Badge tone={line.confidence === "High" ? "success" : line.confidence === "Medium" ? "info" : "warn"}>{line.confidence}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="card__body muted">No line items were extracted for this import.</div>
          )}
        </div>
      ))}
    </div>
  );
}

function SourceDocumentsTable({ documents }: { documents: any[] }) {
  if (documents.length === 0) {
    return <div className="card"><div className="card__body muted">No source documents are linked to this fiscal year.</div></div>;
  }

  return (
    <div className="card">
      <div className="card__head">
        <h2 className="card__title">Source documents</h2>
        <span className="card__subtitle">{documents.length} linked document{documents.length === 1 ? "" : "s"}</span>
      </div>
      <table className="table">
        <thead>
          <tr>
            <th>Title</th>
            <th>Source</th>
            <th>Category</th>
            <th>Created</th>
            <th>Access</th>
          </tr>
        </thead>
        <tbody>
          {documents.map((doc) => (
            <tr key={doc._id}>
              <td>
                <strong>{doc.title}</strong>
                {doc.fileName && <div className="mono muted" style={{ fontSize: 11 }}>{doc.fileName}</div>}
              </td>
              <td className="table__cell--mono">{documentExternalId(doc) ?? "—"}</td>
              <td><Badge tone={documentCategoryTone(doc.category)}>{doc.category ?? "Document"}</Badge></td>
              <td className="table__cell--mono">{formatDate(doc.createdAtISO)}</td>
              <td>
                {doc.url ? (
                  <a className="btn btn--ghost btn--sm" href={doc.url} target="_blank" rel="noreferrer">
                    <ExternalLink size={12} /> Open
                  </a>
                ) : (
                  <span className="muted">Metadata only</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ImportSummaryTable({ imports, exactImportIds }: { imports: any[]; exactImportIds: Set<string> }) {
  if (imports.length === 0) {
    return <div className="card"><div className="card__body muted">No import records are linked to this fiscal year.</div></div>;
  }

  return (
    <div className="card">
      <div className="card__head">
        <h2 className="card__title">Financial statement imports</h2>
        <span className="card__subtitle">Matched and related records for this fiscal year.</span>
      </div>
      <table className="table">
        <thead>
          <tr>
            <th>Import</th>
            <th>Period end</th>
            <th>Status</th>
            <th>Revenue</th>
            <th>Expenses</th>
            <th>Net assets</th>
            <th>Lines</th>
            <th>Sources</th>
          </tr>
        </thead>
        <tbody>
          {imports.map((row) => (
            <tr key={row._id}>
              <td>
                <strong>{row.title}</strong>
                {exactImportIds.has(row._id) && <div><Badge tone="success">Matches table row</Badge></div>}
              </td>
              <td className="table__cell--mono">{formatDate(row.periodEnd)}</td>
              <td><Badge tone={row.status === "Verified" ? "success" : row.status === "Rejected" ? "danger" : "warn"}>{row.status}</Badge></td>
              <td className="table__cell--mono">{moneyDetailed(row.revenueCents)}</td>
              <td className="table__cell--mono">{moneyDetailed(row.expensesCents)}</td>
              <td className="table__cell--mono">{moneyDetailed(row.netAssetsCents)}</td>
              <td className="table__cell--mono">{row.lines?.length ?? 0}</td>
              <td>
                <div className="tag-list">
                  {(row.sourceExternalIds ?? []).map((id: string) => <Badge key={id}>{id}</Badge>)}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function isExactStatementImport(financial: any, statementImport: any) {
  if (statementImport.periodEnd !== financial.periodEnd) return false;
  return (
    optionalCentsMatch(statementImport.revenueCents, financial.revenueCents) &&
    optionalCentsMatch(statementImport.expensesCents, financial.expensesCents) &&
    optionalCentsMatch(statementImport.netAssetsCents, financial.netAssetsCents)
  );
}

function optionalCentsMatch(importValue: number | undefined, financialValue: number | undefined) {
  return importValue == null || importValue === financialValue;
}

function moneyDetailed(cents?: number) {
  if (cents == null) return "—";
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency: "CAD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

function documentExternalId(doc: any) {
  if (Array.isArray(doc.tags)) {
    const tag = doc.tags.find((value: string) => value.startsWith("paperless:"));
    if (tag) return tag;
  }
  try {
    const parsed = JSON.parse(doc.content ?? "{}");
    return parsed.externalId;
  } catch {
    return null;
  }
}

function documentCategoryTone(category: string): "success" | "warn" | "info" | "neutral" {
  if (category === "FinancialStatement") return "warn";
  if (category === "Restricted Paperless Source") return "warn";
  if (category === "Org History Source") return "info";
  return "neutral";
}

export function WaveResourceTablePage() {
  const society = useSociety();
  const { resourceType: routeResourceType } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const tableResourceType = normalizeWaveResourceType(routeResourceType ?? "account");
  const queryResourceType = tableResourceType === "all" ? undefined : tableResourceType;
  const connections = useQuery(
    api.financialHub.connections,
    society ? { societyId: society._id } : "skip",
  );
  const activeConnection = (connections ?? []).find((c) => c.status === "connected");
  const browserBackedWaveConnection = isBrowserBackedWaveConnection(activeConnection);
  const waveSummary = useQuery(
    api.waveCache.summary,
    society ? { societyId: society._id } : "skip",
  );
  const waveResources = useQuery(
    api.waveCache.resources,
    society
      ? {
          societyId: society._id,
          resourceType: queryResourceType,
          limit: 1000,
        }
      : "skip",
  );
  const syncWaveCache = useAction(api.waveCache.sync);
  const syncFinancials = useAction(api.financialHub.sync);
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [hideZeroWaveAccounts, setHideZeroWaveAccounts] = useState(false);
  const [selectedWaveResourceId, setSelectedWaveResourceId] = useState<string | null>(() => searchParams.get("resourceId"));
  const selectedWaveResource = useQuery(
    api.waveCache.resource,
    selectedWaveResourceId ? { id: selectedWaveResourceId as any } : "skip",
  );

  useEffect(() => {
    const resourceId = searchParams.get("resourceId");
    if (resourceId !== selectedWaveResourceId) {
      setSelectedWaveResourceId(resourceId);
    }
  }, [searchParams, selectedWaveResourceId]);

  if (society === undefined) return <div className="page">Loading...</div>;
  if (society === null) return <SeedPrompt />;

  const allResources = waveResources ?? [];
  const rows = hideZeroWaveAccounts
    ? allResources.filter((row) => row.resourceType !== "account" || !isZeroWaveAmount(row.amountValue))
    : allResources;
  const hiddenZeroAccounts = allResources.length - rows.length;
  const selectedFallback = allResources.find((row) => row._id === selectedWaveResourceId) ?? null;
  const title = tableResourceType === "all" ? "Wave Data" : `Wave ${waveTypeLabel(tableResourceType)}`;

  const openWaveResource = (resourceId: string) => {
    setSelectedWaveResourceId(resourceId);
    const next = new URLSearchParams(searchParams);
    next.set("resourceId", resourceId);
    setSearchParams(next, { replace: true });
  };

  const closeWaveResource = () => {
    setSelectedWaveResourceId(null);
    const next = new URLSearchParams(searchParams);
    next.delete("resourceId");
    setSearchParams(next, { replace: true });
  };

  const refreshWaveCache = async () => {
    setBusy(true);
    try {
      const result = await syncWaveCache({
        societyId: society._id,
        connectionId: activeConnection?._id,
      });
      toast.success(`Cached ${result.resourceCount} Wave resources and ${result.structureCount} structures.`);
    } catch (err: any) {
      toast.error(err?.message ?? "Wave cache refresh failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page">
      <PageHeader
        title={title}
        icon={<Database size={16} />}
        iconColor="green"
        subtitle={
          waveSummary
            ? `${waveSummary.businessName} · ${rows.length} rows${hiddenZeroAccounts > 0 ? ` · ${hiddenZeroAccounts} zero-balance hidden` : ""}`
            : "Cached Wave resource table."
        }
        actions={
          <>
            <Link className="btn-action" to="/app/financials">
              <ArrowLeft size={12} /> Financials
            </Link>
            {queryResourceType === "account" && (
              <button
                className="btn-action"
                onClick={() => setHideZeroWaveAccounts(!hideZeroWaveAccounts)}
              >
                Zero-balance {hideZeroWaveAccounts ? "hidden" : "shown"}
              </button>
            )}
            <button className="btn-action" disabled={busy} onClick={refreshWaveCache}>
              <RefreshCw size={12} /> Refresh
            </button>
          </>
        }
      />

      <DataTable
        label={title}
        icon={<Database size={14} />}
        data={rows as any[]}
        loading={waveResources === undefined}
        rowKey={(row) => row._id}
        onRowClick={(row) => openWaveResource(row._id)}
        rowActionLabel={(row) => `Open ${row.label}`}
        searchPlaceholder={`Search ${title.toLowerCase()}...`}
        searchExtraFields={[(row) => row.searchText]}
        defaultSort={{ columnId: "resource", dir: "asc" }}
        viewsKey={`wave-cache-${tableResourceType}`}
        pagination
        initialPageSize={50}
        pageSizeOptions={[25, 50, 100]}
        columns={waveResourceColumns()}
        renderRowActions={(row) => (
          <Link
            className="btn btn--ghost btn--sm"
            to={waveResourceDetailHref(row)}
            onClick={(event) => {
              event.stopPropagation();
            }}
          >
            <ExternalLink size={12} /> Details
          </Link>
        )}
        emptyMessage={waveSummary ? "No cached Wave rows match this table." : "Refresh the Wave cache to load this table."}
      />

      <WaveResourceDrawer
        open={Boolean(selectedWaveResourceId)}
        societyId={society._id}
        syncConnectionId={activeConnection?._id}
        syncFinancials={browserBackedWaveConnection ? undefined : syncFinancials}
        resource={selectedWaveResource}
        fallback={selectedFallback}
        onClose={closeWaveResource}
      />
    </div>
  );
}

export function WaveAccountDetailPage() {
  const society = useSociety();
  const { resourceId } = useParams();
  const connections = useQuery(
    api.financialHub.connections,
    society ? { societyId: society._id } : "skip",
  );
  const activeConnection = (connections ?? []).find((c) => c.status === "connected");
  const browserBackedWaveConnection = isBrowserBackedWaveConnection(activeConnection);
  const resource = useQuery(
    api.waveCache.resource,
    resourceId ? { id: resourceId as any } : "skip",
  );
  const syncFinancials = useAction(api.financialHub.sync);
  const isTransactionAccount = resource?.resourceType === "account" && isWaveTransactionAccount(resource);
  const isCategoryAccount = resource?.resourceType === "account" && !isWaveTransactionAccount(resource);
  const accountActivity = useQuery(
    api.financialHub.transactionsForAccountExternalId,
    society && isTransactionAccount && resource.externalId
      ? { societyId: society._id, externalId: resource.externalId, limit: 1000 }
      : "skip",
  );
  const categoryActivity = useQuery(
    api.financialHub.transactionsForCategoryAccountExternalId,
    society && isCategoryAccount && resource.externalId
      ? { societyId: society._id, externalId: resource.externalId, label: resource.label, limit: 1000 }
      : "skip",
  );
  const activity = isTransactionAccount ? accountActivity : categoryActivity;
  const [selectedTransaction, setSelectedTransaction] = useState<any>(null);
  const [pullState, setPullState] = useState<"idle" | "pulling" | "pulled" | "error">("idle");
  const [pullError, setPullError] = useState<string | null>(null);

  useEffect(() => {
    setPullState("idle");
    setPullError(null);
    setSelectedTransaction(null);
  }, [resource?._id]);

  useEffect(() => {
    if (activity === undefined) return;
    if (!isTransactionAccount) return;
    if (activity.account && activity.total !== 0) return;
    if (browserBackedWaveConnection) return;
    if (!activeConnection?._id || pullState !== "idle") return;
    let cancelled = false;
    setPullState("pulling");
    setPullError(null);
    syncFinancials({ connectionId: activeConnection._id })
      .then(() => {
        if (!cancelled) setPullState("pulled");
      })
      .catch((err: any) => {
        if (cancelled) return;
        setPullError(err?.message ?? "Wave pull failed.");
        setPullState("error");
      });
    return () => {
      cancelled = true;
    };
  }, [activeConnection?._id, activity?.account?._id, activity?.total, browserBackedWaveConnection, isTransactionAccount, pullState, syncFinancials]);

  if (society === undefined || resource === undefined) return <div className="page">Loading...</div>;
  if (society === null) return <SeedPrompt />;
  if (!resource || resource.resourceType !== "account") {
    return (
      <div className="page">
        <PageHeader
          title="Wave account"
          icon={<Database size={16} />}
          iconColor="green"
          subtitle="This cached Wave account could not be found."
          actions={
            <Link className="btn-action" to="/app/financials/wave/account">
              <ArrowLeft size={12} /> Accounts
            </Link>
          }
        />
      </div>
    );
  }

  const transactions = activity?.transactions ?? [];
  const accountKind = waveResourceSingularLabel(resource);
  const transactionLabel = isCategoryAccount ? "categorized transaction" : "synced transaction";
  const linkedTotalCents = activity?.linkedTotalCents ?? transactions.reduce((sum: number, row: any) => sum + row.amountCents, 0);

  return (
    <div className="page">
      <PageHeader
        title={resource.label}
        icon={<Database size={16} />}
        iconColor="green"
        subtitle={
          activity !== undefined
            ? `${capitalize(accountKind)} · ${activity.total ?? transactions.length} ${transactionLabel}${(activity.total ?? transactions.length) === 1 ? "" : "s"}${isCategoryAccount ? ` · ${money(linkedTotalCents)}` : ""}`
            : `Cached Wave ${accountKind} details`
        }
        actions={
          <>
            <Link className="btn-action" to="/app/financials/wave/account">
              <ArrowLeft size={12} /> Accounts
            </Link>
            <Link className="btn-action" to="/app/financials">
              Financials
            </Link>
          </>
        }
      />

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card__head">
          <h2 className="card__title">{capitalize(accountKind)} details</h2>
          {resource.status && <Badge tone={resource.status === "archived" ? "neutral" : "info"}>{resource.status}</Badge>}
        </div>
        <div className="card__body">
          <WaveResourceSummary resource={resource} />
        </div>
      </div>

      {isTransactionAccount && activity !== undefined && !activity?.account && (
        <div style={{ marginBottom: 16 }}>
          <Flag level={pullState === "error" ? "err" : "warn"}>
            {pullState === "pulling"
              ? "Pulling latest available Wave activity for this account..."
              : pullState === "error"
              ? `Wave pull failed: ${pullError ?? "unknown error"}`
              : pullState === "pulled"
              ? "Pulled latest available Wave data. This account is still not part of the synced financial account set, so there are no Societyer transactions to show yet."
              : "This Wave account is available in the raw cache but is not part of the synced financial account set, so there are no Societyer transactions to show yet."}
          </Flag>
        </div>
      )}

      {isTransactionAccount && activity?.account && pullState !== "idle" && transactions.length === 0 && (
        <div style={{ marginBottom: 16 }}>
          <Flag level={pullState === "error" ? "err" : "warn"}>
            {pullState === "pulling"
              ? "Pulling latest available Wave activity for this account..."
              : pullState === "error"
              ? `Wave pull failed: ${pullError ?? "unknown error"}`
              : "Pulled latest available Wave data. No synced transactions exist for this account; this Wave API connection exposes account balances but not general-ledger card/bank transaction lines."}
          </Flag>
        </div>
      )}

      <DataTable
        label={isCategoryAccount ? "Categorized transactions" : "Account transactions"}
        icon={<Database size={14} />}
        data={transactions as any[]}
        loading={activity === undefined}
        rowKey={(row) => row._id}
        onRowClick={(row) => setSelectedTransaction(row)}
        rowActionLabel={(row) => `Open transaction ${row.description}`}
        searchPlaceholder="Search transactions..."
        searchExtraFields={[(row) => row.counterparty, (row) => row.account?.name, (row) => row.category]}
        defaultSort={{ columnId: "date", dir: "desc" }}
        viewsKey={`wave-account-transactions-${resource._id}`}
        pagination
        initialPageSize={25}
        pageSizeOptions={[10, 25, 50, 100]}
        columns={isCategoryAccount ? categoryAccountTransactionColumns() : financialTransactionColumns(activity?.account)}
        renderRowActions={(row) => (
          <button
            className="btn btn--ghost btn--sm"
            onClick={(event) => {
              event.stopPropagation();
              setSelectedTransaction(row);
            }}
          >
            <ExternalLink size={12} /> Open
          </button>
        )}
        emptyMessage={
          pullState === "pulling"
            ? "Pulling latest available Wave activity..."
            : pullState === "pulled"
            ? "Pulled latest available Wave data. No synced transactions exist for this account."
            : isCategoryAccount
            ? "No synced transactions are categorized to this Wave account yet."
            : activity?.account
            ? "No synced transactions for this account yet."
            : "This cached Wave account is not in the synced financial account set."
        }
      />

      <TransactionDrawer
        open={Boolean(selectedTransaction)}
        transaction={selectedTransaction}
        societyId={society._id}
        account={isCategoryAccount ? selectedTransaction?.account : activity?.account}
        onClose={() => setSelectedTransaction(null)}
      />
    </div>
  );
}

export function WaveResourceDetailPage() {
  const society = useSociety();
  const { resourceType: routeResourceType, resourceId } = useParams();
  const tableResourceType = normalizeWaveResourceType(routeResourceType ?? "all");
  const resource = useQuery(
    api.waveCache.resource,
    resourceId ? { id: resourceId as any } : "skip",
  );
  const activity = useQuery(
    api.financialHub.transactionsForCounterpartyExternalId,
    society && resource && isWaveCounterpartyResource(resource) && resource.externalId
      ? { societyId: society._id, externalId: resource.externalId, resourceType: resource.resourceType, limit: 1000 }
      : "skip",
  );
  const [selectedTransaction, setSelectedTransaction] = useState<any>(null);

  useEffect(() => {
    setSelectedTransaction(null);
  }, [resource?._id]);

  if (society === undefined || resource === undefined) return <div className="page">Loading...</div>;
  if (society === null) return <SeedPrompt />;

  if (!resource) {
    return (
      <div className="page">
        <PageHeader
          title="Wave resource"
          icon={<Database size={16} />}
          iconColor="green"
          subtitle="This cached Wave resource could not be found."
          actions={
            <Link className="btn-action" to={`/app/financials/wave/${tableResourceType}`}>
              <ArrowLeft size={12} /> {waveTypeLabel(tableResourceType)}
            </Link>
          }
        />
      </div>
    );
  }

  const transactions = activity?.transactions ?? [];
  const linkedTotalCents = activity?.linkedTotalCents ?? transactions.reduce((sum: number, row: any) => sum + row.amountCents, 0);
  const resourceKind = waveSingularTypeLabel(resource.resourceType);

  return (
    <div className="page">
      <PageHeader
        title={resource.label}
        icon={<Database size={16} />}
        iconColor="green"
        subtitle={
          isWaveCounterpartyResource(resource)
            ? `${waveTypeLabel(resource.resourceType)} · ${activity?.total ?? 0} linked transaction${activity?.total === 1 ? "" : "s"} · ${money(linkedTotalCents)}`
            : `${waveTypeLabel(resource.resourceType)} · Cached Wave resource`
        }
        actions={
          <>
            <Link className="btn-action" to={`/app/financials/wave/${resource.resourceType}`}>
              <ArrowLeft size={12} /> {waveTypeLabel(resource.resourceType)}
            </Link>
            <Link className="btn-action" to="/app/financials">
              Financials
            </Link>
          </>
        }
      />

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card__head">
          <h2 className="card__title">{capitalize(resourceKind)} details</h2>
          {resource.status && <Badge tone={resource.status === "archived" ? "neutral" : "info"}>{resource.status}</Badge>}
        </div>
        <div className="card__body">
          <WaveResourceSummary resource={resource} />
        </div>
      </div>

      {isWaveCounterpartyResource(resource) ? (
        <DataTable
          label="Linked transactions"
          icon={<Database size={14} />}
          data={transactions as any[]}
          loading={activity === undefined}
          rowKey={(row) => row._id}
          onRowClick={(row) => setSelectedTransaction(row)}
          rowActionLabel={(row) => `Open transaction ${row.description}`}
          searchPlaceholder={`Search ${resource.label} transactions...`}
          searchExtraFields={[(row) => row.account?.name, (row) => row.category, (row) => row.externalId]}
          defaultSort={{ columnId: "date", dir: "desc" }}
          viewsKey={`wave-${resource.resourceType}-transactions-${resource._id}`}
          pagination
          initialPageSize={25}
          pageSizeOptions={[10, 25, 50, 100]}
          columns={counterpartyTransactionColumns()}
          renderRowActions={(row) => (
            <button
              className="btn btn--ghost btn--sm"
              onClick={(event) => {
                event.stopPropagation();
                setSelectedTransaction(row);
              }}
            >
              <ExternalLink size={12} /> Open
            </button>
          )}
          emptyMessage={`No synced transactions are linked to this ${resourceKind} yet.`}
        />
      ) : (
        <div className="card">
          <div className="card__body muted" style={{ fontSize: 13 }}>
            Detailed transaction tables are available for Wave vendors and customers.
          </div>
        </div>
      )}

      <TransactionDrawer
        open={Boolean(selectedTransaction)}
        transaction={selectedTransaction}
        societyId={society._id}
        account={selectedTransaction?.account}
        onClose={() => setSelectedTransaction(null)}
      />
    </div>
  );
}

function OperatingSubscriptionsCard({
  rows,
  loading,
  activeMonthlyCents,
  plannedMonthlyCents,
  projectedMonthlyCents,
  onNew,
  onEdit,
  onRemove,
}: {
  rows: any[];
  loading: boolean;
  activeMonthlyCents: number;
  plannedMonthlyCents: number;
  projectedMonthlyCents: number;
  onNew: () => void;
  onEdit: (row: any) => void;
  onRemove: (row: any) => void | Promise<void>;
}) {
  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="card__head">
        <h2 className="card__title">Subscriptions & monthly cost estimate</h2>
        <span className="card__subtitle">
          Recurring software, services, and operating subscriptions converted to monthly equivalents.
        </span>
        <div style={{ marginLeft: "auto" }}>
          <button className="btn-action" onClick={onNew}>
            <PlusCircle size={12} /> Add subscription
          </button>
        </div>
      </div>

      <div className="stat-grid" style={{ margin: "0 16px 16px" }}>
        <Stat label="Active monthly" value={money(activeMonthlyCents)} />
        <Stat label="Planned monthly" value={money(plannedMonthlyCents)} />
        <Stat label="Projected monthly" value={money(projectedMonthlyCents)} />
        <Stat label="Annual run-rate" value={money(projectedMonthlyCents * 12)} />
      </div>

      <table className="table">
        <thead>
          <tr>
            <th>Service</th>
            <th>Category</th>
            <th>Status</th>
            <th>Billing</th>
            <th style={{ textAlign: "right" }}>Monthly est.</th>
            <th>Renewal</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row._id}>
              <td>
                <strong>{row.name}</strong>
                {row.vendorName && <div className="muted" style={{ fontSize: 12 }}>{row.vendorName}</div>}
              </td>
              <td><span className="cell-tag">{row.category}</span></td>
              <td><Badge tone={operatingSubscriptionStatusTone(row.status)}>{row.status}</Badge></td>
              <td>
                <span className="table__cell--mono">{money(row.amountCents)}</span>
                <span className="muted"> / {operatingSubscriptionIntervalLabel(row.interval)}</span>
              </td>
              <td className="table__cell--mono" style={{ textAlign: "right" }}>
                {money(row.monthlyEstimateCents ?? monthlyEstimateCents(row))}
              </td>
              <td className="table__cell--mono">{row.nextRenewalDate ? formatDate(row.nextRenewalDate) : "—"}</td>
              <td style={{ textAlign: "right" }}>
                <button className="btn btn--ghost btn--sm" onClick={() => onEdit(row)}>
                  Edit
                </button>
                <button
                  className="btn btn--ghost btn--sm btn--icon"
                  aria-label={`Remove subscription cost ${row.name}`}
                  onClick={() => onRemove(row)}
                >
                  <Trash2 size={12} />
                </button>
              </td>
            </tr>
          ))}
          {!loading && rows.length === 0 && (
            <tr>
              <td colSpan={7} className="muted" style={{ textAlign: "center", padding: 16 }}>
                No subscription costs yet. Add software, services, or other recurring expenses to estimate monthly spend.
              </td>
            </tr>
          )}
          {loading && (
            <tr>
              <td colSpan={7} className="muted" style={{ textAlign: "center", padding: 16 }}>
                Loading subscription costs...
              </td>
            </tr>
          )}
        </tbody>
      </table>
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

function WaveHealthPanel({ result }: { result: any }) {
  const envRows = result.env ?? [];
  const steps = result.steps ?? [];
  const checkedAt = result.checkedAtISO ? formatDateTime(result.checkedAtISO) : "just now";

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="card__head">
        <h2 className="card__title">Wave connection health</h2>
        <Badge tone={healthTone(result.status)}>
          {healthLabel(result.status)}
        </Badge>
        <span className="card__subtitle">
          {checkedAt} · {result.mode === "live" ? "live" : "not configured"} · secrets redacted
        </span>
      </div>
      <div
        className="card__body"
        style={{
          display: "grid",
          gap: 16,
          gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
        }}
      >
        <div>
          <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>Expected environment</div>
          <div style={{ display: "grid", gap: 8 }}>
            {envRows.map((row: any) => (
              <div key={row.name} style={{ display: "grid", gap: 4 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                  <code className="mono">{row.name}</code>
                  <Badge tone={row.present ? "success" : row.required ? "danger" : "neutral"}>
                    {row.present ? "present" : "missing"}
                  </Badge>
                  {row.required && <Badge tone="warn">required</Badge>}
                  {row.secret && <Badge tone="info">secret</Badge>}
                </div>
                <div className="muted" style={{ fontSize: 12 }}>{redactCredentialText(row.purpose)}</div>
              </div>
            ))}
          </div>
        </div>

        <div>
          <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>Probe result</div>
          {result.business && (
            <div style={{ marginBottom: 10 }}>
              <strong>{redactCredentialText(result.business.name ?? "Selected business")}</strong>
              {result.business.currencyCode && <span className="muted"> · {redactCredentialText(result.business.currencyCode)}</span>}
              <div className="muted" style={{ fontSize: 12 }}>Business source: {businessSourceLabel(result.business.source)}</div>
            </div>
          )}
          <div style={{ display: "grid", gap: 8 }}>
            {steps.map((step: any) => (
              <div key={step.id} style={{ display: "grid", gap: 4 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                  <Badge tone={healthTone(step.status)}>{healthLabel(step.status)}</Badge>
                  <strong>{step.label}</strong>
                </div>
                <div className="muted" style={{ fontSize: 12 }}>{redactCredentialText(step.message)}</div>
                {step.detail && (
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {Object.entries(step.detail).map(([key, value]) => (
                      <span key={key} className="cell-tag">{redactCredentialText(key)}: {formatWaveHealthDetail(value)}</span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function redactWaveHealthResult(result: any) {
  return {
    ...result,
    business: result?.business
      ? {
          ...result.business,
          name: result.business.name ? redactCredentialText(result.business.name) : result.business.name,
          currencyCode: result.business.currencyCode ? redactCredentialText(result.business.currencyCode) : result.business.currencyCode,
        }
      : result?.business,
    steps: (result?.steps ?? []).map((step: any) => ({
      ...step,
      label: redactCredentialText(step.label),
      message: redactCredentialText(step.message),
      detail: step.detail ? redactWaveHealthDetail(step.detail) : step.detail,
    })),
  };
}

function redactWaveHealthDetail(detail: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(detail).map(([key, value]) => [
      redactCredentialText(key),
      typeof value === "string" ? redactCredentialText(value) : value,
    ]),
  );
}

function formatWaveHealthDetail(value: unknown) {
  return typeof value === "string" ? redactCredentialText(value) : String(value);
}

function redactCredentialText(value: unknown) {
  return String(value ?? "")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, "Bearer [redacted]")
    .replace(/(Authorization\s*:\s*)[^\s,;")]+/gi, "$1[redacted]")
    .replace(/\b(access[_-]?token|refresh[_-]?token|client[_-]?(?:id|secret)|authorization|code)=([^&\s]+)/gi, "$1=[redacted]")
    .replace(/(["']?(?:access[_-]?token|refresh[_-]?token|client[_-]?(?:id|secret)|authorization|api[_-]?key|token|secret|code)["']?\s*[:=]\s*["']?)([^"',}\s;]+)/gi, "$1[redacted]")
    .replace(/\bwave_[A-Za-z0-9._~-]{4,}\b/g, "wave_[redacted]")
    .replace(/\b[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, "[redacted-token]");
}

function healthTone(status?: string): "success" | "warn" | "danger" | "neutral" {
  if (status === "pass") return "success";
  if (status === "warn") return "warn";
  if (status === "fail") return "danger";
  return "neutral";
}

function healthLabel(status?: string) {
  if (status === "pass") return "pass";
  if (status === "warn") return "warning";
  if (status === "fail") return "fail";
  return "skipped";
}

function businessSourceLabel(source?: string) {
  if (source === "env") return "WAVE_BUSINESS_ID";
  if (source === "argument") return "connection";
  if (source === "firstAccessible") return "first accessible business";
  return "unknown";
}

function WaveCacheExplorer({
  societyId,
  syncConnectionId,
  syncFinancials,
  busy,
  mode,
  onModeChange,
  onRefresh,
  resources,
  resourceType,
  resourceTypes,
  search,
  selectedResource,
  selectedResourceId,
  hideZeroAccounts,
  structures,
  summary,
  onHideZeroAccountsChange,
  onResourceTypeChange,
  onSearchChange,
  onSelectResource,
}: {
  societyId: any;
  syncConnectionId?: any;
  syncFinancials?: (args: { connectionId: any }) => Promise<any>;
  busy: boolean;
  mode: "resources" | "structures";
  onModeChange: (mode: "resources" | "structures") => void;
  onRefresh: () => void;
  resources: any[];
  resourceType: string;
  resourceTypes: string[];
  search: string;
  selectedResource: any;
  selectedResourceId: string | null;
  hideZeroAccounts: boolean;
  structures: any[];
  summary: any;
  onHideZeroAccountsChange: (value: boolean) => void;
  onResourceTypeChange: (type: string) => void;
  onSearchChange: (value: string) => void;
  onSelectResource: (id: string | null) => void;
}) {
  const counts = summary?.resourceCounts ?? {};
  const totalResources = Object.values(counts).reduce((sum: number, value: any) => sum + Number(value ?? 0), 0);
  const visibleResources = hideZeroAccounts
    ? resources.filter((row) => row.resourceType !== "account" || !isZeroWaveAmount(row.amountValue))
    : resources;
  const hiddenZeroAccounts = resources.length - visibleResources.length;
  const selectedFallback = resources.find((row) => row._id === selectedResourceId) ?? null;
  const openTableType = resourceType || "all";

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="card__head">
        <h2 className="card__title">Wave data cache</h2>
        <span className="card__subtitle">
          {summary ? (
            <>
              {summary.businessName} · {totalResources} resources · {summary.structureTypes?.length ?? 0} structures · {formatDateTime(summary.fetchedAtISO)}
            </>
          ) : (
            <>No cached Wave snapshot yet.</>
          )}
        </span>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button className={mode === "resources" ? "btn btn--accent btn--sm" : "btn btn--ghost btn--sm"} onClick={() => onModeChange("resources")}>
            <Database size={12} /> Data
          </button>
          <button className={mode === "structures" ? "btn btn--accent btn--sm" : "btn btn--ghost btn--sm"} onClick={() => onModeChange("structures")}>
            <Braces size={12} /> Structures
          </button>
          <button className="btn-action" disabled={busy} onClick={onRefresh}>
            <RefreshCw size={12} /> Refresh
          </button>
        </div>
      </div>

      <div className="card__body" style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        {mode === "resources" && (
          <>
            <button
              className={resourceType === "all" ? "btn btn--accent btn--sm" : "btn btn--ghost btn--sm"}
              onClick={() => onResourceTypeChange("all")}
            >
              All <span className="muted">{totalResources}</span>
            </button>
            {resourceTypes.map((type) => (
              <button
                key={type}
                className={resourceType === type ? "btn btn--accent btn--sm" : "btn btn--ghost btn--sm"}
                onClick={() => onResourceTypeChange(type)}
              >
                {waveTypeLabel(type)} <span className="muted">{counts[type] ?? 0}</span>
              </button>
            ))}
            <button
              className={hideZeroAccounts ? "btn btn--accent btn--sm" : "btn btn--ghost btn--sm"}
              onClick={() => onHideZeroAccountsChange(!hideZeroAccounts)}
              title="Toggle zero-balance account rows in this cache table. Raw Wave data is always stored."
            >
              Zero-balance <span className="muted">{hideZeroAccounts ? "hidden" : "shown"}</span>
            </button>
            <Link className="btn btn--ghost btn--sm" to={`/app/financials/wave/${openTableType}`}>
              <ExternalLink size={12} /> Open table
            </Link>
          </>
        )}
        <input
          className="input"
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder={mode === "resources" ? "Search cached Wave data" : "Search structures"}
          style={{ marginLeft: "auto", maxWidth: 280 }}
        />
      </div>

      {mode === "resources" ? (
        <>
          <table className="table">
            <thead>
              <tr>
                <th>Resource</th>
                <th>Type</th>
                <th>Status</th>
                <th>Value</th>
                <th>Date</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {visibleResources.map((row) => {
                const selected = selectedResourceId === row._id;
                return (
                  <tr
                    key={row._id}
                    onClick={() => onSelectResource(row._id)}
                    style={{ cursor: "pointer", background: selected ? "var(--surface-muted)" : undefined }}
                  >
                    <td>
                      <strong>{row.label}</strong>
                    </td>
                    <td>
                      <Badge>{waveTypeLabel(row.resourceType)}</Badge>
                      {(row.typeValue || row.subtypeValue) && (
                        <div className="muted" style={{ fontSize: 12 }}>
                          {[row.typeValue, row.subtypeValue].filter(Boolean).join(" / ")}
                        </div>
                      )}
                    </td>
                    <td>{row.status ? <Badge tone={row.status === "archived" ? "neutral" : "info"}>{row.status}</Badge> : "—"}</td>
                    <td className="table__cell--mono"><WaveResourceValue row={row} /></td>
                    <td className="table__cell--mono">{row.dateValue ?? "—"}</td>
                    <td style={{ textAlign: "right" }}>
                      <Link
                        className="btn btn--ghost btn--sm"
                        to={waveResourceDetailHref(row)}
                        onClick={(event) => {
                          event.stopPropagation();
                        }}
                      >
                        <ExternalLink size={12} /> Details
                      </Link>
                    </td>
                  </tr>
                );
              })}
              {visibleResources.length === 0 && (
                <tr>
                  <td colSpan={6} className="muted" style={{ textAlign: "center", padding: 16 }}>
                    {summary ? "No cached rows match this view." : "Refresh the Wave cache to load data."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>

          <WaveResourceDrawer
            open={Boolean(selectedResourceId)}
            societyId={societyId}
            syncConnectionId={syncConnectionId}
            syncFinancials={syncFinancials}
            resource={selectedResource}
            fallback={selectedFallback}
            onClose={() => onSelectResource(null)}
          />

          {hiddenZeroAccounts > 0 && (
            <div className="card__body muted" style={{ borderTop: "1px solid var(--border)", fontSize: 12 }}>
              Hidden {hiddenZeroAccounts} zero-balance account row{hiddenZeroAccounts === 1 ? "" : "s"} from this view.
            </div>
          )}
        </>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Type</th>
              <th>Kind</th>
              <th>Fields</th>
            </tr>
          </thead>
          <tbody>
            {structures.map((row) => (
              <tr key={row._id}>
                <td><strong>{row.typeName}</strong></td>
                <td><Badge>{row.kind}</Badge></td>
                <td>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {(row.fields ?? []).slice(0, 16).map((field: any) => (
                      <span key={field.name} className="cell-tag">{field.name}</span>
                    ))}
                    {(row.fields?.length ?? 0) > 16 && <span className="muted">+{row.fields.length - 16}</span>}
                  </div>
                </td>
              </tr>
            ))}
            {structures.length === 0 && (
              <tr>
                <td colSpan={3} className="muted" style={{ textAlign: "center", padding: 16 }}>
                  {summary ? "No cached structures match this view." : "Refresh the Wave cache to load structures."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}
    </div>
  );
}

function WaveResourceDrawer({
  open,
  societyId,
  syncConnectionId,
  syncFinancials,
  resource,
  fallback,
  onClose,
}: {
  open: boolean;
  societyId: any;
  syncConnectionId?: any;
  syncFinancials?: (args: { connectionId: any }) => Promise<any>;
  resource: any;
  fallback: any;
  onClose: () => void;
}) {
  const title = resource?.label ?? fallback?.label ?? "Wave resource";
  return (
    <Drawer open={open} onClose={onClose} title={title}>
      <WaveResourceDetail
        societyId={societyId}
        syncConnectionId={syncConnectionId}
        syncFinancials={syncFinancials}
        resource={resource}
        fallback={fallback}
      />
    </Drawer>
  );
}

function WaveResourceDetail({
  societyId,
  syncConnectionId,
  syncFinancials,
  resource,
  fallback,
}: {
  societyId: any;
  syncConnectionId?: any;
  syncFinancials?: (args: { connectionId: any }) => Promise<any>;
  resource: any;
  fallback: any;
}) {
  const [pullState, setPullState] = useState<"idle" | "pulling" | "pulled" | "error">("idle");
  const [pullError, setPullError] = useState<string | null>(null);
  const isTransactionAccount = resource?.resourceType === "account" && isWaveTransactionAccount(resource);
  const isCategoryAccount = resource?.resourceType === "account" && !isWaveTransactionAccount(resource);
  const accountActivity = useQuery(
    api.financialHub.transactionsForAccountExternalId,
    societyId && isTransactionAccount && resource.externalId
      ? { societyId, externalId: resource.externalId, limit: 10 }
      : "skip",
  );
  const categoryActivity = useQuery(
    api.financialHub.transactionsForCategoryAccountExternalId,
    societyId && isCategoryAccount && resource.externalId
      ? { societyId, externalId: resource.externalId, label: resource.label, limit: 10 }
      : "skip",
  );
  const counterpartyActivity = useQuery(
    api.financialHub.transactionsForCounterpartyExternalId,
    societyId && isWaveCounterpartyResource(resource) && resource.externalId
      ? { societyId, externalId: resource.externalId, resourceType: resource.resourceType, limit: 10 }
      : "skip",
  );

  useEffect(() => {
    setPullState("idle");
    setPullError(null);
  }, [resource?._id]);

  useEffect(() => {
    if (!isTransactionAccount) return;
    if (accountActivity === undefined) return;
    if (accountActivity.account && accountActivity.total !== 0) return;
    if (!syncConnectionId || !syncFinancials || pullState !== "idle") return;
    let cancelled = false;
    setPullState("pulling");
    setPullError(null);
    syncFinancials({ connectionId: syncConnectionId })
      .then(() => {
        if (!cancelled) setPullState("pulled");
      })
      .catch((err: any) => {
        if (cancelled) return;
        setPullError(err?.message ?? "Wave pull failed.");
        setPullState("error");
      });
    return () => {
      cancelled = true;
    };
  }, [accountActivity?.account?._id, accountActivity?.total, isTransactionAccount, pullState, syncConnectionId, syncFinancials]);

  if (!resource) {
    return (
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Braces size={14} />
          <strong>{fallback?.label ?? "Wave resource"}</strong>
          <span className="muted">Loading Wave details...</span>
        </div>
      </div>
    );
  }

  const resourcePageHref = waveResourceDetailHref(resource);
  const accountPageHref = resource.resourceType === "account" ? resourcePageHref : null;

  return (
    <div
      style={{
        display: "grid",
        gap: 12,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <Braces size={14} />
        <strong>{resource.label}</strong>
        <Badge>{waveResourceBadgeLabel(resource)}</Badge>
        {resource.status && <Badge tone={resource.status === "archived" ? "neutral" : "info"}>{resource.status}</Badge>}
        {resourcePageHref && (
          <Link className="btn btn--ghost btn--sm" to={resourcePageHref}>
            <ExternalLink size={12} /> Open detail page
          </Link>
        )}
      </div>

      <WaveResourceSummary resource={resource} />

      {resource.resourceType === "account" && (
        <AccountTransactionsPreview
          activity={isTransactionAccount ? accountActivity : categoryActivity}
          accountPageHref={accountPageHref}
          mode={isTransactionAccount ? "account" : "category"}
          pullState={pullState}
          pullError={pullError}
        />
      )}
      {isWaveCounterpartyResource(resource) && (
        <CounterpartyTransactionsPreview
          activity={counterpartyActivity}
          resource={resource}
          detailPageHref={resourcePageHref}
        />
      )}
    </div>
  );
}

function WaveResourceSummary({ resource }: { resource: any }) {
  const raw = resource.raw ?? {};
  const fields = waveResourceDetailFields(resource, raw);
  const description = typeof raw.description === "string" ? raw.description : undefined;

  return (
    <div style={{ display: "grid", gap: 12 }}>
      {description && (
        <div className="muted" style={{ fontSize: 13 }}>
          {description}
        </div>
      )}

      <div
        style={{
          display: "grid",
          gap: 10,
          gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
        }}
      >
        {fields.map((field) => (
          <div key={field.label}>
            <div className="muted" style={{ fontSize: 11, textTransform: "uppercase" }}>
              {field.label}
            </div>
            <div
              className={field.mono ? "table__cell--mono" : undefined}
              style={{ fontSize: 13, overflowWrap: "anywhere" }}
            >
              {field.value}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function AccountTransactionsPreview({
  activity,
  accountPageHref,
  mode = "account",
  pullState,
  pullError,
}: {
  activity: any;
  accountPageHref: string | null;
  mode?: "account" | "category";
  pullState?: "idle" | "pulling" | "pulled" | "error";
  pullError?: string | null;
}) {
  const rows = activity?.transactions ?? [];
  const isCategory = mode === "category";
  return (
    <div style={{ borderTop: "1px solid var(--border)", paddingTop: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <strong>Transactions</strong>
        {activity?.total != null && (
          <span className="muted">
            {activity.total} {isCategory ? "categorized" : "synced"}
          </span>
        )}
        {accountPageHref && (
          <Link className="btn btn--ghost btn--sm" style={{ marginLeft: "auto" }} to={accountPageHref}>
            <ExternalLink size={12} /> Open table
          </Link>
        )}
      </div>
      {pullState === "pulling" ? (
        <div className="muted" style={{ fontSize: 13 }}>Pulling latest available Wave activity...</div>
      ) : pullState === "error" ? (
        <div className="muted" style={{ fontSize: 13 }}>
          Wave pull failed: {pullError ?? "unknown error"}
        </div>
      ) : activity === undefined ? (
        <div className="muted" style={{ fontSize: 13 }}>Loading transactions...</div>
      ) : !isCategory && !activity.account ? (
        <div className="muted" style={{ fontSize: 13 }}>
          This cached Wave account is not in the synced financial account set, so there are no Societyer transactions to show.
        </div>
      ) : rows.length === 0 ? (
        <div className="muted" style={{ fontSize: 13 }}>
          {isCategory
            ? "No synced transactions are categorized to this Wave account yet. Reimport Wave browser transactions to backfill exact category-account links for older rows."
            : pullState === "pulled"
            ? "Pulled latest available Wave data. No synced transactions exist for this account; this Wave API connection exposes account balances but not general-ledger card/bank transaction lines."
            : "No synced transactions for this account yet."}
        </div>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Description</th>
              <th style={{ textAlign: "right" }}>Amount</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 10).map((row: any) => (
              <tr key={row._id}>
                <td className="table__cell--mono">{row.date}</td>
                <td>
                  <strong>{row.description}</strong>
                  {isCategory
                    ? row.account?.name && <div className="muted" style={{ fontSize: 12 }}>{row.account.name}</div>
                    : row.category && <div className="muted" style={{ fontSize: 12 }}>{row.category}</div>}
                </td>
                <td className="table__cell--mono" style={{ textAlign: "right" }}>{money(row.amountCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function CounterpartyTransactionsPreview({
  activity,
  resource,
  detailPageHref,
}: {
  activity: any;
  resource: any;
  detailPageHref?: string | null;
}) {
  const rows = activity?.transactions ?? [];
  const resourceKind = waveSingularTypeLabel(resource.resourceType);
  return (
    <div style={{ borderTop: "1px solid var(--border)", paddingTop: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <strong>Transactions</strong>
        {activity?.total != null && (
          <span className="muted">
            {activity.total} linked to this {resourceKind}
          </span>
        )}
        {detailPageHref && (
          <Link className="btn btn--ghost btn--sm" style={{ marginLeft: "auto" }} to={detailPageHref}>
            <ExternalLink size={12} /> Open table
          </Link>
        )}
      </div>
      {activity === undefined ? (
        <div className="muted" style={{ fontSize: 13 }}>Loading linked transactions...</div>
      ) : rows.length === 0 ? (
        <div className="muted" style={{ fontSize: 13 }}>
          No synced transactions are linked to this {resourceKind} yet.
          Reimport Wave browser transactions to backfill vendor and customer links for older rows.
        </div>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Description</th>
              <th>Account</th>
              <th>Category</th>
              <th style={{ textAlign: "right" }}>Amount</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 10).map((row: any) => {
              const accountHref = row.accountResource?._id ? `/app/financials/wave/account/${row.accountResource._id}` : null;
              return (
                <tr key={row._id}>
                  <td className="table__cell--mono">{row.date}</td>
                  <td>
                    <strong>{row.description}</strong>
                    {row.externalId && <div className="muted table__cell--mono" style={{ fontSize: 11 }}>{row.externalId}</div>}
                  </td>
                  <td>
                    {accountHref ? (
                      <Link to={accountHref}>{row.account?.name ?? row.accountResource?.label ?? "Wave account"}</Link>
                    ) : (
                      <span className="muted">{row.account?.name ?? "—"}</span>
                    )}
                  </td>
                  <td>{row.category ? <Badge>{row.category}</Badge> : <span className="muted">uncategorized</span>}</td>
                  <td className="table__cell--mono" style={{ textAlign: "right" }}>{money(row.amountCents)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

function TransactionDrawer({
  open,
  transaction,
  societyId,
  account,
  onClose,
}: {
  open: boolean;
  transaction: any;
  societyId?: any;
  account: any;
  onClose: () => void;
}) {
  const counterpartyResource = useQuery(
    api.waveCache.resourceByExternalId,
    societyId && transaction?.counterpartyExternalId
      ? {
          societyId,
          externalId: transaction.counterpartyExternalId,
          ...(transaction.counterpartyResourceType ? { resourceType: transaction.counterpartyResourceType } : {}),
        }
      : "skip",
  );
  const categoryResource = useQuery(
    api.waveCache.resourceByExternalId,
    societyId && transaction?.categoryAccountExternalId
      ? {
          societyId,
          externalId: transaction.categoryAccountExternalId,
          resourceType: "account",
        }
      : "skip",
  );
  const counterpartyHref = counterpartyResource
    ? waveResourceDetailHref(counterpartyResource)
    : null;
  const categoryHref = categoryResource
    ? waveResourceDetailHref(categoryResource)
    : null;

  return (
    <Drawer open={open} onClose={onClose} title={transaction?.description ?? "Transaction"}>
      {transaction && (
        <div style={{ display: "grid", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <Badge tone={transaction.amountCents < 0 ? "warn" : "success"}>
              {transaction.amountCents < 0 ? "expense" : "income"}
            </Badge>
            <strong>{money(transaction.amountCents)}</strong>
          </div>
          <div
            style={{
              display: "grid",
              gap: 10,
              gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
            }}
          >
            <DetailCell label="Date" value={transaction.date} mono />
            <DetailCell label="Account" value={account?.name ?? "—"} />
            <DetailCell
              label="Category"
              value={transaction.category ?? "uncategorized"}
              href={categoryHref}
              suffix={categoryResource ? waveResourceBadgeLabel(categoryResource) : undefined}
            />
            <DetailCell
              label="Counterparty"
              value={transaction.counterparty ?? "—"}
              href={counterpartyHref}
              suffix={counterpartyResource ? waveTypeLabel(counterpartyResource.resourceType) : undefined}
            />
            <DetailCell label="External reference" value={transaction.externalId ?? "—"} mono />
          </div>
        </div>
      )}
    </Drawer>
  );
}

function DetailCell({
  label,
  value,
  mono,
  href,
  suffix,
}: {
  label: string;
  value: string;
  mono?: boolean;
  href?: string | null;
  suffix?: string;
}) {
  return (
    <div>
      <div className="muted" style={{ fontSize: 11, textTransform: "uppercase" }}>{label}</div>
      <div className={mono ? "table__cell--mono" : undefined} style={{ fontSize: 13, overflowWrap: "anywhere" }}>
        {href ? <Link to={href}>{value}</Link> : value}
        {suffix && <div className="muted" style={{ fontSize: 11 }}>{suffix}</div>}
      </div>
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
  status: "live" | "demo" | "setup" | "planned";
  onConnect?: () => void;
  busy?: boolean;
}) {
  const statusLabel = status === "setup" ? "setup required" : status;
  const statusTone = status === "live" ? "success" : status === "demo" ? "info" : status === "setup" ? "warn" : "neutral";
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
        <Badge tone={statusTone}>{statusLabel}</Badge>
      </div>
      <div className="muted" style={{ fontSize: 12, margin: "6px 0 10px" }}>
        {desc}
      </div>
      {onConnect ? (
        <button className="btn btn--accent btn--sm" disabled={busy} onClick={onConnect}>
          <Link2 size={12} /> Connect
        </button>
      ) : status === "setup" ? (
        <button className="btn btn--ghost btn--sm" disabled>
          Configure Wave
        </button>
      ) : (
        <button className="btn btn--ghost btn--sm" disabled>
          Coming soon
        </button>
      )}
    </div>
  );
}

function waveTypeLabel(type: string) {
  const labels: Record<string, string> = {
    availableBusiness: "Available business",
    business: "Business",
    account: "Accounts",
    vendor: "Vendors",
    customer: "Customers",
    product: "Products",
    invoice: "Invoices",
    estimate: "Estimates",
    salesTax: "Sales taxes",
  };
  return labels[type] ?? type;
}

/**
 * Returns a link target for a cached Wave resource. Accounts have a dedicated
 * detail page; every other resource type uses the generic Wave resource page.
 */
function waveResourceDetailHref(resource: any): string {
  if (!resource?._id || !resource?.resourceType) return "/app/financials/wave/all";
  if (resource.resourceType === "account") return `/app/financials/wave/account/${resource._id}`;
  return `/app/financials/wave/${resource.resourceType}/${resource._id}`;
}

function newOperatingSubscriptionForm() {
  return {
    name: "",
    vendorName: "",
    category: "Software",
    amountCad: "",
    interval: "month",
    status: "Active",
    nextRenewalDate: "",
    notes: "",
  };
}

function operatingSubscriptionFormFromRow(row: any) {
  return {
    id: row._id,
    name: row.name,
    vendorName: row.vendorName ?? "",
    category: row.category,
    amountCad: String((row.amountCents ?? 0) / 100),
    interval: row.interval,
    status: row.status,
    nextRenewalDate: row.nextRenewalDate ?? "",
    notes: row.notes ?? "",
  };
}

function optionalText(value?: string) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function monthlyEstimateCents(row: { amountCents: number; interval: string }) {
  if (row.interval === "week") return Math.round((row.amountCents * 52) / 12);
  if (row.interval === "quarter") return Math.round(row.amountCents / 3);
  if (row.interval === "year") return Math.round(row.amountCents / 12);
  return row.amountCents;
}

function operatingSubscriptionIntervalLabel(interval: string) {
  return OPERATING_SUBSCRIPTION_INTERVALS.find((row) => row.value === interval)?.label.toLowerCase() ?? interval;
}

function operatingSubscriptionStatusTone(status: string): "success" | "warn" | "neutral" | "info" {
  if (status === "Active") return "success";
  if (status === "Planned") return "info";
  if (status === "Paused") return "warn";
  return "neutral";
}

function waveResourceColumns() {
  return [
    {
      id: "resource",
      header: "Resource",
      sortable: true,
      accessor: (row: any) => row.label,
      render: (row: any) => <strong>{row.label}</strong>,
    },
    {
      id: "type",
      header: "Type",
      sortable: true,
      accessor: (row: any) => [waveResourceBadgeLabel(row), row.typeValue, row.subtypeValue].filter(Boolean).join(" / "),
      render: (row: any) => (
        <>
          <Badge>{waveResourceBadgeLabel(row)}</Badge>
          {(row.typeValue || row.subtypeValue) && (
            <div className="muted" style={{ fontSize: 12 }}>
              {row.resourceType === "account"
                ? ["Wave account", row.typeValue, row.subtypeValue].filter(Boolean).join(" / ")
                : [row.typeValue, row.subtypeValue].filter(Boolean).join(" / ")}
            </div>
          )}
        </>
      ),
    },
    {
      id: "status",
      header: "Status",
      sortable: true,
      accessor: (row: any) => row.status ?? "",
      render: (row: any) => row.status ? <Badge tone={row.status === "archived" ? "neutral" : "info"}>{row.status}</Badge> : "—",
    },
    {
      id: "value",
      header: "Value",
      sortable: true,
      align: "right" as const,
      accessor: (row: any) => waveResourceValueSort(row),
      render: (row: any) => (
        <span className="table__cell--mono"><WaveResourceValue row={row} /></span>
      ),
    },
    {
      id: "date",
      header: "Date",
      sortable: true,
      accessor: (row: any) => row.dateValue ?? "",
      render: (row: any) => <span className="table__cell--mono">{row.dateValue ?? "—"}</span>,
    },
  ];
}

function counterpartyTransactionColumns() {
  return [
    {
      id: "date",
      header: "Date",
      sortable: true,
      accessor: (row: any) => row.date,
      render: (row: any) => <span className="table__cell--mono">{row.date}</span>,
    },
    {
      id: "description",
      header: "Description",
      sortable: true,
      accessor: (row: any) => row.description,
      render: (row: any) => (
        <>
          <strong>{row.description}</strong>
          {row.externalId && <div className="muted table__cell--mono" style={{ fontSize: 11 }}>{row.externalId}</div>}
        </>
      ),
    },
    {
      id: "account",
      header: "Account",
      sortable: true,
      accessor: (row: any) => row.account?.name ?? row.accountResource?.label ?? "",
      render: (row: any) => {
        const accountHref = row.accountResource?._id ? `/app/financials/wave/account/${row.accountResource._id}` : null;
        return accountHref ? (
          <Link to={accountHref}>{row.account?.name ?? row.accountResource?.label ?? "Wave account"}</Link>
        ) : (
          <span className="muted">{row.account?.name ?? "—"}</span>
        );
      },
    },
    {
      id: "category",
      header: "Category",
      sortable: true,
      accessor: (row: any) => row.category ?? "",
      render: (row: any) => row.category ? <Badge>{row.category}</Badge> : <span className="muted">uncategorized</span>,
    },
    {
      id: "amount",
      header: "Amount",
      sortable: true,
      align: "right" as const,
      accessor: (row: any) => row.amountCents,
      render: (row: any) => (
        <span
          className="table__cell--mono"
          style={{ color: row.amountCents < 0 ? "var(--danger)" : "var(--success)" }}
        >
          {money(row.amountCents)}
        </span>
      ),
    },
  ];
}

function categoryAccountTransactionColumns() {
  return [
    {
      id: "date",
      header: "Date",
      sortable: true,
      accessor: (row: any) => row.date,
      render: (row: any) => <span className="table__cell--mono">{row.date}</span>,
    },
    {
      id: "description",
      header: "Description",
      sortable: true,
      accessor: (row: any) => row.description,
      render: (row: any) => (
        <>
          <strong>{row.description}</strong>
          {row.counterparty && <div className="muted" style={{ fontSize: 12 }}>{row.counterparty}</div>}
          {row.externalId && <div className="muted table__cell--mono" style={{ fontSize: 11 }}>{row.externalId}</div>}
        </>
      ),
    },
    {
      id: "account",
      header: "Transaction account",
      sortable: true,
      accessor: (row: any) => row.account?.name ?? row.accountResource?.label ?? "",
      render: (row: any) => {
        const accountHref = row.accountResource?._id ? `/app/financials/wave/account/${row.accountResource._id}` : null;
        return accountHref ? (
          <Link to={accountHref}>{row.account?.name ?? row.accountResource?.label ?? "Wave account"}</Link>
        ) : (
          <span className="muted">{row.account?.name ?? "—"}</span>
        );
      },
    },
    {
      id: "amount",
      header: "Amount",
      sortable: true,
      align: "right" as const,
      accessor: (row: any) => row.amountCents,
      render: (row: any) => (
        <span
          className="table__cell--mono"
          style={{ color: row.amountCents < 0 ? "var(--danger)" : "var(--success)" }}
        >
          {money(row.amountCents)}
        </span>
      ),
    },
  ];
}

function financialTransactionColumns(account: any) {
  return [
    {
      id: "date",
      header: "Date",
      sortable: true,
      accessor: (row: any) => row.date,
      render: (row: any) => <span className="table__cell--mono">{row.date}</span>,
    },
    {
      id: "description",
      header: "Description",
      sortable: true,
      accessor: (row: any) => row.description,
      render: (row: any) => (
        <>
          <strong>{row.description}</strong>
          {row.counterparty && <div className="muted" style={{ fontSize: 12 }}>{row.counterparty}</div>}
        </>
      ),
    },
    {
      id: "account",
      header: "Account",
      accessor: () => account?.name ?? "",
      render: () => <span className="muted">{account?.name ?? "—"}</span>,
    },
    {
      id: "category",
      header: "Category",
      sortable: true,
      accessor: (row: any) => row.category ?? "",
      render: (row: any) => <Badge>{row.category ?? "uncategorized"}</Badge>,
    },
    {
      id: "amount",
      header: "Amount",
      sortable: true,
      align: "right" as const,
      accessor: (row: any) => row.amountCents,
      render: (row: any) => (
        <span
          className="table__cell--mono"
          style={{ color: row.amountCents < 0 ? "var(--danger)" : "var(--success)" }}
        >
          {money(row.amountCents)}
        </span>
      ),
    },
  ];
}

function WaveResourceValue({ row }: { row: any }) {
  if (isWaveCounterpartyResource(row) && row.externalId) {
    const count = Number(row.linkedTransactionCount ?? 0);
    if (count > 0) {
      return (
        <>
          {money(Number(row.linkedTransactionTotalCents ?? 0))}
          <div className="muted" style={{ fontSize: 11 }}>
            {count} txn{count === 1 ? "" : "s"}
          </div>
        </>
      );
    }
    return <span className="muted">0 txns</span>;
  }
  if (isWaveCategoryAccount(row) && row.externalId) {
    const count = Number(row.linkedCategoryTransactionCount ?? 0);
    return (
      <>
        {formatWaveValue(row.amountValue, row.currencyCode)}
        {count > 0 && (
          <div className="muted" style={{ fontSize: 11 }}>
            {count} categorized txn{count === 1 ? "" : "s"}
          </div>
        )}
      </>
    );
  }
  return <>{formatWaveValue(row.amountValue, row.currencyCode)}</>;
}

function waveResourceValueSort(row: any) {
  if (isWaveCounterpartyResource(row) && row.externalId) {
    return Number(row.linkedTransactionTotalCents ?? 0);
  }
  if (isWaveCategoryAccount(row) && row.externalId && row.amountValue == null) {
    return Number(row.linkedCategoryTransactionTotalCents ?? 0);
  }
  return Number(row.amountValue ?? 0);
}

function normalizeWaveResourceType(value: string) {
  const aliases: Record<string, string> = {
    data: "all",
    resources: "all",
    accounts: "account",
    vendors: "vendor",
    products: "product",
    customers: "customer",
    invoices: "invoice",
    estimates: "estimate",
    salesTaxes: "salesTax",
    "sales-taxes": "salesTax",
    businesses: "business",
    availableBusinesses: "availableBusiness",
    "available-businesses": "availableBusiness",
  };
  return aliases[value] ?? value;
}

function isWaveCounterpartyResource(resource: any) {
  return resource?.resourceType === "vendor" || resource?.resourceType === "customer";
}

function isWaveTransactionAccount(resource: any) {
  if (resource?.resourceType !== "account") return false;
  const type = String(resource.typeValue ?? resource.raw?.type?.value ?? "").toUpperCase();
  const subtype = String(resource.subtypeValue ?? resource.raw?.subtype?.value ?? "").toUpperCase();
  return (
    type === "BANK" ||
    type === "CREDIT_CARD" ||
    subtype === "CASH_AND_BANK" ||
    subtype === "CREDIT_CARD" ||
    subtype === "MONEY_IN_TRANSIT" ||
    subtype === "TRANSFERS"
  );
}

function isWaveCategoryAccount(resource: any) {
  return resource?.resourceType === "account" && !isWaveTransactionAccount(resource);
}

function waveResourceBadgeLabel(resource: any) {
  if (resource?.resourceType === "account") return isWaveTransactionAccount(resource) ? "Transaction account" : "Category account";
  return waveTypeLabel(resource?.resourceType);
}

function waveResourceSingularLabel(resource: any) {
  if (resource?.resourceType === "account") return isWaveTransactionAccount(resource) ? "transaction account" : "category account";
  return waveSingularTypeLabel(resource?.resourceType);
}

function waveSingularTypeLabel(type: string) {
  const labels: Record<string, string> = {
    vendor: "vendor",
    customer: "customer",
    account: "account",
    product: "product",
    invoice: "invoice",
    estimate: "estimate",
    salesTax: "sales tax",
    business: "business",
    availableBusiness: "available business",
  };
  return labels[type] ?? type;
}

function capitalize(value: string) {
  return value ? `${value[0].toUpperCase()}${value.slice(1)}` : value;
}

function waveResourceDetailFields(resource: any, raw: any) {
  const currencyCode = raw?.currency?.code ?? resource.currencyCode;
  const balance = raw?.balance ?? resource.amountValue;
  const businessBalance = raw?.balanceInBusinessCurrency;
  const displayId = raw?.displayId ?? raw?.invoiceNumber ?? raw?.estimateNumber;
  const fields = [
    { label: "Resource", value: waveResourceBadgeLabel(resource) },
    { label: "Type", value: detailPair(raw?.type?.name, raw?.type?.value ?? resource.typeValue) },
    { label: "Subtype", value: detailPair(raw?.subtype?.name, raw?.subtype?.value ?? resource.subtypeValue) },
    { label: "Status", value: detailValue(resource.status) },
    { label: "Currency", value: detailPair(raw?.currency?.name, currencyCode) },
    { label: "Balance", value: balance == null ? undefined : formatWaveValue(String(balance), currencyCode) },
    isWaveCounterpartyResource(resource) && Number(resource.linkedTransactionCount ?? 0) > 0
      ? { label: "Linked activity", value: `${money(Number(resource.linkedTransactionTotalCents ?? 0))} · ${resource.linkedTransactionCount} txn${resource.linkedTransactionCount === 1 ? "" : "s"}` }
      : undefined,
    isWaveCategoryAccount(resource) && Number(resource.linkedCategoryTransactionCount ?? 0) > 0
      ? { label: "Categorized activity", value: `${money(Number(resource.linkedCategoryTransactionTotalCents ?? 0))} · ${resource.linkedCategoryTransactionCount} txn${resource.linkedCategoryTransactionCount === 1 ? "" : "s"}` }
      : undefined,
    {
      label: "Business balance",
      value: businessBalance == null ? undefined : formatWaveValue(String(businessBalance), currencyCode),
    },
    { label: "Normal balance", value: detailValue(raw?.normalBalanceType) },
    { label: "Display ID", value: detailValue(displayId), mono: true },
    { label: "Archived", value: typeof raw?.isArchived === "boolean" ? detailValue(raw.isArchived) : undefined },
  ];
  return fields.filter((field): field is NonNullable<typeof field> => Boolean(field && field.value != null && field.value !== ""));
}

function detailPair(label: unknown, value: unknown) {
  return [detailValue(label), detailValue(value)].filter(Boolean).join(" · ") || undefined;
}

function detailValue(value: unknown) {
  if (value == null || value === "") return undefined;
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}

function isZeroWaveAmount(value?: string) {
  if (value == null || value === "") return false;
  return Number(value) === 0;
}

function isBrowserBackedWaveConnection(connection: any) {
  return (
    connection?.provider === "wave" &&
    (connection?.syncMode === "browser" || /wave browser/i.test(connection?.accountLabel ?? ""))
  );
}

function formatWaveValue(value?: string, currencyCode?: string) {
  if (value == null || value === "") return "—";
  const amount = Number(value);
  if (!Number.isFinite(amount)) return value;
  if (!currencyCode) return amount.toLocaleString("en-CA");
  return new Intl.NumberFormat("en-CA", { style: "currency", currency: currencyCode }).format(amount);
}
