import type { PortableMutationCtx } from '../portable/ctx';
import { getOwned, requireOwnedRow } from './access';
import { requirePermissionPortable } from './permissions';
import { checkpointResult, decisionReadiness, exactDay, requireEvidence, validateMeetingEvidence, EVIDENCE_FIELDS } from '../evidenceReview';

const FIELDS = EVIDENCE_FIELDS;
export async function saveEvidence(ctx: PortableMutationCtx, { id, evidence }: { id: string; evidence: Record<string, any[]> }) {
  const minutes = await requireOwnedRow(ctx, 'minutes', id);
  const societyId = String(minutes.societyId);
  await requirePermissionPortable(ctx, societyId, 'minutes:write');
  if (minutes.approvedAt) throw new Error('Start an amendment before changing adopted evidence.');
  if (Object.keys(evidence).some(key => !FIELDS.includes(key as any))) throw new Error('Unsupported evidence field.');
  const next: any = { ...minutes, ...evidence };
  validateMeetingEvidence(next);
  for (const old of minutes.consentItems ?? []) {
    if (old.outcome !== 'adopted') continue;
    const replacement = (next.consentItems ?? []).find((row: any) => row.id === old.id);
    if (!replacement || JSON.stringify(replacement) !== JSON.stringify(old)) throw new Error('Adopted consent items are pinned. Preserve the original and append an amendment.');
  }
  for (const row of next.consentItems ?? []) {
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
  // Requirements remain append-only: later ratification must retain the original observation.
  for (const old of minutes.decisionRequirements ?? []) {
    const replacement = (next.decisionRequirements ?? []).find((row: any) => row.id === old.id);
    if (!replacement || JSON.stringify(replacement) !== JSON.stringify(old)) throw new Error('Keep earlier condition observations and append a new dated observation.');
  }
  for (const row of next.futureMeetingSuggestions ?? []) {
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
