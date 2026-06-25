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
