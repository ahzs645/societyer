import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import { useSociety } from "../hooks/useSociety";
import { useCurrentUserId } from "../hooks/useCurrentUser";
import { PageHeader, PageLoading, SeedPrompt } from "./_helpers";
import { Badge, Drawer, Field, Flag } from "../components/ui";
import { MoreActionsMenu } from "../components/MoreActionsMenu";
import { MarkdownEditor } from "../components/MarkdownEditor";
import { DatePicker } from "../components/DatePicker";
import { Select } from "../components/Select";
import { formatDateTime, money } from "../lib/format";
import { isDemoMode } from "../lib/demoMode";
import { parseBankCsv, type ParsedCsvRow } from "../lib/bankCsv";
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
import { YearOverYearFinancialsCard } from "../features/financials/components/YearOverYearFinancialsCard";
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
import { RecordTableMetadataEmpty } from "../components/RecordTableMetadataEmpty";
import {
  RecordTable,
  RecordTableScope,
  RecordTableViewToolbar,
  RecordTableFilterChips,
  RecordTableFilterPopover,
  useObjectRecordTableData,
} from "@/modules/object-record";
import type { Id } from "../../convex/_generated/dataModel";

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
  const trialBalance = useQuery(
    api.accounting.trialBalance,
    society ? { societyId: society._id } : "skip",
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
  const inventoryItems = useQuery(api.inventoryHub.items, society ? { societyId: society._id } : "skip");
  const inventoryLinks = useQuery(api.inventoryHub.receiptLinks, society ? { societyId: society._id } : "skip");
  const linkInventoryReceipt = useMutation(api.inventoryHub.linkReceipt);
  const unlinkInventoryReceipt = useMutation(api.inventoryHub.unlinkReceipt);
  const [linkTxn, setLinkTxn] = useState<any>(null);
  const [linkItemId, setLinkItemId] = useState("");
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
  const [currentViewId, setCurrentViewId] = useState<Id<"views"> | undefined>(undefined);
  const [filterOpen, setFilterOpen] = useState(false);
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
  const linksByTransactionId = useMemo(() => {
    const map = new Map<string, any[]>();
    for (const link of (inventoryLinks ?? []) as any[]) {
      if (!link.financialTransactionId) continue;
      const rows = map.get(link.financialTransactionId) ?? [];
      rows.push(link);
      map.set(link.financialTransactionId, rows);
    }
    return map;
  }, [inventoryLinks]);
  const tableData = useObjectRecordTableData({
    societyId: society?._id,
    nameSingular: "financialTransaction",
    viewId: currentViewId,
  });
  const showMetadataWarning = !tableData.loading && !tableData.objectMetadata;
  const records = useMemo(
    () => (transactions ?? []).map((t: any) => ({
      ...t,
      account: (accounts ?? []).find((a) => a._id === t.accountId)?.name ?? "",
      items: linksByTransactionId.get(t._id)?.length ?? 0,
    })),
    [transactions, accounts, linksByTransactionId],
  );
  const saveInventoryLink = async () => {
    if (!linkTxn || !linkItemId) {
      toast.error("Choose an inventory item to link.");
      return;
    }
    await linkInventoryReceipt({
      societyId: society!._id,
      inventoryItemId: linkItemId as any,
      financialTransactionId: linkTxn._id,
      createdByUserId: actingUserId as any,
    } as any);
    toast.success("Inventory item linked to transaction");
    setLinkTxn(null);
    setLinkItemId("");
  };
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
  const ledgerRevenueCents = (trialBalance ?? [])
    .filter((row: any) => row.account?.accountType === "Income")
    .reduce((sum: number, row: any) => sum + row.creditCents - row.debitCents, 0);
  const ledgerExpenseCents = (trialBalance ?? [])
    .filter((row: any) => row.account?.accountType === "Expense")
    .reduce((sum: number, row: any) => sum + row.debitCents - row.creditCents, 0);
  const ledgerAssetCents = (trialBalance ?? [])
    .filter((row: any) => ["Asset", "Bank", "Credit"].includes(row.account?.accountType))
    .reduce((sum: number, row: any) => sum + row.balanceCents, 0);
  const ledgerRestrictedCents = (trialBalance ?? [])
    .filter((row: any) => row.account?.isRestricted)
    .reduce((sum: number, row: any) => sum + Math.abs(row.balanceCents), 0);

  if (society === undefined) return <PageLoading />;
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
              <MoreActionsMenu
                items={[
                  { id: "accounting", label: "Accounting", icon: <PiggyBank size={14} />, onSelect: () => navigate("/app/financials/accounting") },
                  {
                    id: "sync",
                    label: "Sync",
                    icon: <RefreshCw size={14} />,
                    disabled: busy,
                    onSelect: async () => {
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
                    },
                  },
                  { id: "cache", label: "Cache", icon: <Database size={14} />, disabled: busy, onSelect: refreshWaveCache },
                  { id: "check", label: "Check", icon: <ShieldCheck size={14} />, disabled: busy || waveHealthBusy, onSelect: runWaveHealthCheck },
                  {
                    id: "disconnect",
                    label: "Disconnect",
                    destructive: true,
                    onSelect: async () => {
                      await disconnect({ connectionId: activeConnection._id, actingUserId });
                      toast.info("Disconnected Wave");
                    },
                  },
                ]}
              />
            </>
          ) : (
            <>
              <MoreActionsMenu
                items={[
                  { id: "accounting", label: "Accounting", icon: <PiggyBank size={14} />, onSelect: () => navigate("/app/financials/accounting") },
                  { id: "check", label: "Check", icon: <ShieldCheck size={14} />, disabled: busy || waveHealthBusy, onSelect: runWaveHealthCheck },
                ]}
              />
              <button
                className="btn-action btn-action--primary"
                disabled={busy || !canConnectWave}
                onClick={connect}
                title={!canConnectWave ? "Configure Wave credentials before connecting this workspace." : undefined}
              >
                <Link2 size={12} /> Connect Wave
              </button>
            </>
          )
        }
      />

      {(accounts ?? []).length > 0 && (
        <BankCsvImportCard
          societyId={society._id}
          accounts={accounts ?? []}
          actingUserId={actingUserId}
        />
      )}

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
              setupHref="/app/browser-connectors?connector=wave"
              busy={busy}
            />
            <ProviderCard name="QuickBooks" desc="Coming soon — OAuth flow planned." status="planned" />
            <ProviderCard name="Xero" desc="Coming soon — for multi-currency orgs." status="planned" />
          </div>
        </div>
      )}

      {waveHealth && <WaveHealthPanel result={waveHealth} />}

      {(trialBalance ?? []).length > 0 && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card__head">
            <h2 className="card__title">Internal ledger summary</h2>
            <span className="card__subtitle">Posted journal lines take priority for board and auditor reporting.</span>
          </div>
          <div className="stat-grid stat-grid--3" style={{ margin: "0 16px 16px" }}>
            <Stat label="Ledger revenue" value={money(ledgerRevenueCents)} />
            <Stat label="Ledger expenses" value={money(ledgerExpenseCents)} />
            <Stat label="Ledger net" value={money(ledgerRevenueCents - ledgerExpenseCents)} tone={ledgerRevenueCents - ledgerExpenseCents < 0 ? "danger" : "ok"} />
          </div>
          <div className="stat-grid stat-grid--3" style={{ margin: "0 16px 16px" }}>
            <Stat label="Ledger assets" value={money(ledgerAssetCents)} />
            <Stat label="Restricted ledger" value={money(ledgerRestrictedCents)} />
            <Stat label="Trial balance lines" value={String(trialBalance.length)} />
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
        showMetadataWarning ? (
          <div style={{ marginBottom: 16 }}>
            <RecordTableMetadataEmpty societyId={society?._id} objectLabel="financial transaction" />
          </div>
        ) : tableData.objectMetadata ? (
          <div style={{ marginBottom: 16 }}>
            <RecordTableScope
              tableId="financialTransactions"
              objectMetadata={tableData.objectMetadata}
              hydratedView={tableData.hydratedView}
              records={records}
            >
              <RecordTableViewToolbar
                societyId={society._id}
                objectMetadataId={tableData.objectMetadata._id as Id<"objectMetadata">}
                icon={<PiggyBank size={14} />}
                label="Recent transactions"
                views={tableData.views}
                currentViewId={currentViewId ?? tableData.views[0]?._id ?? null}
                onChangeView={(viewId) => setCurrentViewId(viewId as Id<"views">)}
                onOpenFilter={() => setFilterOpen((x) => !x)}
              />
              <RecordTableFilterPopover open={filterOpen} onClose={() => setFilterOpen(false)} />
              <RecordTableFilterChips />
              <RecordTable
                loading={tableData.loading || transactions === undefined}
                renderCell={({ record: t, field }) => {
                  if (field.name === "date") return <span className="mono">{t.date}</span>;
                  if (field.name === "account") return <span className="muted">{t.account || "—"}</span>;
                  if (field.name === "category") return <Badge>{t.category ?? "uncategorized"}</Badge>;
                  if (field.name === "amountCents") return <span className="mono" style={{ color: t.amountCents < 0 ? "var(--danger)" : "var(--success)" }}>{money(t.amountCents)}</span>;
                  if (field.name === "items") {
                    const links = linksByTransactionId.get(t._id) ?? [];
                    return (
                      <div className="row" style={{ gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                        {links.map((link: any) => (
                          <span key={link._id} className="row" style={{ gap: 4, alignItems: "center" }}>
                            <Link to="/app/inventory" onClick={(e) => e.stopPropagation()}>{link.inventoryItem?.name ?? link.asset?.name ?? link.receiptLineLabel ?? "Linked item"}</Link>
                            <button
                              className="btn btn--ghost btn--sm btn--icon"
                              aria-label="Unlink item"
                              onClick={async (e) => { e.stopPropagation(); await unlinkInventoryReceipt({ id: link._id }); toast.success("Item unlinked"); }}
                            >
                              <Trash2 size={12} />
                            </button>
                          </span>
                        ))}
                        <button className="btn btn--ghost btn--sm" onClick={(e) => { e.stopPropagation(); setLinkTxn(t); setLinkItemId(""); }}>
                          <Link2 size={12} /> Link item
                        </button>
                      </div>
                    );
                  }
                  return undefined;
                }}
              />
            </RecordTableScope>
          </div>
        ) : null
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

      <YearOverYearFinancialsCard rows={sorted} onOpenFinancialYear={openFinancialYear} />

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
              <DatePicker
                value={subscriptionForm.nextRenewalDate ?? ""}
                onChange={(value) => setSubscriptionForm({ ...subscriptionForm, nextRenewalDate: value })}
              />
            </Field>
            <Field label="Notes">
              <MarkdownEditor
                rows={4}
                value={subscriptionForm.notes ?? ""}
                onChange={(markdown) => setSubscriptionForm({ ...subscriptionForm, notes: markdown })}
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

      <Drawer
        open={Boolean(linkTxn)}
        onClose={() => setLinkTxn(null)}
        title="Link inventory item"
        footer={<button className="btn btn--accent" onClick={saveInventoryLink}>Link item</button>}
      >
        {linkTxn && (
          <div className="form-grid">
            <Field label="Transaction">
              <input className="input" readOnly value={`${linkTxn.date} · ${linkTxn.description} · ${money(linkTxn.amountCents)}`} />
            </Field>
            <Field label="Inventory item" hint="Back-link an item from inventory to this purchase.">
              <Select
                value={linkItemId}
                onChange={setLinkItemId}
                placeholder="Choose an item"
                searchable
                options={((inventoryItems ?? []) as any[]).map((item) => ({ value: item._id, label: item.sku ? `${item.name} (${item.sku})` : item.name }))}
              />
            </Field>
            <p className="muted">
              Need a new item first? <Link to="/app/inventory">Open inventory →</Link>
            </p>
          </div>
        )}
      </Drawer>
    </div>
  );
}

function BankCsvImportCard({
  societyId,
  accounts,
  actingUserId,
}: {
  societyId: any;
  accounts: any[];
  actingUserId: any;
}) {
  const importCsv = useMutation(api.financialHub.importBankCsvTransactions);
  const toast = useToast();
  const [accountId, setAccountId] = useState("");
  const [parsed, setParsed] = useState<ParsedCsvRow[] | null>(null);
  const [busy, setBusy] = useState(false);

  const onFile = async (file: File) => {
    try {
      const rows = parseBankCsv(await file.text());
      setParsed(rows);
      if (rows.length === 0) {
        toast.warn("No rows parsed — the CSV needs date, description, and amount (or debit/credit) columns.");
      }
    } catch (err: any) {
      setParsed(null);
      toast.error(err?.message ?? "Could not parse CSV");
    }
  };

  const doImport = async () => {
    if (!accountId) {
      toast.info("Choose an account to import into.");
      return;
    }
    if (!parsed?.length) {
      toast.info("Choose a CSV file first.");
      return;
    }
    setBusy(true);
    try {
      const result = await importCsv({ societyId, accountId: accountId as any, rows: parsed, actingUserId });
      toast.success(
        `Imported ${result.inserted} transaction${result.inserted === 1 ? "" : "s"}${
          result.skipped ? `, skipped ${result.skipped} duplicate${result.skipped === 1 ? "" : "s"}` : ""
        }.`,
      );
      setParsed(null);
    } catch (err: any) {
      toast.error(err?.message ?? "Import failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="card__head">
        <h2 className="card__title">Import bank / credit-card CSV</h2>
        <span className="card__subtitle">
          Get real statement history in (Wave's API can't export ledger rows). Deduped per account.
        </span>
      </div>
      <div className="card__body row" style={{ gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <Select
          value={accountId}
          onChange={setAccountId}
          options={[
            { value: "", label: "Choose account…" },
            ...accounts.map((a: any) => ({ value: a._id, label: a.name })),
          ]}
          className="input"
          style={{ flex: "1 1 200px", minWidth: 0 }}
        />
        <input
          type="file"
          accept=".csv,text/csv"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void onFile(file);
          }}
        />
        {parsed && <span className="muted">{parsed.length} row{parsed.length === 1 ? "" : "s"} ready</span>}
        <button className="btn btn--accent" disabled={busy || !accountId || !parsed?.length} onClick={doImport}>
          Import
        </button>
      </div>
    </div>
  );
}
