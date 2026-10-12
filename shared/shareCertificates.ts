/**
 * Physical share-certificate register (YCN SHR_CERT / SHR_CERT_REPL /
 * CANCEL_DT_TM).
 *
 * A certificate is a physical document evidencing a holding. Certificates can
 * be cancelled (e.g. on transfer) and replaced (lost/damaged/split), forming a
 * chain back to the original. This module reconstructs the certificate register
 * at any point in time and validates individual certificate events.
 *
 * Dates are ISO-8601 strings, which sort lexicographically, so plain string
 * comparison is sufficient. All functions are pure (no convex/react imports)
 * and take any "now" instant as an explicit parameter.
 */

export interface CertificateEvent {
  certificateNumber: string;
  holderName: string;
  shareClass: string;
  shares: number;
  issuedOn: string;
  replacesCertificateNumber?: string | null;
  cancelledOn?: string | null;
  /** Optional ledger links; without them the class and holder are matched by name. */
  rightsClassId?: string | null;
  holderRoleHolderId?: string | null;
}

/** Normalize a raw value to a non-empty trimmed string, or null. */
function isoOrNull(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * Certificates issued on/before `asOfISO` and not cancelled on/before
 * `asOfISO`.
 *
 * Boundary semantics: a certificate issued exactly at `asOf` is active; a
 * certificate cancelled exactly at `asOf` is no longer active.
 */
export function activeCertificates(
  events: CertificateEvent[],
  asOfISO: string,
): CertificateEvent[] {
  return events.filter((event) => {
    const issued = isoOrNull(event.issuedOn);
    const cancelled = isoOrNull(event.cancelledOn);
    const isIssued = issued != null && issued <= asOfISO;
    const notCancelled = cancelled == null || cancelled > asOfISO;
    return isIssued && notCancelled;
  });
}

/**
 * The lineage of a certificate, following `replacesCertificateNumber` backwards
 * to the original, returned ordered original → latest.
 *
 * If `certificateNumber` is not found, returns an empty array. Self-references
 * and cycles are guarded against so a malformed chain terminates rather than
 * looping forever.
 */
export function certificateChain(
  events: CertificateEvent[],
  certificateNumber: string,
): CertificateEvent[] {
  const byNumber = new Map<string, CertificateEvent>();
  for (const event of events) {
    if (!byNumber.has(event.certificateNumber)) {
      byNumber.set(event.certificateNumber, event);
    }
  }

  const chain: CertificateEvent[] = [];
  const seen = new Set<string>();
  let current = byNumber.get(certificateNumber);
  while (current && !seen.has(current.certificateNumber)) {
    seen.add(current.certificateNumber);
    chain.push(current);
    const previous = isoOrNull(current.replacesCertificateNumber);
    current = previous == null ? undefined : byNumber.get(previous);
  }

  return chain.reverse();
}

/**
 * Validate a single certificate event. Requires the identifying fields, a
 * positive integer share count, and (when present) a cancellation that does not
 * precede issuance.
 */
export function validateCertificate(e: CertificateEvent): {
  ok: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  if (isoOrNull(e.certificateNumber) == null) {
    errors.push("certificateNumber is required");
  }
  if (isoOrNull(e.holderName) == null) {
    errors.push("holderName is required");
  }
  if (isoOrNull(e.shareClass) == null) {
    errors.push("shareClass is required");
  }
  const issued = isoOrNull(e.issuedOn);
  if (issued == null) {
    errors.push("issuedOn is required");
  }

  if (
    typeof e.shares !== "number" ||
    !Number.isFinite(e.shares) ||
    !Number.isInteger(e.shares) ||
    e.shares <= 0
  ) {
    errors.push("shares must be a positive integer");
  }

  const cancelled = isoOrNull(e.cancelledOn);
  if (cancelled != null && issued != null && cancelled < issued) {
    errors.push("cancelledOn must be on or after issuedOn");
  }

  return { ok: errors.length === 0, errors };
}

/**
 * Sum the shares of all active certificates, grouped by share class, as of
 * `asOfISO`. Classes with no active certificates are omitted.
 */
export function sharesOutstandingByClass(
  events: CertificateEvent[],
  asOfISO: string,
): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const event of activeCertificates(events, asOfISO)) {
    const shares =
      typeof event.shares === "number" && Number.isFinite(event.shares)
        ? event.shares
        : 0;
    totals[event.shareClass] = (totals[event.shareClass] ?? 0) + shares;
  }
  return totals;
}

/** Certificate numbers compare trimmed and case-insensitively ("4a" duplicates "4A"). */
export function normalizeCertificateNumber(value: unknown): string {
  return typeof value === "string" ? value.trim().toUpperCase() : "";
}

/**
 * Certificate numbers are unique within an organization: the replacement chain
 * (`replacesCertificateNumber`) and the register look certificates up by number
 * alone, across every class. Returns the clashing row, if any.
 */
export function duplicateCertificateNumber<T extends { certificateNumber: string; _id?: unknown }>(
  rows: T[],
  certificateNumber: string,
  excludeId?: unknown,
): T | undefined {
  const wanted = normalizeCertificateNumber(certificateNumber);
  if (!wanted) return undefined;
  return rows.find((row) => normalizeCertificateNumber(row.certificateNumber) === wanted && (excludeId === undefined || String(row._id) !== String(excludeId)));
}

/**
 * Conservation on a transfer or split: a cancelled certificate's shares must
 * equal the shares on the certificates that replace it (the transferee's
 * certificate plus any balance certificate back to the transferor).
 */
export function certificateConservationIssues(events: CertificateEvent[]): string[] {
  const issues: string[] = [];
  const successors = new Map<string, CertificateEvent[]>();
  for (const event of events) {
    const previous = normalizeCertificateNumber(event.replacesCertificateNumber);
    if (!previous) continue;
    successors.set(previous, [...(successors.get(previous) ?? []), event]);
  }
  for (const cancelled of events) {
    if (!isoOrNull(cancelled.cancelledOn)) continue;
    const next = successors.get(normalizeCertificateNumber(cancelled.certificateNumber)) ?? [];
    if (!next.length) continue;
    const holder = normalizedName(cancelled.holderName);
    const balance = next.filter((row) => normalizedName(row.holderName) === holder).reduce((sum, row) => sum + row.shares, 0);
    const transferred = next.reduce((sum, row) => sum + row.shares, 0) - balance;
    if (transferred + balance !== cancelled.shares) {
      issues.push(
        `Certificate ${cancelled.certificateNumber} (${cancelled.shares} ${cancelled.shareClass} shares of ${cancelled.holderName}) was cancelled, but the certificates replacing it show ${transferred} transferred plus ${balance} balance = ${transferred + balance}. The cancelled certificate must equal the shares transferred plus the balance certificate.`,
      );
    }
  }
  return issues;
}

export type ReconciliationClass = { _id: string; className: string; idPrefix?: string; singularForm?: string; singularDescription?: string; pluralDescription?: string };
export type ReconciliationHolder = { _id: string; fullName?: string };
export type ReconciliationHolding = { rightsClassId: string; holderKey: string; quantity: number };

export type CertificateReconciliationRow = {
  rightsClassId?: string;
  className: string;
  holderKey: string;
  holderName: string;
  certificateShares: number;
  ledgerShares: number;
  /** uncertificated = ledger shares with no outstanding certificate. */
  status: "matched" | "mismatch" | "uncertificated" | "no_ledger_holding";
};

export type CertificateReconciliation = {
  asOfISO: string;
  rows: CertificateReconciliationRow[];
  /** Problems to resolve: mismatches, certificates with no holding, unknown classes, conservation. */
  issues: string[];
  /** Ledger holdings with no certificate are allowed for uncertificated shares, so they are notes only. */
  notes: string[];
  balanced: boolean;
};

function normalizedName(value: unknown): string {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").toLowerCase() : "";
}

/**
 * Compare the outstanding certificates with the share ledger as of a date:
 * for each holder and class, the shares on active certificates must equal the
 * ledger holding (`holdingsAsOf`). Classes and holders are matched by the
 * certificate's ledger link when it has one, otherwise by name.
 */
export function reconcileCertificatesWithLedger(input: {
  certificates: CertificateEvent[];
  holdings: ReconciliationHolding[];
  classes: ReconciliationClass[];
  roleHolders: ReconciliationHolder[];
  asOfISO: string;
}): CertificateReconciliation {
  const classById = new Map(input.classes.map((cls) => [String(cls._id), cls]));
  const classByName = new Map<string, string>();
  for (const cls of input.classes) {
    for (const label of [cls.className, cls.idPrefix, cls.singularForm, cls.singularDescription, cls.pluralDescription]) {
      const key = normalizedName(label);
      if (key && !classByName.has(key)) classByName.set(key, String(cls._id));
    }
  }
  const holderByName = new Map<string, string[]>();
  for (const holder of input.roleHolders) {
    const key = normalizedName(holder.fullName);
    if (key) holderByName.set(key, [...(holderByName.get(key) ?? []), String(holder._id)]);
  }
  const holderNameById = new Map(input.roleHolders.map((holder) => [String(holder._id), String(holder.fullName ?? "")]));
  // One canonical key per holder: the role-holder id when known, else the name.
  const canonicalHolder = (roleHolderId: string | null | undefined, name: string): string => {
    if (roleHolderId) return `roleHolder:${roleHolderId}`;
    const matches = holderByName.get(normalizedName(name)) ?? [];
    return matches.length === 1 ? `roleHolder:${matches[0]}` : `name:${normalizedName(name)}`;
  };
  const ledgerHolder = (holderKey: string): string =>
    holderKey.startsWith("name:") ? canonicalHolder(undefined, holderKey.slice("name:".length)) : holderKey;
  const displayName = (key: string, fallback: string) =>
    key.startsWith("roleHolder:") ? holderNameById.get(key.slice("roleHolder:".length)) || fallback : fallback;

  const rows = new Map<string, CertificateReconciliationRow>();
  const issues: string[] = [];
  for (const certificate of activeCertificates(input.certificates, input.asOfISO)) {
    const classId = certificate.rightsClassId ?? classByName.get(normalizedName(certificate.shareClass));
    if (!classId || !classById.has(String(classId))) {
      issues.push(`Certificate ${certificate.certificateNumber} names class "${certificate.shareClass}", which matches no share class in the register.`);
      continue;
    }
    const holder = canonicalHolder(certificate.holderRoleHolderId, certificate.holderName);
    const key = `${classId}\u0000${holder}`;
    const row = rows.get(key) ?? {
      rightsClassId: String(classId), className: classById.get(String(classId))!.className,
      holderKey: holder, holderName: displayName(holder, certificate.holderName),
      certificateShares: 0, ledgerShares: 0, status: "matched" as const,
    };
    row.certificateShares += certificate.shares;
    rows.set(key, row);
  }
  for (const holding of input.holdings) {
    if (!holding.quantity) continue;
    const holder = ledgerHolder(holding.holderKey);
    const key = `${holding.rightsClassId}\u0000${holder}`;
    const fallbackName = holding.holderKey.startsWith("name:") ? holding.holderKey.slice("name:".length) : holding.holderKey;
    const row = rows.get(key) ?? {
      rightsClassId: holding.rightsClassId, className: classById.get(holding.rightsClassId)?.className ?? holding.rightsClassId,
      holderKey: holder, holderName: displayName(holder, fallbackName),
      certificateShares: 0, ledgerShares: 0, status: "matched" as const,
    };
    row.ledgerShares += holding.quantity;
    rows.set(key, row);
  }
  const notes: string[] = [];
  for (const row of rows.values()) {
    if (row.certificateShares === row.ledgerShares) row.status = "matched";
    else if (row.certificateShares === 0) {
      row.status = "uncertificated";
      notes.push(`${row.holderName} holds ${row.ledgerShares} ${row.className} shares in the ledger with no outstanding certificate. That is correct only if these shares are uncertificated.`);
    } else if (row.ledgerShares === 0) {
      row.status = "no_ledger_holding";
      issues.push(`Outstanding certificates show ${row.certificateShares} ${row.className} shares for ${row.holderName}, but the ledger shows none on ${input.asOfISO}.`);
    } else {
      row.status = "mismatch";
      issues.push(`${row.holderName}: outstanding certificates show ${row.certificateShares} ${row.className} shares but the ledger shows ${row.ledgerShares} on ${input.asOfISO}.`);
    }
  }
  issues.push(...certificateConservationIssues(input.certificates));
  const sorted = [...rows.values()].sort((a, b) => a.className.localeCompare(b.className) || a.holderName.localeCompare(b.holderName));
  return { asOfISO: input.asOfISO, rows: sorted, issues, notes, balanced: issues.length === 0 };
}
