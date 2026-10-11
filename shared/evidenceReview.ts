/** Evidence helpers preserve unknown values and partial date precision. */
export function exactDay(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,10) === value;
}
export function partialDate(value: unknown): boolean {
  if (value === '' || value == null) return true;
  if (typeof value !== 'string') return false;
  if (/^\d{4}$/.test(value)) return Number(value) >= 1;
  if (/^\d{4}-\d{2}$/.test(value)) return Number(value.slice(5)) >= 1 && Number(value.slice(5)) <= 12;
  return exactDay(value);
}
export function evidenceUrl(value: unknown): boolean {
  try { return ['https:', 'http:'].includes(new URL(String(value)).protocol); } catch { return false; }
}
export function requireEvidence(row: Record<string, unknown>) {
  const externalIds = row.sourceExternalIds;
  if (externalIds != null && (!Array.isArray(externalIds) || externalIds.some(id => typeof id !== 'string' || !id.trim()) || new Set(externalIds).size !== externalIds.length)) throw new Error('Invalid source external IDs.');
  const alternate = row.reviewStatus !== 'verified' && Array.isArray(externalIds) && externalIds.length > 0;
  if ((!evidenceUrl(row.sourceUrl) && !alternate) || typeof row.sourceReference !== 'string' || !row.sourceReference.trim()) throw new Error('Record a source URL (or external IDs for unverified evidence) and a page, section or cell citation.');
}
export function uniqueRows(rows: Record<string, unknown>[]) {
  const ids = rows.map(row => row.id);
  if (ids.some(id => typeof id !== 'string' || !id.trim()) || new Set(ids).size !== ids.length) throw new Error('Each evidence row needs a distinct stable ID.');
}
export function checkpointResult(row: any): 'confirmed' | 'not_met' | 'unknown' | 'conflict' {
  if (row.reviewStatus !== 'verified') return 'unknown';
  const countKnown = Number.isSafeInteger(row.eligibleCount) && row.eligibleCount >= 0;
  const thresholdKnown = Number.isSafeInteger(row.required) && row.required > 0;
  if (!countKnown || !thresholdKnown) return 'unknown';
  const result = row.eligibleCount >= row.required ? 'confirmed' : 'not_met';
  return ['confirmed', 'not_met'].includes(row.assertion) && row.assertion !== result ? 'conflict' : result;
}
export function decisionReadiness(decision: any, requirements: any[], checkpoints: any[]) {
  if (decision.outcome !== 'Carried') return decision.outcome || 'Unknown';
  if (decision.reviewStatus !== 'verified') return 'Pending source review';
  const checkpoint = checkpoints.find(row => row.id === decision.checkpointId);
  if (!checkpoint || checkpointResult(checkpoint) !== 'confirmed') return 'Pending quorum review';
  const required = requirements.filter(row => row.decisionId === decision.id && row.required !== false);
  const keys = new Set(required.map(row => row.requirementKey || row.id));
  for (const key of keys) {
    const observations = required.filter(row => (row.requirementKey || row.id) === key);
    const latestDate = observations.map(row => row.observedDate || '').sort().at(-1);
    const latest = observations.filter(row => row.observedDate === latestDate);
    if (!latest.length || latest.some(row => row.state !== 'met' || row.reviewStatus !== 'verified' || !exactDay(row.observedDate))) return 'Pending conditions or ratification';
  }
  return 'Effective';
}

export const EVIDENCE_FIELDS = ['consentItems', 'conditionalDecisions', 'decisionRequirements', 'attendanceEvents', 'quorumCheckpoints', 'futureMeetingSuggestions'] as const;
export type EvidenceField = typeof EVIDENCE_FIELDS[number];
export type EvidenceRow = Record<string, unknown> & { id: string; sourceUrl?: string; sourceReference: string; sourceExternalIds?: string[]; reviewStatus?: 'pending' | 'verified' | 'rejected' };
export type QuorumCheckpoint = EvidenceRow & {
  boundary: string; eligibleCount?: number; required?: number; assertion?: 'confirmed' | 'not_met' | 'not_recorded';
  eligiblePopulation?: number; atTime?: string; scope?: 'meeting' | 'session' | 'item'; scopeLabel?: string; reason?: string; evidence?: string;
};
export type MeetingEvidence = Partial<Record<EvidenceField, EvidenceRow[]>>;
const rowObject = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const nonempty = (value: unknown): value is string => typeof value === 'string' && !!value.trim();
const oneOf = (value: unknown, choices: readonly string[]): boolean => typeof value === 'string' && choices.includes(value);
/** Consent-agenda outcomes. A10: `received` records a report or another body's
 * minutes taken as read ("Group action: Receive") without adopting it. */
export const CONSENT_ITEM_OUTCOMES = ['pending', 'adopted', 'received', 'deferred', 'excluded'] as const;
export function validateMeetingEvidence(value: Record<string, unknown>): MeetingEvidence {
  const out: MeetingEvidence = {};
  for (const field of EVIDENCE_FIELDS) {
    if (value[field] === undefined) continue;
    const rows = value[field];
    if (!Array.isArray(rows) || rows.length > 500 || rows.some(row => !rowObject(row))) throw new Error('Evidence must be a bounded row list.');
    const records = rows as Record<string, unknown>[];
    uniqueRows(records);
    for (const row of records) {
      requireEvidence(row);
      if (row.reviewStatus != null && !oneOf(row.reviewStatus, ['pending', 'verified', 'rejected'])) throw new Error('Invalid evidence review status.');
      if (row.observedDate != null && !partialDate(row.observedDate)) throw new Error('Invalid evidence date.');
      if (field === 'quorumCheckpoints') {
        for (const key of ['eligibleCount', 'required', 'eligiblePopulation']) if (row[key] != null && (typeof row[key] !== 'number' || !Number.isSafeInteger(row[key]) || row[key] < 0)) throw new Error('Quorum counts must be nonnegative whole numbers or unknown.');
        if (!nonempty(row.boundary)) throw new Error('A quorum checkpoint needs a source time or agenda boundary.');
        if (row.assertion != null && !oneOf(row.assertion, ['confirmed', 'not_met', 'not_recorded'])) throw new Error('Invalid quorum assertion.');
        if (row.scope != null && !oneOf(row.scope, ['meeting', 'session', 'item'])) throw new Error('Invalid quorum scope.');
        if (row.scope && row.scope !== 'meeting' && !nonempty(row.scopeLabel)) throw new Error('Session and item checkpoints need a scopeLabel.');
        for (const key of ['atTime', 'scopeLabel', 'reason', 'evidence']) if (row[key] != null && !nonempty(row[key])) throw new Error(`Invalid checkpoint ${key}.`);
      }
      if (field === 'attendanceEvents') {
        if (!oneOf(row.kind, ['arrived', 'departed', 'present', 'absent', 'proxy'])) throw new Error('Invalid attendance event.');
        if (!nonempty(row.personName) || !nonempty(row.boundary)) throw new Error('Attendance needs a person and a source time or agenda boundary.');
      }
      if (field === 'consentItems' && !oneOf(row.outcome, CONSENT_ITEM_OUTCOMES)) throw new Error('Invalid consent item outcome.');
      if (field === 'decisionRequirements') {
        if (!oneOf(row.kind, ['condition', 'ratification']) || !oneOf(row.state, ['met', 'not_met', 'unknown'])) throw new Error('Invalid condition or ratification.');
        if (!Array.isArray(value.conditionalDecisions) || !value.conditionalDecisions.some(decision => rowObject(decision) && decision.id === row.decisionId)) throw new Error('A requirement must link to a recorded decision.');
      }
      if (field === 'futureMeetingSuggestions') {
        if (!partialDate(row.date)) throw new Error('Future meeting dates must retain day/month/year precision.');
        if (!oneOf(row.status, ['tentative', 'tbc', 'confirmed'])) throw new Error('Invalid suggestion status.');
      }
    }
    out[field] = records as EvidenceRow[];
  }
  return out;
}
/** Generic drafting cannot bypass adoption pins, observation history or scheduling. */
export function validateGenericEvidence(patch: Record<string, unknown>, existing: Record<string, unknown> = {}): MeetingEvidence {
  for (const field of ['consentItems', 'decisionRequirements', 'futureMeetingSuggestions'] as const) {
    if (patch[field] !== undefined && JSON.stringify(patch[field]) !== JSON.stringify(existing[field] ?? [])) throw new Error(`Use minutesReview:saveEvidence to change ${field}.`);
  }
  if (EVIDENCE_FIELDS.some(field => patch[field] !== undefined)) validateMeetingEvidence({ ...existing, ...patch });
  return Object.fromEntries(EVIDENCE_FIELDS.filter(field => patch[field] !== undefined).map(field => [field, patch[field]])) as MeetingEvidence;
}
export function normalizeImportedEvidence(value: Record<string, unknown>, sourceUrls: ReadonlyMap<string, string> = new Map()): MeetingEvidence {
  const out: MeetingEvidence = {};
  for (const field of EVIDENCE_FIELDS) {
    if (value[field] === undefined) continue;
    const rows = value[field];
    if (!Array.isArray(rows)) throw new Error('Evidence must be a bounded row list.');
    out[field] = rows.map(raw => {
      if (!rowObject(raw)) throw new Error('Evidence must be a bounded row list.');
      const row = { ...raw, reviewStatus: 'pending' } as Record<string, unknown>;
      const ids = row.sourceExternalIds ?? value.sourceExternalIds;
      if (row.sourceExternalIds === undefined && ids !== undefined) row.sourceExternalIds = ids;
      if (!evidenceUrl(row.sourceUrl) && Array.isArray(ids)) {
        const url = ids.map(id => sourceUrls.get(String(id))).find(evidenceUrl);
        if (url) row.sourceUrl = url;
      }
      if (field === 'quorumCheckpoints' && !row.boundary) row.boundary = [row.scopeLabel, row.atTime].filter(nonempty).join(', ') || (row.scope === 'meeting' ? 'Meeting' : undefined);
      if (field === 'consentItems' && (row.outcome === 'adopted' || ['adoptedAtMeetingId', 'pinnedVersion', 'pinnedMinutesRevision'].some(key => row[key] != null))) throw new Error('Imports cannot adopt consent items or create adoption pins. Record a pending source assertion.');
      if (field === 'futureMeetingSuggestions' && row.scheduledMeetingId) throw new Error('Imports cannot create scheduling links.');
      return row as EvidenceRow;
    });
  }
  return validateMeetingEvidence(out);
}
export function mergeImportedEvidence(existing: Record<string, unknown>, incoming: MeetingEvidence): MeetingEvidence {
  const out: MeetingEvidence = {};
  for (const field of EVIDENCE_FIELDS) {
    if (incoming[field] === undefined) continue;
    const rows = [...(Array.isArray(existing[field]) ? existing[field] : [])] as EvidenceRow[];
    for (const row of incoming[field] ?? []) {
      const index = rows.findIndex(old => old.id === row.id);
      if (index < 0) rows.push(row);
      else if (JSON.stringify(rows[index]) !== JSON.stringify(row) && rows[index].reviewStatus !== 'verified') throw new Error(`${field}: conflicting evidence identity ${row.id}`);
    }
    out[field] = rows;
  }
  validateMeetingEvidence({ ...existing, ...out });
  return out;
}
