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
export function requireEvidence(row: any) {
  if (!evidenceUrl(row.sourceUrl) || !String(row.sourceReference ?? '').trim()) throw new Error('Record a source URL and a page, section or cell citation.');
}
export function uniqueRows(rows: any[]) {
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
