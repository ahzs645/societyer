import { Link } from "react-router-dom";
import { Badge } from "../../../components/ui";
import { formatDate, money } from "../../../lib/format";

export type WaveAccountView = "working" | "transaction" | "category" | "ledger" | "all";

export function waveTypeLabel(type: string) {
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
export function waveResourceDetailHref(resource: any): string {
  if (!resource?._id || !resource?.resourceType) return "/app/financials/wave/all";
  if (resource.resourceType === "account") return `/app/financials/wave/account/${resource._id}`;
  return `/app/financials/wave/${resource.resourceType}/${resource._id}`;
}

export function waveResourceColumns() {
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
              {[humanizeWaveEnum(row.typeValue), humanizeWaveEnum(row.subtypeValue)].filter(Boolean).join(" · ")}
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
      render: (row: any) => row.status ? <Badge tone={row.status === "archived" ? "neutral" : "info"}>{humanizeWaveEnum(row.status)}</Badge> : "—",
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
      render: (row: any) => <span className="table__cell--mono">{row.dateValue ? formatDate(row.dateValue) : "—"}</span>,
    },
  ];
}

export function counterpartyTransactionColumns() {
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

export function categoryAccountTransactionColumns() {
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

export function financialTransactionColumns(account: any) {
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

export function WaveResourceValue({ row }: { row: any }) {
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
  if (isWaveLedgerArtifactAccount(row) && row.externalId) {
    const count = Number(row.linkedCategoryTransactionCount ?? 0);
    return (
      <>
        {formatWaveValue(row.amountValue, row.currencyCode)}
        {count > 0 && (
          <div className="muted" style={{ fontSize: 11 }}>
            {count} ledger txn{count === 1 ? "" : "s"}
          </div>
        )}
      </>
    );
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
  // amountValue is a dollar figure (see formatWaveValue), while the linked
  // totals are cents — normalize the cents branches to dollars so every row
  // sorts in the same unit.
  if (isWaveCounterpartyResource(row) && row.externalId) {
    return Number(row.linkedTransactionTotalCents ?? 0) / 100;
  }
  if (isWaveCategoryAccount(row) && row.externalId && row.amountValue == null) {
    return Number(row.linkedCategoryTransactionTotalCents ?? 0) / 100;
  }
  return Number(row.amountValue ?? 0);
}

export function normalizeWaveAccountView(value: string): WaveAccountView {
  if (value === "working" || value === "category" || value === "ledger" || value === "all") return value;
  return "transaction";
}

export function filterWaveResourcesForView(
  rows: any[],
  options: { accountView: WaveAccountView; hideZeroAccounts: boolean; applyAccountView: boolean },
) {
  return rows.filter((row) => {
    if (row.resourceType !== "account") return true;
    if (options.hideZeroAccounts && isZeroWaveAmount(row.amountValue)) return false;
    if (!options.applyAccountView) return true;
    return waveAccountMatchesView(row, options.accountView);
  });
}

export function waveAccountMatchesView(row: any, view: WaveAccountView) {
  const role = waveAccountRole(row);
  if (view === "all") return row.resourceType === "account";
  if (view === "working") return row.resourceType === "account" && role !== "ledger";
  if (view === "category") return role === "category" && !isZeroInactiveWaveCategoryAccount(row);
  return role === view;
}

export function normalizeWaveResourceType(value: string) {
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

export function isWaveCounterpartyResource(resource: any) {
  return resource?.resourceType === "vendor" || resource?.resourceType === "customer";
}

function waveAccountRole(resource: any): "transaction" | "category" | "ledger" | undefined {
  if (resource?.resourceType !== "account") return undefined;
  if (isWaveLedgerArtifactAccount(resource)) return "ledger";
  if (isWaveTransactionAccount(resource)) return "transaction";
  return "category";
}

export function isWaveTransactionAccount(resource: any) {
  if (resource?.resourceType !== "account") return false;
  if (isWaveLedgerArtifactAccount(resource)) return false;
  const type = String(resource.typeValue ?? resource.raw?.type?.value ?? "").toUpperCase();
  const subtype = String(resource.subtypeValue ?? resource.raw?.subtype?.value ?? "").toUpperCase();
  return (
    type === "BANK" ||
    type === "CREDIT_CARD" ||
    subtype === "CASH_AND_BANK" ||
    subtype === "CREDIT_CARD" ||
    subtype === "MONEY_IN_TRANSIT"
  );
}

export function isWaveLedgerArtifactAccount(resource: any) {
  if (resource?.resourceType !== "account") return false;
  const subtype = String(resource.subtypeValue ?? resource.raw?.subtype?.value ?? "").toUpperCase();
  const label = String(resource.label ?? "").trim().toLowerCase();
  const linkedCategoryCount = Number(resource.linkedCategoryTransactionCount ?? 0);
  const zeroBalance = isZeroWaveAmount(resource.amountValue);
  if (subtype === "TRANSFERS" && zeroBalance) return true;
  if (["PAYABLE_BILLS", "PAYABLE_OTHER"].includes(subtype) && zeroBalance && linkedCategoryCount <= 2) return true;
  return label === "accounts payable" && zeroBalance && linkedCategoryCount <= 2;
}

export function isWaveCategoryAccount(resource: any) {
  return waveAccountRole(resource) === "category";
}

function isZeroInactiveWaveCategoryAccount(resource: any) {
  if (waveAccountRole(resource) !== "category") return false;
  return isZeroWaveAmount(resource.amountValue) && Number(resource.linkedCategoryTransactionCount ?? 0) === 0;
}

export function waveResourceBadgeLabel(resource: any) {
  if (resource?.resourceType === "account") {
    const role = waveAccountRole(resource);
    if (role === "transaction") return "Money account";
    if (role === "ledger") return "Internal row";
    return "Category account";
  }
  return waveTypeLabel(resource?.resourceType);
}

export function waveResourceSingularLabel(resource: any) {
  if (resource?.resourceType === "account") {
    const role = waveAccountRole(resource);
    if (role === "transaction") return "money account";
    if (role === "ledger") return "ledger/system account";
    return "category account";
  }
  return waveSingularTypeLabel(resource?.resourceType);
}

export function waveSingularTypeLabel(type: string) {
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

export function capitalize(value: string) {
  return value ? `${value[0].toUpperCase()}${value.slice(1)}` : value;
}

export function waveResourceDetailFields(resource: any, raw: any) {
  const currencyCode = raw?.currency?.code ?? resource.currencyCode;
  const balance = raw?.balance ?? resource.amountValue;
  const businessBalance = raw?.balanceInBusinessCurrency;
  const displayId = raw?.displayId ?? raw?.invoiceNumber ?? raw?.estimateNumber;
  const balanceText = balance == null ? undefined : formatWaveValue(String(balance), currencyCode);
  const businessBalanceText = businessBalance == null ? undefined : formatWaveValue(String(businessBalance), currencyCode);
  const fields = [
    { label: "Type", value: detailValue(raw?.type?.name) ?? humanizeWaveEnum(raw?.type?.value ?? resource.typeValue) },
    { label: "Subtype", value: detailValue(raw?.subtype?.name) ?? humanizeWaveEnum(raw?.subtype?.value ?? resource.subtypeValue) },
    { label: "Status", value: humanizeWaveEnum(resource.status) },
    { label: "Currency", value: detailPair(raw?.currency?.name, currencyCode) },
    { label: "Balance", value: balanceText },
    isWaveCounterpartyResource(resource) && Number(resource.linkedTransactionCount ?? 0) > 0
      ? { label: "Linked activity", value: `${money(Number(resource.linkedTransactionTotalCents ?? 0))} · ${resource.linkedTransactionCount} txn${resource.linkedTransactionCount === 1 ? "" : "s"}` }
      : undefined,
    isWaveCategoryAccount(resource) && Number(resource.linkedCategoryTransactionCount ?? 0) > 0
      ? { label: "Categorized activity", value: `${money(Number(resource.linkedCategoryTransactionTotalCents ?? 0))} · ${resource.linkedCategoryTransactionCount} txn${resource.linkedCategoryTransactionCount === 1 ? "" : "s"}` }
      : undefined,
    isWaveLedgerArtifactAccount(resource) && Number(resource.linkedCategoryTransactionCount ?? 0) > 0
      ? { label: "Ledger activity", value: `${money(Number(resource.linkedCategoryTransactionTotalCents ?? 0))} · ${resource.linkedCategoryTransactionCount} txn${resource.linkedCategoryTransactionCount === 1 ? "" : "s"}` }
      : undefined,
    // Only worth a row when it differs (a foreign-currency account).
    { label: "Business balance", value: businessBalanceText === balanceText ? undefined : businessBalanceText },
    { label: "Normal balance", value: humanizeWaveEnum(raw?.normalBalanceType) },
    { label: "Display ID", value: detailValue(displayId), mono: true },
    { label: "Archived", value: typeof raw?.isArchived === "boolean" ? detailValue(raw.isArchived) : undefined },
  ];
  return fields.filter((field): field is NonNullable<typeof field> => Boolean(field && field.value != null && field.value !== ""));
}

function detailPair(label: unknown, value: unknown) {
  return [detailValue(label), detailValue(value)].filter(Boolean).join(" · ") || undefined;
}

/** Wave enums ("CASH_AND_BANK", "active") as plain words ("Cash and bank", "Active"). */
export function humanizeWaveEnum(value: unknown) {
  const text = detailValue(value);
  if (!text) return undefined;
  const words = text.replace(/[_-]+/g, " ").trim().toLowerCase();
  return words ? `${words[0].toUpperCase()}${words.slice(1)}` : undefined;
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

export function isBrowserBackedWaveConnection(connection: any) {
  return (
    connection?.provider === "wave" &&
    (connection?.syncMode === "browser" || /wave browser/i.test(connection?.accountLabel ?? ""))
  );
}

export function formatWaveValue(value?: string, currencyCode?: string) {
  if (value == null || value === "") return "—";
  const amount = Number(value);
  if (!Number.isFinite(amount)) return value;
  if (!currencyCode) return amount.toLocaleString("en-CA");
  return new Intl.NumberFormat("en-CA", { style: "currency", currency: currencyCode }).format(amount);
}
