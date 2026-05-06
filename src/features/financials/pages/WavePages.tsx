import { useAction, useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import { useSociety } from "../../../hooks/useSociety";
import { SeedPrompt, PageHeader } from "../../../pages/_helpers";
import { Badge, Flag } from "../../../components/ui";
import { DataTable } from "../../../components/DataTable";
import { money } from "../../../lib/format";
import { ArrowLeft, Database, ExternalLink, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { useToast } from "../../../components/Toast";
import { RecordTableMetadataEmpty } from "../../../components/RecordTableMetadataEmpty";
import {
  TransactionDrawer,
  WaveAccountViewControls,
  WaveResourceDrawer,
  WaveResourceSummary,
} from "../components/WaveCacheExplorer";
import {
  type WaveAccountView,
  capitalize,
  categoryAccountTransactionColumns,
  counterpartyTransactionColumns,
  filterWaveResourcesForView,
  financialTransactionColumns,
  isBrowserBackedWaveConnection,
  isWaveCategoryAccount,
  isWaveCounterpartyResource,
  isWaveLedgerArtifactAccount,
  isWaveTransactionAccount,
  normalizeWaveAccountView,
  normalizeWaveResourceType,
  waveResourceColumns,
  waveResourceDetailHref,
  waveResourceSingularLabel,
  waveSingularTypeLabel,
  waveTypeLabel,
} from "../lib/waveResources";
import {
  RecordTable,
  RecordTableScope,
  RecordTableViewToolbar,
  RecordTableFilterChips,
  RecordTableFilterPopover,
  useObjectRecordTableData,
} from "@/modules/object-record";
import type { Id } from "../../../../convex/_generated/dataModel";

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
  const [accountView, setAccountView] = useState<WaveAccountView>(() => normalizeWaveAccountView(searchParams.get("accountView") ?? "transaction"));
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

  useEffect(() => {
    const nextAccountView = normalizeWaveAccountView(searchParams.get("accountView") ?? "transaction");
    if (nextAccountView !== accountView) setAccountView(nextAccountView);
  }, [accountView, searchParams]);

  if (society === undefined) return <div className="page">Loading...</div>;
  if (society === null) return <SeedPrompt />;

  const allResources = waveResources ?? [];
  const rows = filterWaveResourcesForView(allResources, {
    accountView,
    hideZeroAccounts: hideZeroWaveAccounts,
    applyAccountView: tableResourceType === "account" || tableResourceType === "all",
  });
  const hiddenRows = allResources.length - rows.length;
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

  const changeAccountView = (nextView: WaveAccountView) => {
    setAccountView(nextView);
    const next = new URLSearchParams(searchParams);
    if (nextView === "transaction") next.delete("accountView");
    else next.set("accountView", nextView);
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
            ? `${waveSummary.businessName} · ${rows.length} rows${hiddenRows > 0 ? ` · ${hiddenRows} hidden by view` : ""}`
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

      {(tableResourceType === "account" || tableResourceType === "all") && (
        <WaveAccountViewControls
          rows={allResources}
          value={accountView}
          onChange={changeAccountView}
          style={{ marginBottom: 12 }}
        />
      )}

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
        emptyMessage={waveSummary ? "No cached Wave rows match this account view." : "Refresh the Wave cache to load this table."}
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
  const isCategoryAccount = resource?.resourceType === "account" && isWaveCategoryAccount(resource);
  const isLedgerAccount = resource?.resourceType === "account" && isWaveLedgerArtifactAccount(resource);
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
  const activity = isTransactionAccount ? accountActivity : isCategoryAccount ? categoryActivity : undefined;
  const [selectedTransaction, setSelectedTransaction] = useState<any>(null);
  const [pullState, setPullState] = useState<"idle" | "pulling" | "pulled" | "error">("idle");
  const [pullError, setPullError] = useState<string | null>(null);
  const [txnViewId, setTxnViewId] = useState<Id<"views"> | undefined>(undefined);
  const [txnFilterOpen, setTxnFilterOpen] = useState(false);

  const txnTableData = useObjectRecordTableData({
    societyId: society?._id,
    nameSingular: "accountTransaction",
    viewId: txnViewId,
  });

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

  // Flatten for the record table — for category accounts the
  // `accountName` comes from the transaction's linked Wave account;
  // for regular accounts it's the parent account context (same for
  // all rows).
  const txnRecords = transactions.map((row: any) => ({
    ...row,
    accountName: isCategoryAccount
      ? row.account?.name ?? row.accountResource?.label ?? ""
      : activity?.account?.name ?? "",
    counterparty: row.counterparty ?? "",
    category: isCategoryAccount ? "" : row.category ?? "",
  }));
  const txnMetadataWarning = !txnTableData.loading && !txnTableData.objectMetadata;

  return (
    <div className="page">
      <PageHeader
        title={resource.label}
        icon={<Database size={16} />}
        iconColor="green"
        subtitle={
          isLedgerAccount
            ? `${capitalize(accountKind)} · Cached Wave ledger row`
            : activity !== undefined
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

      {isLedgerAccount ? (
        <Flag level="warn">
          Wave ledger/system row. Usually payable or transfer clearing internals, not a reusable transaction category.
        </Flag>
      ) : txnMetadataWarning ? (
        <RecordTableMetadataEmpty societyId={society?._id} objectLabel="account-transaction" />
      ) : txnTableData.objectMetadata ? (
        <RecordTableScope
          tableId={`wave-account-txns-${resource._id}`}
          objectMetadata={txnTableData.objectMetadata}
          hydratedView={txnTableData.hydratedView}
          records={txnRecords}
          onRecordClick={(_, record) => setSelectedTransaction(record)}
        >
          <RecordTableViewToolbar
            societyId={society._id}
            objectMetadataId={txnTableData.objectMetadata._id as Id<"objectMetadata">}
            icon={<Database size={14} />}
            label={isCategoryAccount ? "Categorized transactions" : "Account transactions"}
            views={txnTableData.views}
            currentViewId={txnViewId ?? txnTableData.views[0]?._id ?? null}
            onChangeView={(viewId) => setTxnViewId(viewId as Id<"views">)}
            onOpenFilter={() => setTxnFilterOpen((x) => !x)}
          />
          <RecordTableFilterPopover open={txnFilterOpen} onClose={() => setTxnFilterOpen(false)} />
          <RecordTableFilterChips />
          <RecordTable
            loading={txnTableData.loading || activity === undefined}
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
          />
        </RecordTableScope>
      ) : (
        <div className="record-table__loading">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="record-table__loading-row" />
          ))}
        </div>
      )}

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
  const [cpViewId, setCpViewId] = useState<Id<"views"> | undefined>(undefined);
  const [cpFilterOpen, setCpFilterOpen] = useState(false);

  const cpTableData = useObjectRecordTableData({
    societyId: society?._id,
    nameSingular: "counterpartyTransaction",
    viewId: cpViewId,
  });

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
  const cpRecords = transactions.map((row: any) => ({
    ...row,
    accountName: row.account?.name ?? row.accountResource?.label ?? "",
  }));
  const cpMetadataWarning = !cpTableData.loading && !cpTableData.objectMetadata;

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
        cpMetadataWarning ? (
          <RecordTableMetadataEmpty societyId={society?._id} objectLabel="counterparty-transaction" />
        ) : cpTableData.objectMetadata ? (
          <RecordTableScope
            tableId={`wave-cp-txns-${resource._id}`}
            objectMetadata={cpTableData.objectMetadata}
            hydratedView={cpTableData.hydratedView}
            records={cpRecords}
            onRecordClick={(_, record) => setSelectedTransaction(record)}
          >
            <RecordTableViewToolbar
              societyId={society._id}
              objectMetadataId={cpTableData.objectMetadata._id as Id<"objectMetadata">}
              icon={<Database size={14} />}
              label="Linked transactions"
              views={cpTableData.views}
              currentViewId={cpViewId ?? cpTableData.views[0]?._id ?? null}
              onChangeView={(viewId) => setCpViewId(viewId as Id<"views">)}
              onOpenFilter={() => setCpFilterOpen((x) => !x)}
            />
            <RecordTableFilterPopover open={cpFilterOpen} onClose={() => setCpFilterOpen(false)} />
            <RecordTableFilterChips />
            <RecordTable
              loading={cpTableData.loading || activity === undefined}
              renderCell={({ record, field, value }) => {
                // Render account as a Link when we have the linked
                // accountResource._id; fall back to the seed's default
                // text cell otherwise.
                if (field.name === "accountName" && record.accountResource?._id) {
                  return (
                    <Link
                      to={`/app/financials/wave/account/${record.accountResource._id}`}
                      onClick={(e) => e.stopPropagation()}
                    >
                      {String(value ?? record.accountResource.label ?? "Wave account")}
                    </Link>
                  );
                }
                return undefined;
              }}
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
            />
          </RecordTableScope>
        ) : (
          <div className="record-table__loading">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="record-table__loading-row" />
            ))}
          </div>
        )
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
