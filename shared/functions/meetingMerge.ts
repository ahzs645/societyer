/**
 * Merge a duplicate meeting into the meeting that is kept (ui-meetings F17).
 *
 * `meetings:mergePreview` reports what would change; `meetings:merge` applies
 * it. The duplicate's minutes become an `importedSourceVersions` entry on the
 * kept minutes (with a JSON snapshot), motions the kept meeting lacks move
 * over, and every record that pointed at the duplicate meeting or minutes is
 * re-pointed before the duplicate is deleted. Approved minutes are never
 * merged.
 */
import type { PortableMutationCtx, PortableQueryCtx } from "../portable/ctx";
import { getOwned, requireOwnedRow } from "./access";
import { requirePermissionPortable } from "./permissions";
import { mergedVersionContent, planMeetingMerge, type MergePlan } from "../meetingMerge";
import { meetingCalendarDate } from "../meetingDates";
import { normalizePersonKey } from "../meetingAttendanceGrid";

type MergeArgs = { targetId: string; duplicateId: string; addMissingAttendees?: boolean };

/** Tables whose meeting / minutes references are re-pointed. */
const MEETING_REFS: Array<[string, string[]]> = [
  ["communicationCampaigns", ["meetingId"]],
  ["communicationDeliveries", ["meetingId"]],
  ["commitmentEvents", ["meetingId"]],
  ["documents", ["meetingId"]],
  ["meetingMaterials", ["meetingId"]],
  ["memberProposals", ["meetingId"]],
  ["elections", ["meetingId"]],
  ["bylawAmendments", ["resolutionMeetingId"]],
  ["proxies", ["meetingId"]],
  ["continuityPeriodMarks", ["meetingId"]],
  ["motions", ["primaryMeetingId", "targetMeetingId"]],
  ["minuteBookItems", ["meetingId"]],
  ["minutes", ["approvedInMeetingId"]],
  ["meetingAttendanceRecords", ["meetingId"]],
  ["motionEvidence", ["meetingId"]],
  ["boardRoleChanges", ["meetingId"]],
  ["policies", ["adoptedAtMeetingId"]],
  ["conflicts", ["meetingId"]],
  ["financials", ["presentedAtMeetingId"]],
  ["tasks", ["meetingId"]],
  ["agmRuns", ["meetingId"]],
  ["noticeDeliveries", ["meetingId"]],
  ["transcripts", ["meetingId"]],
  ["transcriptionJobs", ["meetingId"]],
  ["assets", ["disposalApprovedMeetingId"]],
  ["personOccurrences", ["meetingId"]],
];
const MINUTES_REFS: Array<[string, string[]]> = [
  ["motions", ["minutesId", "adoptsMinutesId", "sourceMinutesId"]],
  ["minuteBookItems", ["minutesId"]],
  ["meetingAttendanceRecords", ["minutesId"]],
  ["motionEvidence", ["minutesId"]],
  ["boardRoleChanges", ["minutesId"]],
  ["policies", ["adoptedInMinutesId"]],
];

/**
 * Rows of `table` whose `fields` hold `id`. The match runs in the read-only
 * query predicate and keeps no rows, so the local runtime never deep-copies a
 * whole table (the document library can be >100 MB) just to find a few links.
 */
async function rowsReferencing(ctx: PortableQueryCtx, table: string, societyId: string, fields: string[], id: string) {
  const hits: Array<{ _id: string; fields: string[] }> = [];
  await ctx.db
    .query(table as any)
    .withIndex("by_society", (q: any) => q.eq("societyId", societyId))
    .filter((row: any) => {
      const matched = fields.filter((field) => String(row[field] ?? "") === id);
      if (matched.length) hits.push({ _id: String(row._id), fields: matched });
      return false;
    })
    .collect();
  return hits;
}

async function minutesFor(ctx: PortableQueryCtx, meetingId: string) {
  return (await ctx.db.query("minutes").withIndex("by_meeting", (q) => q.eq("meetingId", meetingId)).first()) as any;
}

async function motionRowsFor(ctx: PortableQueryCtx, minutes: any): Promise<any[]> {
  if (!minutes) return [];
  const ids: string[] = Array.isArray(minutes.motionIds) ? minutes.motionIds.map(String) : [];
  const rows = await Promise.all(ids.map((id) => ctx.db.get(id, "motions")));
  return rows.filter((row: any) => row && row.societyId === minutes.societyId);
}

async function loadPair(ctx: PortableQueryCtx, args: MergeArgs) {
  const target: any = await requireOwnedRow(ctx, "meetings", args.targetId);
  const societyId = String(target.societyId);
  const duplicate: any = await getOwned(ctx, "meetings", args.duplicateId, societyId);
  const [targetMinutes, duplicateMinutes, committees] = await Promise.all([
    minutesFor(ctx, target._id),
    minutesFor(ctx, duplicate._id),
    ctx.db.query("committees").withIndex("by_society", (q) => q.eq("societyId", societyId)).collect(),
  ]);
  const [targetMotions, duplicateMotions] = await Promise.all([motionRowsFor(ctx, targetMinutes), motionRowsFor(ctx, duplicateMinutes)]);
  const plan = planMeetingMerge({
    target, duplicate, targetMinutes, duplicateMinutes, targetMotions, duplicateMotions,
    committees: committees.map((row: any) => ({ _id: String(row._id), name: row.name, bodyKey: row.bodyKey })),
  });
  return { societyId, target, duplicate, targetMinutes, duplicateMinutes, targetMotions, duplicateMotions, plan };
}

export type MergePreview = MergePlan & {
  target: { _id: string; title: string; date?: string; status?: string; sourceTitle?: string };
  duplicate: { _id: string; title: string; date?: string; status?: string; sourceTitle?: string };
  references: Record<string, number>;
};

async function countReferences(ctx: PortableQueryCtx, societyId: string, duplicateId: string, duplicateMinutesId?: string) {
  const counts: Record<string, number> = {};
  for (const [table, fields] of MEETING_REFS) {
    const n = (await rowsReferencing(ctx, table, societyId, fields, duplicateId)).length;
    if (n) counts[table] = (counts[table] ?? 0) + n;
  }
  if (duplicateMinutesId) {
    for (const [table, fields] of MINUTES_REFS) {
      const n = (await rowsReferencing(ctx, table, societyId, fields, duplicateMinutesId)).length;
      if (n) counts[table] = (counts[table] ?? 0) + n;
    }
  }
  return counts;
}

export async function mergePreviewPortable(ctx: PortableQueryCtx, args: MergeArgs): Promise<MergePreview> {
  const pair = await loadPair(ctx, args);
  const references = await countReferences(ctx, pair.societyId, String(pair.duplicate._id), pair.duplicateMinutes ? String(pair.duplicateMinutes._id) : undefined);
  // Copies usually share a generated title; the source file tells them apart.
  const describe = (meeting: any) => ({ _id: String(meeting._id), title: String(meeting.title ?? ""), date: meetingCalendarDate(meeting), status: meeting.status, ...(meeting.sourceTitle ? { sourceTitle: String(meeting.sourceTitle) } : {}) });
  return { ...pair.plan, target: describe(pair.target), duplicate: describe(pair.duplicate), references };
}

const MAX_SNAPSHOT_CHARS = 400_000;

export async function mergePortable(ctx: PortableMutationCtx, args: MergeArgs) {
  const pair = await loadPair(ctx, args);
  const { societyId, target, duplicate, targetMinutes, duplicateMinutes, duplicateMotions, plan } = pair;
  for (const permission of ["meetings:write", "minutes:write", "motions:write", "agendas:write"] as const) {
    await requirePermissionPortable(ctx, societyId, permission);
  }
  if (plan.blockers.length) throw new Error(plan.blockers[0]);
  const now = new Date().toISOString();
  const duplicateId = String(duplicate._id);
  const targetId = String(target._id);
  const duplicateMinutesId = duplicateMinutes ? String(duplicateMinutes._id) : undefined;
  let keptMinutesId = targetMinutes ? String(targetMinutes._id) : undefined;
  let motionsMoved = 0;
  let motionsDropped = 0;

  if (duplicateMinutes && targetMinutes) {
    let contentJson = mergedVersionContent(duplicate, duplicateMinutes, duplicateMotions);
    if (contentJson.length > MAX_SNAPSHOT_CHARS) contentJson = mergedVersionContent(duplicate, { ...duplicateMinutes, sourceMeetingRecord: undefined }, duplicateMotions);
    if (contentJson.length > MAX_SNAPSHOT_CHARS) contentJson = JSON.stringify({ truncated: true, meeting: { _id: duplicateId, title: duplicate.title } });
    const existingVersions: any[] = Array.isArray(targetMinutes.importedSourceVersions) ? targetMinutes.importedSourceVersions : [];
    const carried: any[] = Array.isArray(duplicateMinutes.importedSourceVersions) ? duplicateMinutes.importedSourceVersions : [];
    const versionIds = new Set(existingVersions.map((row) => String(row.versionId)));
    const versions = [...existingVersions];
    for (const row of carried) {
      if (versionIds.has(String(row.versionId))) continue;
      versionIds.add(String(row.versionId));
      versions.push({ ...row, adoptedInMeetingId: row.adoptedInMeetingId && String(row.adoptedInMeetingId) === duplicateId ? targetId : row.adoptedInMeetingId });
    }
    if (!versionIds.has(plan.versionId)) {
      versions.push({
        versionId: plan.versionId,
        label: plan.versionLabel,
        status: plan.versionStatus,
        sourceExternalIds: (duplicateMinutes.sourceExternalIds ?? []).map(String),
        sourceDate: meetingCalendarDate(duplicate),
        notes: `Merged from duplicate meeting “${duplicate.title}” on ${now.slice(0, 10)}.`,
        contentJson,
      });
    }
    const patch: Record<string, unknown> = {
      importedSourceVersions: versions,
      sourceExternalIds: [...new Set([...(targetMinutes.sourceExternalIds ?? []), ...(duplicateMinutes.sourceExternalIds ?? [])].map(String))],
      sourceDocumentIds: [...new Set([...(targetMinutes.sourceDocumentIds ?? []), ...(duplicateMinutes.sourceDocumentIds ?? [])].map(String))],
    };
    // Motions the kept meeting lacks move over; exact duplicates are dropped
    // (their wording and outcome stay in the version snapshot).
    const moveIds = new Set(plan.motionsToMove);
    const motionIds: string[] = Array.isArray(targetMinutes.motionIds) ? targetMinutes.motionIds.map(String) : [];
    for (const motion of duplicateMotions) {
      const id = String(motion._id);
      if (moveIds.has(id)) {
        await ctx.db.patch(id, { minutesId: targetMinutes._id, ...(String(motion.primaryMeetingId ?? "") === duplicateId ? { primaryMeetingId: target._id } : {}) });
        motionIds.push(id);
        motionsMoved += 1;
      } else {
        await ctx.db.delete(id);
        motionsDropped += 1;
      }
    }
    if (motionsMoved) patch.motionIds = motionIds;
    if (args.addMissingAttendees && plan.attendeesOnlyInDuplicate.length) {
      const additions = new Set(plan.attendeesOnlyInDuplicate.map(normalizePersonKey));
      const detailed: any[] = Array.isArray(targetMinutes.detailedAttendance) ? [...targetMinutes.detailedAttendance] : [];
      const fromDuplicate: any[] = Array.isArray(duplicateMinutes.detailedAttendance) && duplicateMinutes.detailedAttendance.length
        ? duplicateMinutes.detailedAttendance
        : (duplicateMinutes.attendees ?? []).map((name: string) => ({ name, status: "present", quorumCounted: true }));
      const added = fromDuplicate.filter((row) => additions.has(normalizePersonKey(row?.name)));
      if (detailed.length) patch.detailedAttendance = [...detailed, ...added];
      patch.attendees = [...(targetMinutes.attendees ?? []), ...added.filter((row) => !["regrets", "absent"].includes(String(row.status))).map((row) => row.name)];
      patch.absent = [...(targetMinutes.absent ?? []), ...added.filter((row) => ["regrets", "absent"].includes(String(row.status))).map((row) => row.name)];
    }
    await ctx.db.patch(targetMinutes._id, patch);
  } else if (duplicateMinutes && !targetMinutes) {
    await ctx.db.patch(duplicateMinutes._id, { meetingId: target._id });
    keptMinutesId = duplicateMinutesId;
    const motions = await motionRowsFor(ctx, duplicateMinutes);
    for (const motion of motions) if (String(motion.primaryMeetingId ?? "") === duplicateId) await ctx.db.patch(motion._id, { primaryMeetingId: target._id });
    motionsMoved = motions.length;
  }

  // Re-point references.
  let referencesMoved = 0;
  for (const [table, fields] of MEETING_REFS) {
    for (const hit of await rowsReferencing(ctx, table, societyId, fields, duplicateId)) {
      await ctx.db.patch(hit._id, Object.fromEntries(hit.fields.map((field) => [field, target._id])));
      referencesMoved += 1;
    }
  }
  if (duplicateMinutesId && keptMinutesId && keptMinutesId !== duplicateMinutesId) {
    for (const [table, fields] of MINUTES_REFS) {
      for (const hit of await rowsReferencing(ctx, table, societyId, fields, duplicateMinutesId)) {
        await ctx.db.patch(hit._id, Object.fromEntries(hit.fields.map((field) => [field, keptMinutesId])));
        referencesMoved += 1;
      }
    }
    const occurrences: any[] = await ctx.db.query("personOccurrences").withIndex("by_record", (q) => q.eq("societyId", societyId).eq("recordTable", "minutes").eq("recordId", duplicateMinutesId)).collect();
    for (const row of occurrences) await ctx.db.patch(row._id, { recordId: keptMinutesId });
    for (const hit of await rowsReferencing(ctx, "signatures", societyId, ["entityId", "subjectId"], duplicateMinutesId)) {
      await ctx.db.patch(hit._id, Object.fromEntries(hit.fields.map((field) => [field, keptMinutesId])));
    }
  }
  for (const [table, oldId, newId] of [["meetings", duplicateId, targetId], ["minutes", duplicateMinutesId, keptMinutesId]] as const) {
    if (!oldId || !newId || oldId === newId) continue;
    const gaps: any[] = await ctx.db.query("representationGaps").withIndex("by_affected", (q) => q.eq("societyId", societyId).eq("affectedTable", table).eq("affectedId", oldId)).collect();
    for (const gap of gaps) await ctx.db.patch(gap._id, { affectedId: newId });
  }

  // Agenda: keep the kept meeting's; adopt the duplicate's only when it has none.
  const targetAgendas: any[] = await ctx.db.query("agendas").withIndex("by_meeting", (q) => q.eq("meetingId", target._id)).collect();
  const duplicateAgendas: any[] = await ctx.db.query("agendas").withIndex("by_meeting", (q) => q.eq("meetingId", duplicate._id)).collect();
  for (const agenda of duplicateAgendas) {
    if (!targetAgendas.length) {
      await ctx.db.patch(agenda._id, { meetingId: target._id });
      targetAgendas.push(agenda);
      continue;
    }
    const items: any[] = await ctx.db.query("agendaItems").withIndex("by_agenda", (q) => q.eq("agendaId", agenda._id)).collect();
    for (const item of items) await ctx.db.delete(item._id);
    await ctx.db.delete(agenda._id);
  }

  if (duplicateMinutes && keptMinutesId !== duplicateMinutesId) await ctx.db.delete(duplicateMinutes._id);
  await ctx.db.delete(duplicate._id);
  if (keptMinutesId && !target.minutesId) await ctx.db.patch(target._id, { minutesId: keptMinutesId });
  const reviewNote = `Merged duplicate “${duplicate.title}” (${meetingCalendarDate(duplicate) ?? "no date"}) on ${now.slice(0, 10)}.`;
  await ctx.db.patch(target._id, { sourceReviewNotes: [target.sourceReviewNotes, reviewNote].filter(Boolean).join("\n") });
  await ctx.db.insert("activity", {
    societyId,
    actor: "You",
    entityType: "meeting",
    subjectId: targetId,
    entityId: targetId,
    action: "merged",
    summary: `Merged duplicate meeting “${duplicate.title}” into “${target.title}”: ${motionsMoved} motion(s) moved, ${referencesMoved} linked record(s) re-pointed.`,
    createdAtISO: now,
  });
  return { targetId, keptMinutesId, motionsMoved, motionsDropped, referencesMoved, versionId: duplicateMinutes && targetMinutes ? plan.versionId : undefined };
}
