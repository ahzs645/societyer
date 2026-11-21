/**
 * Director consent to act, read from the consent register (`directorConsents`,
 * shared/businessEvidence.ts). The register keeps every version: a revision
 * points at the row it replaces through `previousId`. A director's consent
 * state is the latest current "Consent to act" entry: Given or Corrected means
 * consent is on file, Withdrawn means it is not.
 *
 * Used by the business-evidence write path (to keep `directors.consentOnFile`
 * in step with the register) and by the director drawer. Framework-free.
 */

export const CONSENT_TO_ACT_SCOPE = "Consent to act";

export type DirectorConsentEvent = "Given" | "Withdrawn" | "Corrected";

export interface DirectorConsentRow {
  _id: string;
  directorId?: string;
  scope?: string;
  event?: string;
  effectiveDate?: string;
  basis?: string;
  signedOn?: string;
  receivedOn?: string;
  documentDate?: string;
  reviewStatus?: string;
  recordedAt?: string;
  previousId?: string;
  documentId?: string;
  documentMissing?: boolean;
}

/**
 * The director's latest "Consent to act" entry: superseded versions are
 * skipped, then the latest effective date wins, then the latest recording.
 */
export function latestConsentToAct<Row extends DirectorConsentRow>(rows: readonly Row[], directorId: string): Row | undefined {
  const superseded = new Set(rows.map((row) => row.previousId).filter((id): id is string => Boolean(id)).map(String));
  return rows
    .filter((row) => String(row.directorId ?? "") === directorId && row.scope === CONSENT_TO_ACT_SCOPE && !superseded.has(String(row._id)))
    .sort((a, b) =>
      String(b.effectiveDate ?? "").localeCompare(String(a.effectiveDate ?? ""))
      || String(b.recordedAt ?? "").localeCompare(String(a.recordedAt ?? "")))[0];
}

/** Whether an entry leaves consent on file: Given or Corrected yes, Withdrawn no. */
export function consentOnFileFromEntry(row: Pick<DirectorConsentRow, "event">): boolean {
  return row.event !== "Withdrawn";
}
