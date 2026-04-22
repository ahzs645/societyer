import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "convex/react";
import { Braces, Database, ExternalLink, RefreshCw } from "lucide-react";
import { api } from "@/lib/convexApi";
import { Badge, Drawer, Flag } from "../../../components/ui";
import { formatDateTime, money } from "../../../lib/format";
import {
  type WaveAccountView,
  WaveResourceValue,
  filterWaveResourcesForView,
  isWaveCategoryAccount,
  isWaveCounterpartyResource,
  isWaveLedgerArtifactAccount,
  isWaveTransactionAccount,
  waveAccountMatchesView,
  waveResourceBadgeLabel,
  waveResourceDetailFields,
  waveResourceDetailHref,
  waveSingularTypeLabel,
  waveTypeLabel,
} from "../lib/waveResources";

export function WaveCacheExplorer({
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
  accountView,
  search,
  selectedResource,
  selectedResourceId,
  hideZeroAccounts,
  structures,
  summary,
  onHideZeroAccountsChange,
  onAccountViewChange,
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
  accountView: WaveAccountView;
  search: string;
  selectedResource: any;
  selectedResourceId: string | null;
  hideZeroAccounts: boolean;
  structures: any[];
  summary: any;
  onHideZeroAccountsChange: (value: boolean) => void;
  onAccountViewChange: (value: WaveAccountView) => void;
  onResourceTypeChange: (type: string) => void;
  onSearchChange: (value: string) => void;
  onSelectResource: (id: string | null) => void;
}) {
  const counts = summary?.resourceCounts ?? {};
  const totalResources = Object.values(counts).reduce((sum: number, value: any) => sum + Number(value ?? 0), 0);
  const visibleResources = filterWaveResourcesForView(resources, {
    accountView,
    hideZeroAccounts,
    applyAccountView: resourceType === "account" || resourceType === "all",
  });
  const hiddenResourceCount = resources.length - visibleResources.length;
  const selectedFallback = resources.find((row) => row._id === selectedResourceId) ?? null;
  const openTableType = resourceType || "all";
  const openTableHref = `/app/financials/wave/${openTableType}${accountView === "transaction" ? "" : `?accountView=${accountView}`}`;

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

      <WaveCacheControls
        mode={mode}
        resourceType={resourceType}
        resourceTypes={resourceTypes}
        counts={counts}
        totalResources={totalResources}
        accountView={accountView}
        resources={resources}
        hideZeroAccounts={hideZeroAccounts}
        search={search}
        openTableHref={openTableHref}
        onResourceTypeChange={onResourceTypeChange}
        onAccountViewChange={onAccountViewChange}
        onHideZeroAccountsChange={onHideZeroAccountsChange}
        onSearchChange={onSearchChange}
      />

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

          {hiddenResourceCount > 0 && (
            <div className="card__body muted" style={{ borderTop: "1px solid var(--border)", fontSize: 12 }}>
              Hidden {hiddenResourceCount} Wave row{hiddenResourceCount === 1 ? "" : "s"} from this view. Use Raw accounts to inspect imported ledger artifacts.
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

export function WaveResourceDrawer({
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
  const isCategoryAccount = resource?.resourceType === "account" && isWaveCategoryAccount(resource);
  const isLedgerAccount = resource?.resourceType === "account" && isWaveLedgerArtifactAccount(resource);
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

      {resource.resourceType === "account" && (isTransactionAccount || isCategoryAccount) && (
        <AccountTransactionsPreview
          activity={isTransactionAccount ? accountActivity : categoryActivity}
          accountPageHref={accountPageHref}
          mode={isTransactionAccount ? "account" : "category"}
          pullState={pullState}
          pullError={pullError}
        />
      )}
      {isLedgerAccount && (
        <div style={{ borderTop: "1px solid var(--border)", paddingTop: 12 }}>
          <Flag level="warn">
            Wave ledger/system row. Usually payable or transfer clearing internals, not a reusable transaction category.
          </Flag>
        </div>
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

function WaveCacheControls({
  mode,
  resourceType,
  resourceTypes,
  counts,
  totalResources,
  accountView,
  resources,
  hideZeroAccounts,
  search,
  openTableHref,
  onResourceTypeChange,
  onAccountViewChange,
  onHideZeroAccountsChange,
  onSearchChange,
}: {
  mode: "resources" | "structures";
  resourceType: string;
  resourceTypes: string[];
  counts: Record<string, any>;
  totalResources: number;
  accountView: WaveAccountView;
  resources: any[];
  hideZeroAccounts: boolean;
  search: string;
  openTableHref: string;
  onResourceTypeChange: (type: string) => void;
  onAccountViewChange: (value: WaveAccountView) => void;
  onHideZeroAccountsChange: (value: boolean) => void;
  onSearchChange: (value: string) => void;
}) {
  const showAccountViews = mode === "resources" && (resourceType === "account" || resourceType === "all");

  return (
    <div className="card__body" style={{ display: "grid", gap: 12 }}>
      {mode === "resources" && (
        <>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <ControlGroupLabel>Resource</ControlGroupLabel>
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
          </div>

          {showAccountViews && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <ControlGroupLabel>Account view</ControlGroupLabel>
              <WaveAccountViewControls
                rows={resources}
                value={accountView}
                onChange={onAccountViewChange}
              />
            </div>
          )}
        </>
      )}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <input
          className="input"
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder={mode === "resources" ? "Search cached Wave data" : "Search structures"}
          style={{ minWidth: 220, flex: "1 1 280px", maxWidth: 420 }}
        />
        {showAccountViews && (
          <button
            className={hideZeroAccounts ? "btn btn--accent btn--sm" : "btn btn--ghost btn--sm"}
            onClick={() => onHideZeroAccountsChange(!hideZeroAccounts)}
            title="Toggle zero-balance account rows in this cache table. Raw Wave data is always stored."
          >
            Zero balance {hideZeroAccounts ? "hidden" : "shown"}
          </button>
        )}
        {mode === "resources" && (
          <Link className="btn btn--ghost btn--sm" to={openTableHref}>
            <ExternalLink size={12} /> Open table
          </Link>
        )}
      </div>
    </div>
  );
}

function ControlGroupLabel({ children }: { children: string }) {
  return (
    <span className="muted" style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0, textTransform: "uppercase" }}>
      {children}
    </span>
  );
}

export function WaveResourceSummary({ resource }: { resource: any }) {
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
          gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 180px), 1fr))",
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

export function WaveAccountViewControls({
  rows,
  value,
  onChange,
  style,
}: {
  rows: any[];
  value: WaveAccountView;
  onChange: (value: WaveAccountView) => void;
  style?: Record<string, any>;
}) {
  const accountRows = rows.filter((row) => row.resourceType === "account");
  if (accountRows.length === 0) return null;
  const options: Array<{ value: WaveAccountView; label: string; title: string }> = [
    { value: "transaction", label: "Money accounts", title: "Bank, cash, credit card, and payroll clearing accounts." },
    { value: "category", label: "Categories", title: "Income, expense, equity, tax, payroll, and other chart-of-account categories." },
    { value: "working", label: "Working set", title: "Money accounts and chart categories, excluding Wave ledger artifacts." },
    { value: "ledger", label: "Ledger/system", title: "Wave-generated payable and transfer clearing rows hidden from the default view." },
    { value: "all", label: "Raw accounts", title: "Every Wave account row exactly as cached." },
  ];

  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", ...style }}>
      {options.map((option) => {
        const count = accountRows.filter((row) => waveAccountMatchesView(row, option.value)).length;
        return (
          <button
            key={option.value}
            className={value === option.value ? "btn btn--accent btn--sm" : "btn btn--ghost btn--sm"}
            onClick={() => onChange(option.value)}
            title={option.title}
          >
            {option.label} <span className="muted">{count}</span>
          </button>
        );
      })}
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

export function TransactionDrawer({
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
              gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 160px), 1fr))",
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

export function DetailCell({
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
