/** Preparation snapshots remain drafts; signing uses a separately reviewed instrument. */
function objectJson(value: unknown): Record<string, any> | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : undefined;
  } catch { return undefined; }
}
export const LEGACY_ANNUAL_PREPARATION_WARNING = 'Legacy annual preparation draft: review the governing Act, annual period, clauses and lawful shareholder electorate, then create a separate execution copy. Historical retention settings are unchanged and require review before any deletion; corporate minute-book records do not have a blanket seven-year expiry.';
export const ANNUAL_PREPARATION_WARNING = 'Annual preparation draft: review the governing Act, annual period, clauses and lawful shareholder electorate, then create a separate execution document. This preparation packet cannot be marked ready for signatures or approved as completed annual business.';
export type PreparationRecord = {
  dataJson?: unknown; sourcePayloadJson?: unknown; status?: unknown; reviewStatus?: unknown;
  signedDocumentId?: unknown; signersWhoSignedIds?: readonly unknown[]; signerTagsSigned?: readonly unknown[];
  sourceExternalIds?: readonly unknown[]; signedAt?: unknown; notes?: unknown;
  sourceVersionStatus?: unknown;
  draftDocumentId?: unknown; _id?: unknown;
};
function isPreparation(data: Record<string, any> | undefined): boolean {
  return data?.templateProvenance?.templateSnapshot?.preparationOnly === true || data?.templateProvenance?.legacyPreparationReview?.required === true;
}
export function isAnnualPacketRecord(record: PreparationRecord): boolean {
  const data = objectJson(record.dataJson ?? record.sourcePayloadJson);
  return data?.templateProvenance?.templateId === 'annual-resolutions' || data?.templateProvenance?.templateSnapshot?.key === 'annual-resolutions' ||
    (record.sourceExternalIds ?? []).some(value => /^societyer:(?:corporation-packet-run|[^:]+-packet-run):annual-resolutions$/.test(String(value)));
}
export function hasRecordedExecution(record: PreparationRecord): boolean {
  const data = objectJson(record.dataJson ?? record.sourcePayloadJson);
  return [record.status, record.sourceVersionStatus].some(status => ['signed', 'final', 'executed', 'completed'].includes(String(status ?? '').toLowerCase())) || Boolean(record.signedDocumentId || record.signedAt || record.signersWhoSignedIds?.length || record.signerTagsSigned?.length || data?.templateProvenance?.signatureEvidence || data?.templateProvenance?.adoptionEvidence);
}
function legacyUnexecutedAnnual(record: PreparationRecord): boolean {
  const data = objectJson(record.dataJson ?? record.sourcePayloadJson);
  return isAnnualPacketRecord(record) && data?.templateProvenance?.templateSnapshot?.preparationOnly !== true && !hasRecordedExecution(record) && String(record.status ?? '').toLowerCase() !== 'void';
}
function appendWarning(notes: unknown): string {
  const text = typeof notes === 'string' ? notes.trim() : '';
  return text.includes(LEGACY_ANNUAL_PREPARATION_WARNING) ? text : [text, LEGACY_ANNUAL_PREPARATION_WARNING].filter(Boolean).join('\n');
}
/** Read projection only: an old unexecuted packet appears in review without
 * mutating its stored instrument, provenance, execution history or retention. */
export function generatedPreparationReviewView<T extends PreparationRecord>(record: T): T {
  if (!legacyUnexecutedAnnual(record)) return record;
  return { ...record, status: 'needs_review', signersRequiredRoleHolderIds: [], signerTagsRequired: [], notes: appendWarning(record.notes), preparationReviewWarning: LEGACY_ANNUAL_PREPARATION_WARNING };
}
/** Preserve documents linked to already executed instruments. */
export function documentPreparationReviewView<T extends PreparationRecord>(record: T, generated: readonly PreparationRecord[] = []): T {
  if (!isAnnualPacketRecord(record)) return record;
  const linked = generated.filter(row => String(row.draftDocumentId ?? '') === String(record._id) || String(row.signedDocumentId ?? '') === String(record._id));
  if (linked.some(hasRecordedExecution) || hasRecordedExecution(record)) return record;
  const data = objectJson(record.sourcePayloadJson);
  const legacy = data?.templateProvenance?.templateSnapshot?.preparationOnly !== true;
  if (!legacy) return { ...record, reviewStatus: 'needs_review', preparationReviewWarning: ANNUAL_PREPARATION_WARNING };
  if (!linked.some(legacyUnexecutedAnnual) && !['needs_signature', 'needs_review', 'in_review', 'draft'].includes(String(record.reviewStatus ?? '').toLowerCase())) return record;
  return { ...record, reviewStatus: 'needs_review', preparationReviewWarning: LEGACY_ANNUAL_PREPARATION_WARNING, notes: appendWarning(record.notes) };
}

export function preparationDocumentUpdate(existingJson: unknown, proposedJson: unknown, requestedStatus?: string, existingRecord?: PreparationRecord) {
  const previous = objectJson(existingJson), proposed = objectJson(proposedJson);
  const previousRecord = { ...existingRecord, dataJson: existingJson };
  const legacy = legacyUnexecutedAnnual(previousRecord) || (!existingRecord && legacyUnexecutedAnnual({ dataJson: proposedJson }));
  const preparationOnly = isPreparation(previous) || isPreparation(proposed) || legacy;
  if (preparationOnly && requestedStatus && !['draft', 'needs_review', 'void'].includes(requestedStatus)) {
    throw new Error('This is a preparation draft. Complete the legal and electorate review and create a separate execution document before sending for signatures, signing or finalizing.');
  }
  let dataJson = typeof proposedJson === 'string' && proposedJson.trim() ? proposedJson : typeof existingJson === 'string' ? existingJson : undefined;
  if (isPreparation(previous) || legacy || (isAnnualPacketRecord(previousRecord) && hasRecordedExecution(previousRecord))) {
    if (typeof proposedJson === 'string' && proposedJson.trim() && !proposed) throw new Error('Preparation document data must remain a JSON object with its provenance.');
    // Keep the actual old template unchanged. Review is a separate annotation.
    const provenance = previous?.templateProvenance ?? proposed?.templateProvenance ?? { templateId: 'annual-resolutions', sourceKind: 'legacy_application_draft' };
    dataJson = JSON.stringify({ ...(proposed ?? previous ?? {}), templateProvenance: {
      ...provenance,
      ...(legacy ? { legacyPreparationReview: { required: true, reviewVersion: '2026-10-11', warning: LEGACY_ANNUAL_PREPARATION_WARNING } } : {}),
    } });
  }
  return { preparationOnly, dataJson, legacyAnnualReview: legacy, reviewWarning: legacy ? LEGACY_ANNUAL_PREPARATION_WARNING : undefined };
}
