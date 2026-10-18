import { useFinancePermissions } from "@/hooks/useFinancePermissions";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import { useSociety } from "../hooks/useSociety";
import { useCurrentUserId } from "../hooks/useCurrentUser";
import { PageHeader, PageLoading, SeedPrompt } from "./_helpers";
import { ImportCandidatesNotice } from "../components/ImportCandidatesNotice";
import { Badge, Drawer, EmptyState, Field, Flag } from "../components/ui";
import { MoreActionsMenu } from "../components/MoreActionsMenu";
import { MarkdownEditor } from "../components/MarkdownEditor";
import { DatePicker } from "../components/DatePicker";
import { Select } from "../components/Select";
import { formatDate, formatDateTime, formatShortDate } from "../lib/format";
import { organizationTodayISO } from "../lib/dateRanges";
import { budgetVariance, formatMoney } from "../lib/money";
import { Money } from "../components/Money";
import { useUrlTab } from "../hooks/useUrlTab";
import { VarianceCell, VARIANCE_HELP } from "../features/financials/components/VarianceCell";
import { inferBudgetKind } from "../features/financials/lib/budgetKind";
import { isDemoMode } from "../lib/demoMode";
import { parseBankCsv, type ParsedCsvRow } from "../lib/bankCsv";
import { CategorizationProvenance, TransactionRulesBar } from "../features/financials/rules";
import { RuleDrawerProvider } from "../features/financials/transactions/RuleDrawerHost";
import { TransactionsBulkBar } from "../features/financials/transactions/TransactionsBulkBar";
import { useTransactionsSurface } from "../features/financials/transactions/useTransactionsSurface";
import { Database, FileUp, Link2, MoreHorizontal, Pencil, PiggyBank, PlusCircle, RefreshCw, ShieldCheck, Table2, Trash2 } from "lucide-react";
import { Menu } from "../components/Menu";
import { InfoPopover } from "../components/InfoPopover";
import { Tabs } from "../components/primitives";
import { useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useToast } from "../components/Toast";
import { appliesBcSocietyRules } from "../../shared/entityRuleScope";
import { useConfirm } from "../components/Modal";
import { hasErrors, validateBudgetLineInput, type FieldErrors } from "../../shared/recordValidation";
import {
  WaveHealthPanel,
  redactWaveHealthResult,
} from "../features/financials/components/WaveHealthPanel";
import { WaveCacheExplorer } from "../features/financials/components/WaveCacheExplorer";
import { OperatingSubscriptionsCard, ProviderCard } from "../features/financials/components/FinancialDashboardCards";
import { StatTile } from "../components/StatTile";
import { InvestedReservesTile, useInvestedReserves } from "../features/businessRegisters/InvestedReserves";
import { MobileFold } from "../components/MobileFold";
import { SortableTh } from "../components/SortableTh";
import { useSortableRows } from "../hooks/useSortableRows";
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
} from "@/platform/record-engine";
import type { Id } from "../../convex/_generated/dataModel";
import { openGlobalAssetCreate } from "@/features/assets/GlobalAssetCreate";
import { assetCategoryFromTransaction, isAssetPurchaseTransaction } from "../features/assets/assetUtils";
import { FinancialInsightsLazy } from "../features/financials/insights/lazy";
import type { FinanceMoreMetrics } from "../features/financials/insights/FinancialInsights";
import { TransactionLinkFilters } from "../features/financials/insights/TransactionLinkFilters";
import { useIsMobile } from "../lib/useIsMobile";
import { BudgetGridDrawer } from "../features/financials/components/BudgetGridDrawer";

const FINANCIALS_TABS = ["overview", "transactions", "wave", "subscriptions"] as const;

export function FinancialsPage() {
  const { canWrite, canEditSettings, canManageIntegration } = useFinancePermissions();
  const society = useSociety();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
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
    society ? { societyId: society._id, limit: 1000 } : "skip",
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
  const assets = useQuery(api.assets.list, society ? { societyId: society._id } : "skip");
  const linkInventoryReceipt = useMutation(api.inventoryHub.linkReceipt);
  const unlinkInventoryReceipt = useMutation(api.inventoryHub.unlinkReceipt);
  const updateAsset = useMutation(api.assets.update);
  const [linkTxn, setLinkTxn] = useState<any>(null);
  const [linkTargetType, setLinkTargetType] = useState<"asset" | "inventory">("asset");
  const [linkAssetId, setLinkAssetId] = useState("");
  const [linkItemId, setLinkItemId] = useState("");
  const actingUserId = useCurrentUserId() ?? undefined;
  const toast = useToast();
  const confirm = useConfirm();
  const [busy, setBusy] = useState(false);
  const [waveHealthBusy, setWaveHealthBusy] = useState(false);
  const [waveHealth, setWaveHealth] = useState<any>(null);
  const [budgetForm, setBudgetForm] = useState<{ id?: string; category: string; planned: string } | null>(null);
  const [budgetErrors, setBudgetErrors] = useState<FieldErrors>({});
  const [budgetGridOpen, setBudgetGridOpen] = useState(false);
  const [subscriptionForm, setSubscriptionForm] = useState<any>(null);
  const [waveMode, setWaveMode] = useState<"resources" | "structures">("resources");
  const [waveResourceType, setWaveResourceType] = useState("account");
  const [waveAccountView, setWaveAccountView] = useState<WaveAccountView>("transaction");
  const [waveSearch, setWaveSearch] = useState("");
  const [selectedWaveResourceId, setSelectedWaveResourceId] = useState<string | null>(null);
  const [hideZeroWaveAccounts, setHideZeroWaveAccounts] = useState(false);
  const [currentViewId, setCurrentViewId] = useState<Id<"views"> | undefined>(undefined);
  const [filterOpen, setFilterOpen] = useState(false);
  const [tab, setTab] = useUrlTab(FINANCIALS_TABS, "overview");
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
  // Budget lines follow the fiscal year the hub reports on (the current one).
  const budgetFiscalYear: string = hub?.budgetFiscalYear ?? fiscalYear;
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
  const assetsByTransactionId = useMemo(() => {
    const map = new Map<string, any[]>();
    for (const asset of (assets ?? []) as any[]) {
      if (!asset.purchaseTransactionId) continue;
      const rows = map.get(String(asset.purchaseTransactionId)) ?? [];
      rows.push(asset);
      map.set(String(asset.purchaseTransactionId), rows);
    }
    return map;
  }, [assets]);
  const tableData = useObjectRecordTableData({
    societyId: society?._id,
    nameSingular: "financialTransaction",
    viewId: currentViewId,
  });
  const showMetadataWarning = !tableData.loading && !tableData.objectMetadata;
  // On phones only the frozen description and one more column fit, so the
  // amount moves up beside the description instead of sitting off-screen.
  const isMobile = useIsMobile();
  const financialHydratedView = useMemo(() => {
    if (!tableData.hydratedView) return null;
    let columns = tableData.hydratedView.columns.map((column) => column.field.name === "items" ? {
      ...column,
      field: { ...column.field, label: "Purchase links" },
    } : column);
    if (isMobile) {
      const ordered = [...columns].sort((a, b) => a.position - b.position);
      const amount = ordered.find((column) => column.field.name === "amountCents");
      if (amount && ordered.length > 2) {
        const rest = ordered.filter((column) => column !== amount);
        columns = [rest[0], amount, ...rest.slice(1)].map((column, position) => ({ ...column, position }));
      }
    }
    return { ...tableData.hydratedView, columns };
  }, [isMobile, tableData.hydratedView]);
  const focusedTransactionId = searchParams.get("transaction");
  const focusedTransaction = (transactions ?? []).find((row: any) => String(row._id) === focusedTransactionId);
  // Detail panel, bulk island, in-place rule editor, rule prompt and payee names.
  const txnSurface = useTransactionsSurface({ societyId: society?._id, canWrite, transactions });
  const { decorate: decorateTransactions } = txnSurface;
  const records = useMemo(
    () => decorateTransactions((transactions ?? []).filter((t: any) => !focusedTransactionId || String(t._id) === focusedTransactionId).map((t: any) => ({
      ...t,
      account: (accounts ?? []).find((a) => a._id === t.accountId)?.name ?? "",
      items: new Set([
        ...(linksByTransactionId.get(t._id) ?? []).map((link: any) => String(link.assetId ?? link.inventoryItemId ?? link._id)),
        ...(assetsByTransactionId.get(t._id) ?? []).map((asset: any) => String(asset._id)),
      ]).size,
    }))),
    [transactions, accounts, linksByTransactionId, assetsByTransactionId, focusedTransactionId, decorateTransactions],
  );
  const { renderSidePanel: renderTransactionSidePanel } = txnSurface;
  const renderTransactionPanel = useMemo(() => renderTransactionSidePanel(records as any[]), [renderTransactionSidePanel, records]);
  const closePurchaseLink = () => {
    setLinkTxn(null);
    setLinkAssetId("");
    setLinkItemId("");
    setLinkTargetType("asset");
  };
  const savePurchaseLink = async () => {
    if (!linkTxn) return;
    if (linkTargetType === "asset") {
      const asset = (assets ?? []).find((row: any) => String(row._id) === linkAssetId) as any;
      if (!asset) {
        toast.error("Choose an asset to link.");
        return;
      }
      await updateAsset({
        id: asset._id,
        patch: {
          purchaseTransactionId: linkTxn._id,
          ...(!asset.purchaseDate ? { purchaseDate: linkTxn.date } : {}),
          ...(asset.purchaseValueCents == null ? { purchaseValueCents: Math.abs(linkTxn.amountCents) } : {}),
          ...(!asset.supplier && linkTxn.counterparty ? { supplier: linkTxn.counterparty } : {}),
        },
      } as any);
      toast.success("Accounting purchase linked to asset", asset.name);
      closePurchaseLink();
      return;
    }
    if (!linkItemId) {
      toast.error("Choose an inventory item to link.");
      return;
    }
    await linkInventoryReceipt({
      societyId: society!._id,
      inventoryItemId: linkItemId as any,
      financialTransactionId: linkTxn._id,
      createdByUserId: actingUserId as any,
    } as any);
    toast.success("Accounting purchase linked to inventory item");
    closePurchaseLink();
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
  const budgetRows = (hub?.budgetRows ?? []) as any[];
  const budgetSort = useSortableRows(budgetRows, {
    category: (b: any) => b.category,
    planned: (b: any) => b.plannedCents,
    actual: (b: any) => b.actualCents,
    variance: (b: any) => budgetVariance(b.plannedCents, b.actualCents, inferBudgetKind(b, { accounts: accounts ?? [], transactions: transactions ?? [] })).cents,
  });
  const restrictedSort = useSortableRows(hub?.restrictedAccounts as Array<{ name: string; purpose?: string; balanceCents: number }> | undefined, {
    fund: (a) => a.name,
    purpose: (a) => a.purpose,
    balance: (a) => a.balanceCents,
  });
  const ledgerRevenueCents = (trialBalance ?? [])
    .filter((row: any) => row.account?.accountType === "Income")
    .reduce((sum: number, row: any) => sum + row.creditCents - row.debitCents, 0);
  const ledgerExpenseCents = (trialBalance ?? [])
    .filter((row: any) => row.account?.accountType === "Expense")
    .reduce((sum: number, row: any) => sum + row.debitCents - row.creditCents, 0);
  const ledgerAssetCents = (trialBalance ?? [])
    .filter((row: any) => ["Asset", "Bank", "Credit"].includes(row.account?.accountType))
    .reduce((sum: number, row: any) => sum + row.balanceCents, 0);
  const investedReserves = useInvestedReserves(society?._id);

  if (society === undefined) return <PageLoading />;
  if (society === null) return <SeedPrompt />;
  const todayISO = organizationTodayISO(society);

  // Overview summary figures. Desktop shows them in one card; phones put them
  // in the trends' "More metrics" fold, where the bank balance is already a
  // headline tile.
  const ledgerNetCents = ledgerRevenueCents - ledgerExpenseCents;
  const ledgerTiles = (trialBalance ?? []).length > 0 ? [
    <StatTile key="ledger-revenue" label="Ledger revenue" value={<Money variant="hero" trimWholeCents cents={ledgerRevenueCents} />} />,
    <StatTile key="ledger-expenses" label="Ledger expenses" value={<Money variant="hero" trimWholeCents cents={ledgerExpenseCents} />} />,
    <StatTile key="ledger-net" label="Ledger net" value={<Money variant="hero" trimWholeCents cents={ledgerNetCents} />} tone={ledgerNetCents < 0 ? "danger" : "neutral"} />,
    // Ledger assets only earn a tile when they differ from the bank balance beside them.
    ...(activeConnection && hub && hub.totalBalance === ledgerAssetCents
      ? []
      : [<StatTile key="ledger-assets" label="Ledger assets" value={<Money variant="hero" trimWholeCents cents={ledgerAssetCents} />} />]),
  ] : [];
  const bankBalanceTile = activeConnection && hub
    ? <StatTile label="Bank balance" value={<Money variant="hero" trimWholeCents cents={hub.totalBalance} />} />
    : null;
  const bankTiles = activeConnection && hub ? [
    <StatTile key="unrestricted" label="Unrestricted" value={<Money variant="hero" trimWholeCents cents={hub.unrestricted} />} tone={hub.unrestricted < 0 ? "danger" : "neutral"} />,
    <StatTile key="restricted" label="Restricted funds" value={<Money variant="hero" trimWholeCents cents={hub.totalBalance - hub.unrestricted} />} />,
  ] : [];
  const lastSynced = activeConnection?.lastSyncAtISO ? `Last synced ${formatDateTime(activeConnection.lastSyncAtISO)}` : null;
  const hasInvestedReserves = Boolean(investedReserves && investedReserves.activeCount > 0);
  const mobileMoreMetrics: FinanceMoreMetrics | undefined = isMobile
    ? {
        tiles: <>{ledgerTiles}{bankTiles}<InvestedReservesTile societyId={society._id} /></>,
        count: ledgerTiles.length + bankTiles.length + (hasInvestedReserves ? 1 : 0),
        note: lastSynced ? `Bank figures: ${lastSynced.charAt(0).toLowerCase()}${lastSynced.slice(1)}.` : undefined,
      }
    : undefined;
  const budgetPlannedCents = budgetRows.reduce((sum: number, b: any) => sum + (b.plannedCents ?? 0), 0);
  const budgetActualCents = budgetRows.reduce((sum: number, b: any) => sum + (b.actualCents ?? 0), 0);

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
    setTab("wave");
    try {
      const result = redactWaveHealthResult(await checkWaveHealth({
        societyId: society._id,
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
        subtitle="Bank balances, budgets, restricted funds and year-end statements."
        info={
          <>
            <p>
              Ledger figures come from the posted accounting ledger (accrual basis) and are the authoritative total once
              transactions are reconciled. The <Link to="/app/treasurer">Treasurer</Link> dashboard shows the
              bank-transaction view, which can be provisional before reconciliation.
            </p>
            <p>
              Year-over-year figures come from each year's recorded financial statements, so they may differ from the
              ledger if a statement predates recent postings.
            </p>
            {/* The s.36 remuneration disclosure is a Societies Act duty; other entities do not see it. */}
            {appliesBcSocietyRules(society) && <p>Societies must disclose remuneration of $75,000 or more in the AGM financial statements (s.36).</p>}
          </>
        }
        actions={
          activeConnection ? (
            <>
              <span title={`Connected to ${providerLabel(activeConnection.provider)}`}>
                <Badge tone="success">{providerLabel(activeConnection.provider)}</Badge>
              </span>
              <MoreActionsMenu
                items={[
                  { id: "accounting", label: "Accounting", icon: <PiggyBank size={14} />, onSelect: () => navigate("/app/financials/accounting") },
                  {
                    id: "sync",
                    label: "Sync",
                    icon: <RefreshCw size={14} />,
                    disabled: !canWrite || (busy),
                    onSelect: async () => {
                      setBusy(true);
                      try {
                        const result = await sync({ connectionId: activeConnection._id });
                        if (!result) {
                          if (isDemoMode() && activeConnection.demo === true) toast.info("Demo bookkeeping data is already loaded. Live sync requires configured Wave credentials.");
                          else toast.warn("The bookkeeping source returned no sync result. Check the connection before trying again.");
                          return;
                        }
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
                  { id: "cache", label: "Cache", icon: <Database size={14} />, disabled: !canEditSettings || (busy), onSelect: refreshWaveCache },
                  { id: "check", label: "Check", icon: <ShieldCheck size={14} />, disabled: !canEditSettings || (busy || waveHealthBusy), onSelect: runWaveHealthCheck },
                  { disabled: !canManageIntegration,
                    id: "disconnect",
                    label: "Disconnect",
                    destructive: true,
                    onSelect: async () => {
                      await disconnect({ connectionId: activeConnection._id });
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
                  { id: "check", label: "Check", icon: <ShieldCheck size={14} />, disabled: !canEditSettings || (busy || waveHealthBusy), onSelect: runWaveHealthCheck },
                ]}
              />
              <button
                className="btn-action btn-action--primary"
                disabled={!canManageIntegration || (busy || !canConnectWave)}
                onClick={connect}
                title={!canConnectWave ? "Configure Wave credentials before connecting this workspace." : undefined}
              >
                <Link2 size={12} /> Connect Wave
              </button>
            </>
          )
        }
      />
      <ImportCandidatesNotice noun="financial statement" targets={["financials", "financialStatements", "financialStatementImports"]} kinds={["financialStatement", "financialStatementImport", "budgetSnapshot", "treasurerReport"]} documentCategory="FinancialStatement" emptyRegister={!(items ?? []).length} also={{ to: "/app/finance-imports", label: "Imported statements and budget snapshots awaiting verification are in Finance imports" }} />

      <div className="financials-tabs">
        <Tabs<typeof tab>
          value={tab}
          onChange={setTab}
          ariaLabel="Financials sections"
          items={[
            { id: "overview", label: "Overview" },
            { id: "transactions", label: "Transactions" },
            { id: "wave", label: "Wave data" },
            { id: "subscriptions", label: "Subscriptions" },
          ]}
        />
      </div>

      {tab === "transactions" && <TransactionRulesBar societyId={society._id} />}

      {tab === "transactions" && (accounts ?? []).length > 0 && (
        <BankCsvImportCard
          societyId={society._id}
          accounts={accounts ?? []}
        />
      )}

      {tab === "overview" && !activeConnection && (
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

      {tab === "wave" && waveHealth && <WaveHealthPanel result={waveHealth} />}

      {/* Phones show these figures in the trends' "More metrics" fold instead (bank balance as a headline tile). */}
      {tab === "overview" && !isMobile && (ledgerTiles.length > 0 || bankTiles.length > 0) && (
        <div className="card financials-summary-card" style={{ marginBottom: 16 }}>
          <div className="card__head">
            <h2 className="card__title">{ledgerTiles.length > 0 ? "Internal ledger summary" : "Bank summary"}</h2>
            {lastSynced && <span className="card__subtitle">{lastSynced}</span>}
          </div>
          <div className="stat-grid financials-summary-card__stats">
            {ledgerTiles}
            {bankBalanceTile}
            {bankTiles}
            <InvestedReservesTile societyId={society._id} />
          </div>
        </div>
      )}

      {tab === "overview" && <FinancialInsightsLazy society={society} moreMetrics={mobileMoreMetrics} hideBudgetChart={isMobile && Boolean(activeConnection)} />}

      {tab === "wave" && activeConnection && (
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

      {tab === "wave" && !activeConnection && (
        <div className="card financials-empty-card">
          <EmptyState
            icon={<Database size={18} />}
            title="No bookkeeping source connected"
            description="Connect Wave to browse synced accounts, vendors and transactions here."
            action={<button className="btn-action" onClick={() => setTab("overview")}>Connect from Overview</button>}
          />
        </div>
      )}

      {tab === "subscriptions" && (
        <OperatingSubscriptionsCard
          rows={operatingSubscriptions ?? []}
          loading={operatingSubscriptions === undefined}
          activeMonthlyCents={activeMonthlyCents}
          plannedMonthlyCents={plannedMonthlyCents}
          projectedMonthlyCents={projectedMonthlyCents}
          onNew={() => setSubscriptionForm(newOperatingSubscriptionForm())}
          onEdit={(row) => setSubscriptionForm(operatingSubscriptionFormFromRow(row))}
          onRemove={async (row) => {
            await removeOperatingSubscription({ id: row._id });
            toast.info("Subscription cost removed");
          }}
        />
      )}

      {tab === "overview" && activeConnection && hub && hub.restrictedAccounts.length > 0 && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card__head">
            <h2 className="card__title">Restricted funds</h2>
            <InfoPopover label="About restricted funds">
              <p>
                Bank accounts flagged as restricted. The fund-by-fund ledger balance is under{" "}
                <Link to="/app/financials/accounting">Accounting</Link>; the audited figure is in the year's statements.
              </p>
            </InfoPopover>
          </div>
          <div className="finance-table-wrap">
            <table className="table finance-table">
              <thead>
                <tr>
                  <SortableTh column="fund" sort={restrictedSort.sort} onSort={restrictedSort.toggle}>Fund</SortableTh>
                  <SortableTh column="purpose" sort={restrictedSort.sort} onSort={restrictedSort.toggle}>Purpose</SortableTh>
                  <SortableTh column="balance" sort={restrictedSort.sort} onSort={restrictedSort.toggle} className="num">Balance</SortableTh>
                </tr>
              </thead>
              <tbody>
                {restrictedSort.rows.map((a, i) => (
                  <tr key={i}>
                    <td>{a.name}</td>
                    <td className="muted">{a.purpose ?? "—"}</td>
                    <td className="num"><Money cents={a.balanceCents} /></td>
                  </tr>
                ))}
              </tbody>
              {hub.restrictedAccounts.length > 1 && (
                <tfoot>
                  <tr>
                    <th scope="row" colSpan={2}>Total restricted</th>
                    <td className="num"><Money cents={hub.restrictedAccounts.reduce((sum, a) => sum + (a.balanceCents ?? 0), 0)} /></td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>
      )}

      {tab === "overview" && activeConnection && (
        <MobileFold
          title={`Budget vs actuals — FY ${budgetFiscalYear}`}
          summary={budgetRows.length === 0
            ? "No budget lines yet"
            : `${formatMoney(Math.round(budgetActualCents / 100) * 100, { trimWholeCents: true })} of ${formatMoney(Math.round(budgetPlannedCents / 100) * 100, { trimWholeCents: true })} planned · ${budgetRows.length} ${budgetRows.length === 1 ? "line" : "lines"}`}
        >
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="card__head">
              <h2 className="card__title">Budget vs actuals — FY {budgetFiscalYear}</h2>
              <span className="card__subtitle">Plan a category, actuals come from synced transactions.</span>
              <div style={{ marginLeft: "auto", display: "flex", gap: 6, flexWrap: "wrap" }}>
                <button className="btn-action" onClick={() => setBudgetGridOpen(true)}>
                  <Table2 size={12} /> Edit as grid
                </button>
                <button
                  className="btn-action"
                  onClick={() => { setBudgetErrors({}); setBudgetForm({ category: "", planned: "" }); }} disabled={!canWrite}
                >
                  <PlusCircle size={12} /> Add budget line
                </button>
              </div>
            </div>
            <div className="finance-table-wrap">
            <table className="table finance-table">
              <thead>
                <tr>
                  <SortableTh column="category" sort={budgetSort.sort} onSort={budgetSort.toggle}>Category</SortableTh>
                  <SortableTh column="planned" sort={budgetSort.sort} onSort={budgetSort.toggle} className="num">Planned</SortableTh>
                  <SortableTh column="actual" sort={budgetSort.sort} onSort={budgetSort.toggle} className="num">Actual</SortableTh>
                  <SortableTh
                    column="variance"
                    sort={budgetSort.sort}
                    onSort={budgetSort.toggle}
                    className="num"
                    extra={<InfoPopover label="About variance">{VARIANCE_HELP}</InfoPopover>}
                  >
                    Variance
                  </SortableTh>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {budgetSort.rows.map((b: any) => {
                  const kind = inferBudgetKind(b, { accounts: accounts ?? [], transactions: transactions ?? [] });
                  return (
                    <tr key={b._id}>
                      <td>
                        {b.category}
                        {kind === "revenue" && <span className="finance-table__sub"> · revenue</span>}
                      </td>
                      <td className="num"><Money cents={b.plannedCents} /></td>
                      <td className="num"><Money cents={b.actualCents} /></td>
                      <td className="num">
                        <VarianceCell variance={budgetVariance(b.plannedCents, b.actualCents, kind)} />
                      </td>
                      <td className="num">
                        <Menu
                          align="right"
                          trigger={
                            <button
                              type="button"
                              className="btn btn--ghost btn--sm btn--icon"
                              aria-label={`Actions for budget ${b.category}`}
                              title="More actions"
                              disabled={!canWrite}
                            >
                              <MoreHorizontal size={14} />
                            </button>
                          }
                          sections={[
                            {
                              id: "budget-actions",
                              items: [
                                {
                                  id: "edit",
                                  label: "Edit planned amount",
                                  icon: <Pencil size={14} />,
                                  onSelect: () => { setBudgetErrors({}); setBudgetForm({ id: b._id, category: b.category, planned: String((b.plannedCents ?? 0) / 100) }); },
                                },
                                {
                                  id: "delete",
                                  label: "Delete budget line",
                                  icon: <Trash2 size={14} />,
                                  destructive: true,
                                  onSelect: async () => {
                                    const approved = await confirm({
                                      title: "Delete budget line?",
                                      message: `The FY ${budgetFiscalYear} "${b.category}" budget of ${formatMoney(b.plannedCents)} will be removed. Actual transactions are not affected.`,
                                      confirmLabel: "Delete budget line",
                                      tone: "danger",
                                    });
                                    if (!approved) return;
                                    try {
                                      await removeBudget({ id: b._id });
                                      toast.success("Budget line deleted", b.category);
                                    } catch (error: any) {
                                      toast.error("Could not delete budget line", error?.message);
                                    }
                                  },
                                },
                              ],
                            },
                          ]}
                        />
                      </td>
                    </tr>
                  );
                })}
                {budgetRows.length === 0 && (
                  <tr className="finance-empty-row">
                    <td colSpan={5} className="muted">
                      No budget lines yet. Add a category to start tracking variance.
                    </td>
                  </tr>
                )}
              </tbody>
              {budgetRows.length > 1 && (
                <tfoot>
                  <tr>
                    <th scope="row">Total</th>
                    <td className="num"><Money cents={budgetRows.reduce((sum: number, b: any) => sum + (b.plannedCents ?? 0), 0)} /></td>
                    <td className="num"><Money cents={budgetRows.reduce((sum: number, b: any) => sum + (b.actualCents ?? 0), 0)} /></td>
                    <td />
                    <td />
                  </tr>
                </tfoot>
              )}
            </table>
            </div>

            {budgetForm && (
              <div className="card__body" style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
                <Field label="Category" required error={budgetErrors.category}>
                  <input
                    className="input"
                    value={budgetForm.category}
                    disabled={Boolean(budgetForm.id)}
                    onChange={(e) => setBudgetForm({ ...budgetForm, category: e.target.value })}
                    placeholder="e.g. Program supplies"
                  />
                </Field>
                <Field label="Planned (CAD)" required error={budgetErrors.plannedCents}>
                  <input
                    className="input"
                    type="number"
                    min="0"
                    step="0.01"
                    value={budgetForm.planned}
                    onChange={(e) => setBudgetForm({ ...budgetForm, planned: e.target.value })}
                    placeholder="12000"
                  />
                </Field>
                <button
                  className="btn btn--accent"
                  onClick={async () => {
                    const plannedCents = budgetForm.planned.trim() === "" ? Number.NaN : Math.round(Number(budgetForm.planned) * 100);
                    const payload = { fiscalYear: budgetFiscalYear, category: budgetForm.category.trim(), plannedCents };
                    const errors = validateBudgetLineInput(payload, hub?.budgetRows ?? [], budgetForm.id);
                    setBudgetErrors(errors);
                    if (hasErrors(errors)) return;
                    try {
                      await upsertBudget({ id: budgetForm.id as any, societyId: society._id, ...payload });
                      setBudgetForm(null);
                      toast.success(budgetForm.id ? "Budget updated" : "Budget saved");
                    } catch (error: any) {
                      toast.error("Could not save budget line", error?.data?.message ?? error?.message);
                    }
                  }}
                >
                  Save
                </button>
                <button className="btn" onClick={() => setBudgetForm(null)}>
                  Cancel
                </button>
              </div>
            )}
            <BudgetGridDrawer
              open={budgetGridOpen}
              onClose={() => setBudgetGridOpen(false)}
              societyId={society._id}
              fiscalYear={budgetFiscalYear}
              canWrite={canWrite}
            />
          </div>
        </MobileFold>
      )}

      {tab === "transactions" && activeConnection && transactions && transactions.length > 0 && (
        <>
        {focusedTransaction && (
          <div className="callout callout--info">
            <Link2 size={16} />
            <div className="callout__body">
              <strong className="callout__title">Linked accounting purchase</strong>
              <div className="callout__note muted">{focusedTransaction.date} · {focusedTransaction.description} · {formatMoney(Math.abs(focusedTransaction.amountCents))}</div>
            </div>
            <button className="btn btn--sm" onClick={() => navigate("/app/financials?tab=transactions")}>Show all transactions</button>
          </div>
        )}
        {showMetadataWarning ? (
          <div style={{ marginBottom: 16 }}>
            <RecordTableMetadataEmpty societyId={society?._id} objectLabel="financial transaction" />
          </div>
        ) : tableData.objectMetadata ? (
          <div style={{ marginBottom: 16 }}>
            <RuleDrawerProvider value={txnSurface.ruleDrawer.api}>
            <RecordTableScope
              tableId="financialTransactions"
              objectMetadata={tableData.objectMetadata}
              hydratedView={financialHydratedView}
              records={records}
              recordPreview
              renderSidePanel={renderTransactionPanel}
              onUpdate={canWrite ? txnSurface.handleUpdate : undefined}
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
              <TransactionLinkFilters />
              <RecordTable
                selectable={canWrite}
                loading={tableData.loading || transactions === undefined}
                renderCell={({ record: t, field }) => {
                  if (field.name === "description" && t.payeeRenamed) return <span title={t.description}>{t.payeeName}</span>;
                  if (field.name === "counterparty") return t.payeeRenamed ? <span title={t.counterparty || t.description}>{t.payeeName}</span> : undefined;
                  if (field.name === "date") return <span title={formatDate(t.date, "EEEE, MMMM d, yyyy")}>{formatShortDate(t.date, todayISO)}</span>;
                  if (field.name === "account") return <span className="muted">{t.account || "—"}</span>;
                  if (field.name === "category") return <span className="category-cell"><CategorizationProvenance txn={t} /><Badge>{t.category ?? "uncategorized"}</Badge></span>;
                  if (field.name === "amountCents") return <Money cents={t.amountCents} tone={t.amountCents > 0 ? "in" : "auto"} />;
                  if (field.name === "items") {
                    const links = linksByTransactionId.get(t._id) ?? [];
                    const linkedAssetIds = new Set(links.map((link: any) => String(link.assetId ?? "")).filter(Boolean));
                    const directlyLinkedAssets = (assetsByTransactionId.get(t._id) ?? []).filter((asset: any) => !linkedAssetIds.has(String(asset._id)));
                    return (
                      <div className="row" style={{ gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                        {links.map((link: any) => (
                          <span key={link._id} className="row" style={{ gap: 4, alignItems: "center" }}>
                            <Link to={link.asset ? `/app/assets/${link.asset._id}` : "/app/inventory"} onClick={(e) => e.stopPropagation()}>{link.asset?.name ?? link.inventoryItem?.name ?? link.receiptLineLabel ?? "Linked item"}</Link>
                            {!link.asset && <button
                                className="btn btn--ghost btn--sm btn--icon"
                                aria-label="Unlink inventory item"
                                onClick={async (e) => { e.stopPropagation(); await unlinkInventoryReceipt({ id: link._id }); toast.success("Inventory item unlinked"); }} disabled={!canWrite}
                              >
                                <Trash2 size={12} />
                              </button>}
                          </span>
                        ))}
                        {directlyLinkedAssets.map((asset: any) => (
                          <Link key={asset._id} to={`/app/assets/${asset._id}`} onClick={(e) => e.stopPropagation()}>{asset.name}</Link>
                        ))}
                        {isAssetPurchaseTransaction(t) && <button className="btn btn--ghost btn--sm" onClick={(e) => { e.stopPropagation(); setLinkTxn(t); setLinkAssetId(""); setLinkItemId(""); }} disabled={!canWrite}>
                          <Link2 size={12} /> Link purchase
                        </button>}
                      </div>
                    );
                  }
                  return undefined;
                }}
              />
              <TransactionsBulkBar societyId={society._id} canWrite={canWrite} exportName="Transactions" />
            </RecordTableScope>
            {txnSurface.ruleDrawer.element}
            </RuleDrawerProvider>
          </div>
        ) : null}
        </>
      )}

      {tab === "transactions" && !activeConnection && (
        <div className="card financials-empty-card">
          <EmptyState
            icon={<PiggyBank size={18} />}
            title="No transactions yet"
            description={(accounts ?? []).length > 0
              ? "Import a bank CSV above, or connect a bookkeeping source to sync transactions."
              : "Connect a bookkeeping source, or set up the chart of accounts so you can import a bank CSV."}
            action={
              <>
                <button className="btn-action btn-action--primary" onClick={() => setTab("overview")}>Connect a source</button>
                <Link className="btn-action" to="/app/financials/accounting">Set up chart of accounts</Link>
              </>
            }
          />
        </div>
      )}

      {tab === "overview" && importedBudgetReviewCount > 0 && (
        <div style={{ marginBottom: 16 }}>
          <Flag level="warn">
            <strong>{importedBudgetReviewCount} imported budget record{importedBudgetReviewCount === 1 ? "" : "s"}</strong>{" "}
            awaiting review.{" "}
            <Link to="/app/org-history?section=budgets">Review in history →</Link>
          </Flag>
        </div>
      )}

      {tab === "overview" && (
        <MobileFold
          title="Year-over-year"
          summary={items === undefined ? undefined : sorted.length === 0 ? "No financial statements recorded" : `${sorted.length} ${sorted.length === 1 ? "fiscal year" : "fiscal years"} · latest FY ${sorted[0].fiscalYear}`}
        >
          <YearOverYearFinancialsCard rows={sorted} loading={items === undefined} onOpenFinancialYear={openFinancialYear} />
        </MobileFold>
      )}

      {tab === "overview" && latest && latest.remunerationDisclosures.length > 0 && appliesBcSocietyRules(society) && (
        <>
          <div className="spacer-6" />
          <div className="card">
            <div className="card__head">
              <h2 className="card__title">Remuneration disclosure — FY {latest.fiscalYear}</h2>
              <span className="card__subtitle">Top employees/contractors paid ≥ $75,000 (s.36 Societies Act).</span>
            </div>
            <table className="table finance-table">
              <thead>
                <tr><th>Position</th><th className="num">Total compensation</th></tr>
              </thead>
              <tbody>
                {latest.remunerationDisclosures.map((r, i) => (
                  <tr key={i}>
                    <td>{r.role}</td>
                    <td className="num"><Money cents={r.amountCents} /></td>
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
              Monthly estimate: {formatMoney(monthlyEstimateCents({
                amountCents: Math.round(Number(subscriptionForm.amountCad || 0) * 100),
                interval: subscriptionForm.interval,
              }))}
            </div>
          </div>
        )}
      </Drawer>

      <Drawer
        open={Boolean(linkTxn)}
        onClose={closePurchaseLink}
        title="Link accounting purchase"
        footer={
          <>
            <button className="btn" onClick={closePurchaseLink}>Cancel</button>
            <button className="btn btn--accent" onClick={savePurchaseLink} disabled={!canWrite}>Link purchase</button>
          </>
        }
      >
        {linkTxn && (
          <div className="form-grid">
            <Field label="Transaction">
              <input className="input" readOnly value={`${linkTxn.date} · ${linkTxn.description} · ${formatMoney(Math.abs(linkTxn.amountCents))}`} />
            </Field>
            <Field label="Connect to">
              <Select
                value={linkTargetType}
                onChange={(value) => setLinkTargetType(value as "asset" | "inventory")}
                options={[
                  { value: "asset", label: "Asset register" },
                  { value: "inventory", label: "Inventory item" },
                ]}
              />
            </Field>
            {linkTargetType === "asset" ? (
              <>
                <Field label="Asset" hint="The asset will show this transaction as its accounting purchase.">
                  <Select
                    value={linkAssetId}
                    onChange={setLinkAssetId}
                    placeholder="Choose an asset"
                    searchable
                    options={((assets ?? []) as any[]).map((asset) => ({ value: asset._id, label: `${asset.assetTag} · ${asset.name}` }))}
                  />
                </Field>
                <div className="accounting-purchase-create">
                  <span className="muted">The purchased item is not in the register yet?</span>
                  <button
                    className="btn btn--ghost btn--sm"
                    onClick={() => {
                      openGlobalAssetCreate({
                        name: linkTxn.description ?? "",
                        category: assetCategoryFromTransaction(linkTxn),
                        supplier: linkTxn.counterparty ?? "",
                        purchaseDate: linkTxn.date ?? "",
                        purchaseValue: (Math.abs(linkTxn.amountCents) / 100).toFixed(2),
                        purchaseTransactionId: String(linkTxn._id),
                      });
                      closePurchaseLink();
                    }}
                  >
                    <PlusCircle size={12} /> Create asset from purchase
                  </button>
                </div>
              </>
            ) : (
              <>
                <Field label="Inventory item" hint="Back-link a stocked item to this purchase.">
                  <Select
                    value={linkItemId}
                    onChange={setLinkItemId}
                    placeholder="Choose an item"
                    searchable
                    options={((inventoryItems ?? []) as any[]).map((item) => ({ value: item._id, label: item.sku ? `${item.name} (${item.sku})` : item.name }))}
                  />
                </Field>
                <p className="muted">Need a new stocked item first? <Link to="/app/inventory">Open inventory →</Link></p>
              </>
            )}
          </div>
        )}
      </Drawer>
    </div>
  );
}

function BankCsvImportCard({
  societyId,
  accounts,
}: {
  societyId: any;
  accounts: any[];
}) {
  const { canWrite } = useFinancePermissions();
  const importCsv = useMutation(api.financialHub.importBankCsvTransactions);
  const toast = useToast();
  const [accountId, setAccountId] = useState("");
  const [parsed, setParsed] = useState<ParsedCsvRow[] | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onFile = async (file: File) => {
    setFileName(file.name);
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
      const result = await importCsv({ societyId, accountId: accountId as any, rows: parsed });
      toast.success(
        `Imported ${result.inserted} transaction${result.inserted === 1 ? "" : "s"}${
          result.skipped ? `, skipped ${result.skipped} duplicate${result.skipped === 1 ? "" : "s"}` : ""
        }.`,
      );
      setParsed(null);
      setFileName(null);
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
        {/* A styled button over the native picker, which ignored the theme. */}
        <label className="btn btn--sm bank-csv-import__file">
          <FileUp size={12} aria-hidden="true" /> {fileName ? "Choose another file" : "Choose CSV file"}
          <input
            className="bank-csv-import__file-input"
            type="file"
            accept=".csv,text/csv"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void onFile(file);
              e.target.value = "";
            }}
          />
        </label>
        {fileName && (
          <span className="muted bank-csv-import__file-name" title={fileName}>
            {fileName}
            {parsed && ` · ${parsed.length} row${parsed.length === 1 ? "" : "s"} ready`}
          </span>
        )}
        <button className="btn btn--accent" disabled={!canWrite || (busy || !accountId || !parsed?.length)} onClick={doImport}>
          Import
        </button>
      </div>
    </div>
  );
}

function providerLabel(provider: string | undefined) {
  const value = String(provider ?? "").trim();
  if (!value) return "Connected";
  if (value.toLowerCase() === "quickbooks") return "QuickBooks";
  return value.charAt(0).toUpperCase() + value.slice(1);
}
