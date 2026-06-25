/**
 * Operative-data view builders for the document packets that previously rendered
 * grammar prose with no bound data (YCN `Doc - *` operative tables).
 *
 * Each builder is pure: it takes already-fetched register rows and returns a
 * plain context fragment that the packet body renders via {#if}/{#each} markup.
 * The Convex layer (buildPacketDataContext) fetches the rows and merges the
 * result into the render context; mirrors the dividend/annual builders.
 *
 * Framework-free. Named exports only.
 */

const MAX_ROWS = 25;

export interface NamedRow {
  fullName?: string;
  roleType?: string;
  status?: string;
  officerTitle?: string;
  directorTerm?: string;
  endDate?: string | null;
}

function isCurrent(row: NamedRow): boolean {
  return !row.endDate && row.status !== "former";
}

/** Current officers → "{name} as {title}" appointment rows. */
export function officerAppointmentView(roleHolders: NamedRow[]) {
  const officers = roleHolders
    .filter((r) => r.roleType === "officer" && isCurrent(r))
    .slice(0, MAX_ROWS)
    .map((r) => ({ name: String(r.fullName ?? ""), title: String(r.officerTitle ?? "Officer") }));
  return { appointment: { hasOfficers: officers.length > 0, officers } };
}

/** Current directors → appointment rows (with term where known). */
export function directorAppointmentView(roleHolders: NamedRow[]) {
  const directors = roleHolders
    .filter((r) => r.roleType === "director" && isCurrent(r))
    .slice(0, MAX_ROWS)
    .map((r) => ({ name: String(r.fullName ?? ""), term: String(r.directorTerm ?? "") }));
  return { appointment: { hasDirectors: directors.length > 0, directors } };
}

/** Departed directors (former / end-dated) → removal rows. */
export function directorRemovalView(roleHolders: NamedRow[]) {
  const removals = roleHolders
    .filter((r) => r.roleType === "director" && !isCurrent(r))
    .slice(0, MAX_ROWS)
    .map((r) => ({ name: String(r.fullName ?? ""), endDate: String(r.endDate ?? "") }));
  return { removal: { hasRemovals: removals.length > 0, removals } };
}

export interface TransferRow {
  transferType?: string;
  status?: string;
  transferDate?: string;
  rightsClassId?: string;
  sourceHolderName?: string;
  destinationHolderName?: string;
  quantity?: number;
}

/** Posted transfers → a "from → to, N shares of CLASS" operative table. */
export function shareTransferView(
  transfers: TransferRow[],
  classNameById: Record<string, string> = {},
) {
  const rows = transfers
    .filter((t) => t.transferType === "transfer" && t.status === "posted")
    .slice(0, MAX_ROWS)
    .map((t) => ({
      date: String(t.transferDate ?? ""),
      className: classNameById[String(t.rightsClassId ?? "")] ?? "",
      from: String(t.sourceHolderName ?? ""),
      to: String(t.destinationHolderName ?? ""),
      quantity: Number(t.quantity ?? 0),
    }));
  return { transfer: { hasTransfers: rows.length > 0, transfers: rows } };
}

export interface CertificateRow {
  certificateNumber?: string;
  holderName?: string;
  shareClass?: string;
  shares?: number;
  issuedOn?: string;
  cancelledOn?: string | null;
}

/** Active (uncancelled) share certificates → an operative table. */
export function shareCertificateView(certs: CertificateRow[]) {
  const rows = certs
    .filter((c) => !c.cancelledOn)
    .slice(0, MAX_ROWS)
    .map((c) => ({
      number: String(c.certificateNumber ?? ""),
      holder: String(c.holderName ?? ""),
      className: String(c.shareClass ?? ""),
      shares: Number(c.shares ?? 0),
      issuedOn: String(c.issuedOn ?? ""),
    }));
  return { certificate: { hasCertificates: rows.length > 0, certificates: rows } };
}

export interface AddressRow {
  type?: string; // registered_office | records_office | ...
  status?: string; // current | past | proposed
  street?: string;
  unit?: string;
  city?: string;
  provinceState?: string;
  postalCode?: string;
  country?: string;
  effectiveFrom?: string;
}

/** One-line address string from an address row. */
export function formatAddress(a: AddressRow | undefined): string {
  if (!a) return "";
  return [
    [a.street, a.unit].filter(Boolean).join(", "),
    a.city,
    [a.provinceState, a.postalCode].filter(Boolean).join(" "),
    a.country,
  ].filter((p) => p && String(p).trim()).join(", ");
}

function latest(addresses: AddressRow[], type: string, status: string): AddressRow | undefined {
  return addresses
    .filter((a) => a.type === type && a.status === status)
    .sort((x, y) => String(y.effectiveFrom ?? "").localeCompare(String(x.effectiveFrom ?? "")))[0];
}

/** Registered + records office, current and (for the "from → to" clause) prior. */
export function officeChangeView(addresses: AddressRow[]) {
  const registered = latest(addresses, "registered_office", "current");
  const records = latest(addresses, "records_office", "current");
  const priorRegistered = latest(addresses, "registered_office", "past");
  const priorRecords = latest(addresses, "records_office", "past");
  return {
    offices: {
      registered: formatAddress(registered),
      records: formatAddress(records),
      priorRegistered: formatAddress(priorRegistered),
      priorRecords: formatAddress(priorRecords),
      hasRegistered: Boolean(registered),
      hasRecords: Boolean(records),
      hasPriorRegistered: Boolean(priorRegistered),
      hasPriorRecords: Boolean(priorRecords),
    },
  };
}

export interface AssetRow {
  name?: string;
  category?: string;
  status?: string; // in_service | disposed | ...
  purchaseDate?: string;
  purchaseValueCents?: number;
  currency?: string;
  supplier?: string;
  notes?: string;
}

function formatCents(cents: number | undefined, currency: string | undefined): string {
  if (typeof cents !== "number") return "";
  const amount = (cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return [currency, amount].filter(Boolean).join(" ");
}

/** Assets split into acquisitions (in service) and dispositions (disposed). */
export function assetTransferView(assets: AssetRow[]) {
  const acquisitions = assets
    .filter((a) => a.status !== "disposed")
    .slice(0, MAX_ROWS)
    .map((a) => ({
      name: String(a.name ?? ""),
      category: String(a.category ?? ""),
      value: formatCents(a.purchaseValueCents, a.currency),
      from: String(a.supplier ?? ""),
      date: String(a.purchaseDate ?? ""),
    }));
  const dispositions = assets
    .filter((a) => a.status === "disposed")
    .slice(0, MAX_ROWS)
    .map((a) => ({ name: String(a.name ?? ""), category: String(a.category ?? ""), notes: String(a.notes ?? "") }));
  return {
    assetTransfer: {
      hasAcquisitions: acquisitions.length > 0,
      acquisitions,
      hasDispositions: dispositions.length > 0,
      dispositions,
    },
  };
}
