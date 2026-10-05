import type { PortableMutationCtx } from '../portable/ctx';
import { getOwned, requireOwnedRow } from './access';
import { requirePermissionPortable } from './permissions';
import { checkpointResult, decisionReadiness, exactDay, partialDate, requireEvidence, uniqueRows } from '../evidenceReview';

const FIELDS = ['consentItems', 'conditionalDecisions', 'decisionRequirements', 'attendanceEvents', 'quorumCheckpoints', 'futureMeetingSuggestions'] as const;
export async function saveEvidence(ctx: PortableMutationCtx, { id, evidence }: { id: string; evidence: Record<string, any[]> }) {
  const minutes = await requireOwnedRow(ctx, 'minutes', id);
  const societyId = String(minutes.societyId);
  await requirePermissionPortable(ctx, societyId, 'minutes:write');
  if (minutes.approvedAt) throw new Error('Start an amendment before changing adopted evidence.');
  if (Object.keys(evidence).some(key => !FIELDS.includes(key as any))) throw new Error('Unsupported evidence field.');
  const next: any = { ...minutes, ...evidence };
  for (const field of FIELDS) {
    const rows = next[field] ?? [];
    if (!Array.isArray(rows) || rows.length > 500) throw new Error('Evidence must be a bounded row list.');
    uniqueRows(rows);
    for (const row of rows) {
      requireEvidence(row);
      if (row.reviewStatus && !['pending', 'verified', 'rejected'].includes(row.reviewStatus)) throw new Error('Invalid evidence review status.');
      if (row.observedDate && !partialDate(row.observedDate)) throw new Error('Invalid evidence date.');
    }
  }
  for (const row of next.quorumCheckpoints ?? []) {
    for (const key of ['eligibleCount', 'required']) if (row[key] != null && (!Number.isSafeInteger(row[key]) || row[key] < 0)) throw new Error('Quorum counts must be nonnegative whole numbers or unknown.');
    if (!String(row.boundary ?? '').trim()) throw new Error('A quorum checkpoint needs a source time or agenda boundary.');
  }
  for (const row of next.attendanceEvents ?? []) {
    if (!['arrived', 'departed', 'present', 'absent', 'proxy'].includes(row.kind)) throw new Error('Invalid attendance event.');
    if (!row.personName || !row.boundary) throw new Error('Attendance needs a person and a source time or agenda boundary.');
  }
  for (const old of minutes.consentItems ?? []) {
    if (old.outcome !== 'adopted') continue;
    const replacement = (next.consentItems ?? []).find((row: any) => row.id === old.id);
    if (!replacement || JSON.stringify(replacement) !== JSON.stringify(old)) throw new Error('Adopted consent items are pinned. Preserve the original and append an amendment.');
  }
  for (const row of next.consentItems ?? []) {
    if (!['adopted', 'deferred', 'excluded', 'pending'].includes(row.outcome)) throw new Error('Invalid consent item outcome.');
    if (row.documentVersionId) await getOwned(ctx, 'documentVersions', row.documentVersionId, societyId);
    if (row.targetMinutesId) await getOwned(ctx, 'minutes', row.targetMinutesId, societyId);
    if (row.outcome === 'adopted') {
      if (row.reviewStatus !== 'verified') throw new Error('Adoption requires verified source evidence for this item.');
      await requirePermissionPortable(ctx, societyId, 'minutes:approve');
      const checkpoint = (next.quorumCheckpoints ?? []).find((item: any) => item.id === row.checkpointId);
      if (!checkpoint || checkpointResult(checkpoint) !== 'confirmed') throw new Error('Adoption needs its own verified decision-time quorum checkpoint.');
      if (!row.documentVersionId && !row.targetMinutesId) throw new Error('Pin the adopted document version or minutes revision.');
      if (!row.adoptedAtMeetingId) {
        row.adoptedAtMeetingId = minutes.meetingId;
        if (row.documentVersionId) {
          const version = await getOwned(ctx, 'documentVersions', row.documentVersionId, societyId);
          if (!version.sha256) throw new Error('The adopted original version needs its content hash.');
          row.pinnedVersion = version;
        } else {
          const target = await getOwned(ctx, 'minutes', row.targetMinutesId, societyId);
          row.pinnedMinutesRevision = JSON.parse(JSON.stringify(target.adoptedSnapshot ?? target));
        }
      } else {
        const old = (minutes.consentItems ?? []).find((item: any) => item.id === row.id);
        if (!old || JSON.stringify(old) !== JSON.stringify(row)) throw new Error('Adoption pins are created by the server.');
      }
    }
  }
  for (const row of next.decisionRequirements ?? []) {
    if (!(next.conditionalDecisions ?? []).some((decision: any) => decision.id === row.decisionId)) throw new Error('A requirement must link to a recorded decision.');
    if (!['condition', 'ratification'].includes(row.kind) || !['met', 'not_met', 'unknown'].includes(row.state)) throw new Error('Invalid condition or ratification.');
  }
  // Requirements remain append-only: later ratification must retain the original observation.
  for (const old of minutes.decisionRequirements ?? []) {
    const replacement = (next.decisionRequirements ?? []).find((row: any) => row.id === old.id);
    if (!replacement || JSON.stringify(replacement) !== JSON.stringify(old)) throw new Error('Keep earlier condition observations and append a new dated observation.');
  }
  for (const row of next.futureMeetingSuggestions ?? []) {
    if (!partialDate(row.date)) throw new Error('Future meeting dates must retain day/month/year precision.');
    if (!['tentative', 'tbc', 'confirmed'].includes(row.status)) throw new Error('Invalid suggestion status.');
    if (row.committeeId) await getOwned(ctx, 'committees', row.committeeId, societyId);
    const old = (minutes.futureMeetingSuggestions ?? []).find((item: any) => item.id === row.id);
    if (old?.scheduledMeetingId && JSON.stringify(row) !== JSON.stringify(old)) throw new Error('A scheduled suggestion is pinned to its target.');
    if (row.scheduledMeetingId && row.scheduledMeetingId !== old?.scheduledMeetingId) throw new Error('Use the scheduling operation to link a target.');
  }
  await ctx.db.patch(id, evidence);
  return (next.conditionalDecisions ?? []).map((row: any) => ({ id: row.id, readiness: decisionReadiness(row, next.decisionRequirements ?? [], next.quorumCheckpoints ?? []) }));
}

export async function scheduleSuggestions(ctx: PortableMutationCtx, { id, suggestionIds }: { id: string; suggestionIds: string[] }) {
  const minutes = await requireOwnedRow(ctx, 'minutes', id);
  const societyId = String(minutes.societyId);
  await requirePermissionPortable(ctx, societyId, 'meetings:write');
  await requirePermissionPortable(ctx, societyId, 'minutes:write');
  if (minutes.approvedAt) throw new Error('Start an amendment before adding scheduling links to adopted minutes.');
  const rows = minutes.futureMeetingSuggestions ?? [];
  const selected = rows.filter((row: any) => suggestionIds.includes(row.id));
  if (new Set(suggestionIds).size !== selected.length || !selected.length) throw new Error('Select recorded meeting suggestions.');
  // Check every row before creating the first target.
  for (const row of selected) {
    if (row.scheduledMeetingId) { await getOwned(ctx, 'meetings', row.scheduledMeetingId, societyId); continue; }
    requireEvidence(row);
    if (row.reviewStatus !== 'verified' || row.status !== 'confirmed' || !exactDay(row.date)) throw new Error('Only confirmed, reviewed exact-day suggestions may schedule meetings.');
    if (typeof row.scheduledAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:Z|[+-]\d{2}:\d{2})$/.test(row.scheduledAt) || !Number.isFinite(Date.parse(row.scheduledAt)) || row.scheduledAt.slice(0,10) !== row.date) throw new Error('Record the source time and timezone; a day alone cannot supply the actual meeting time.');
    if (row.committeeId) await getOwned(ctx, 'committees', row.committeeId, societyId);
  }
  for (const row of selected) {
    if (row.scheduledMeetingId) continue;
    row.scheduledMeetingId = await ctx.db.insert('meetings', {
      societyId, title: row.title || row.committee || 'Scheduled source meeting', type: row.type || 'Board',
      scheduledAt: row.scheduledAt, location: row.venue, committeeId: row.committeeId, electronic: false, status: 'Scheduled', attendeeIds: [],
      notes: `Scheduled from suggestion ${row.id}. ${row.sourceUrl} — ${row.sourceReference}`,
    });
  }
  await ctx.db.patch(id, { futureMeetingSuggestions: rows });
  return selected.map((row: any) => row.scheduledMeetingId);
}
