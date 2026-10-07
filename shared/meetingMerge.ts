/**
 * Duplicate meeting detection and merge planning (ui-meetings F17, audit
 * "duplicates and merges").
 *
 * Imports created one meeting per source variant (.doc/.pdf, DRAFT/APPROVED,
 * "copy"), so one real meeting can exist several times. A duplicate is another
 * meeting of the same body on the same calendar day. Merging folds the
 * duplicate's minutes into the kept meeting as an `importedSourceVersions`
 * entry (with a JSON snapshot of its content), moves motions that the kept
 * meeting lacks, and re-points everything that referenced the duplicate.
 *
 * Pure module: the portable mutation applies the plan.
 */
import { bodyKeyForMeeting } from "./meetingBody";
import { meetingCalendarDate } from "./meetingDates";
import { normalizePersonKey } from "./meetingAttendanceGrid";

export type MergeMeetingLike = {
  _id: string;
  title?: string;
  type?: string;
  scheduledAt?: string;
  scheduledAtPrecision?: string;
  timeZone?: string;
  committeeId?: string | null;
  hostBody?: string | null;
  externalOrganization?: string | null;
  special?: boolean | null;
  status?: string;
  location?: string;
  sourceTitle?: string;
};

export type MergeCommitteeLike = { _id: string; name?: string; bodyKey?: string | null };

/** "2013-05-14|committee:executive" — or "" when the meeting has no date. */
export function meetingDuplicateKey(meeting: MergeMeetingLike, committees: readonly MergeCommitteeLike[] = []): string {
  const day = meetingCalendarDate(meeting as any);
  if (!day) return "";
  const committee = meeting.committeeId ? committees.find((row) => String(row._id) === String(meeting.committeeId)) ?? null : null;
  const body = bodyKeyForMeeting(meeting as any, committee as any);
  return `${day}|${body}${meeting.special ? ":special" : ""}`;
}

export type DuplicateGroup<T> = { key: string; date: string; body: string; meetings: T[] };

/** Groups of two or more meetings of one body on one day, oldest day first. */
export function duplicateMeetingGroups<T extends MergeMeetingLike>(meetings: readonly T[], committees: readonly MergeCommitteeLike[] = []): DuplicateGroup<T>[] {
  const byKey = new Map<string, T[]>();
  for (const meeting of meetings) {
    if (meeting.status === "Cancelled") continue;
    const key = meetingDuplicateKey(meeting, committees);
    if (!key) continue;
    const list = byKey.get(key) ?? [];
    list.push(meeting);
    byKey.set(key, list);
  }
  return [...byKey.entries()]
    .filter(([, list]) => list.length > 1)
    .map(([key, list]) => {
      const [date, body] = key.split("|");
      return { key, date, body, meetings: list };
    })
    .sort((a, b) => a.date.localeCompare(b.date) || a.body.localeCompare(b.body));
}

/** Map meetingId → ids of its same-day same-body duplicates. */
export function duplicateIndex<T extends MergeMeetingLike>(meetings: readonly T[], committees: readonly MergeCommitteeLike[] = []): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const group of duplicateMeetingGroups(meetings, committees)) {
    for (const meeting of group.meetings) {
      out.set(String(meeting._id), group.meetings.filter((row) => row._id !== meeting._id).map((row) => String(row._id)));
    }
  }
  return out;
}

export function normalizeMotionText(value: unknown): string {
  return String(value ?? "").toLowerCase().replace(/[^a-z0-9$]+/g, " ").trim().slice(0, 160);
}

export type MergeMotionLike = { _id?: string; text?: string; name?: string; outcome?: string };

export type MergePlan = {
  versionId: string;
  versionLabel: string;
  versionStatus: "draft" | "unknown" | "revised";
  sourceExternalIdsAdded: string[];
  sourceDocumentIdsAdded: string[];
  motionsToMove: string[];
  motionsDuplicate: string[];
  attendeesOnlyInDuplicate: string[];
  duplicateSectionCount: number;
  duplicateHasMinutes: boolean;
  targetHasMinutes: boolean;
  /** When the kept meeting has no minutes, the duplicate's minutes move over whole. */
  moveMinutesWhole: boolean;
  blockers: string[];
  warnings: string[];
};

function uniq(values: unknown[]): string[] {
  return [...new Set(values.map((value) => String(value ?? "")).filter(Boolean))];
}

/** Plan folding `duplicate` into `target`. Pure; no ids are generated here. */
export function planMeetingMerge(args: {
  target: MergeMeetingLike;
  duplicate: MergeMeetingLike;
  targetMinutes?: any | null;
  duplicateMinutes?: any | null;
  targetMotions?: readonly MergeMotionLike[];
  duplicateMotions?: readonly MergeMotionLike[];
  committees?: readonly MergeCommitteeLike[];
}): MergePlan {
  const { target, duplicate, targetMinutes, duplicateMinutes } = args;
  const blockers: string[] = [];
  const warnings: string[] = [];
  if (String(target._id) === String(duplicate._id)) blockers.push("Choose a different meeting to merge.");
  if (targetMinutes?.approvedAt || targetMinutes?.adoptedSnapshot) blockers.push("The kept meeting's minutes are approved. Clear the approval before merging another version into them.");
  if (duplicateMinutes?.approvedAt || duplicateMinutes?.adoptedSnapshot) blockers.push("The duplicate's minutes are approved. Keep the approved meeting and merge the other one into it.");
  const committees = args.committees ?? [];
  const targetKey = meetingDuplicateKey(target, committees);
  const duplicateKey = meetingDuplicateKey(duplicate, committees);
  if (targetKey && duplicateKey && targetKey !== duplicateKey) {
    const [targetDay, targetBody] = targetKey.split("|");
    const [duplicateDay, duplicateBody] = duplicateKey.split("|");
    if (targetDay !== duplicateDay) warnings.push(`The meetings are on different days (${targetDay} and ${duplicateDay}).`);
    if (targetBody !== duplicateBody) warnings.push(`The meetings are of different bodies (${targetBody} and ${duplicateBody}).`);
  }
  const targetIds = new Set(uniq(targetMinutes?.sourceExternalIds ?? []));
  const targetDocs = new Set(uniq(targetMinutes?.sourceDocumentIds ?? []));
  const sourceExternalIdsAdded = uniq(duplicateMinutes?.sourceExternalIds ?? []).filter((id) => !targetIds.has(id));
  const sourceDocumentIdsAdded = uniq(duplicateMinutes?.sourceDocumentIds ?? []).filter((id) => !targetDocs.has(id));
  const targetMotionKeys = new Set((args.targetMotions ?? []).map((motion) => normalizeMotionText(motion.text || motion.name)).filter(Boolean));
  const motionsToMove: string[] = [];
  const motionsDuplicate: string[] = [];
  for (const motion of args.duplicateMotions ?? []) {
    const key = normalizeMotionText(motion.text || motion.name);
    const id = String(motion._id ?? "");
    if (!id) continue;
    if (key && targetMotionKeys.has(key)) motionsDuplicate.push(id);
    else {
      motionsToMove.push(id);
      if (key) targetMotionKeys.add(key);
    }
  }
  const targetNames = new Set([
    ...(targetMinutes?.attendees ?? []),
    ...(targetMinutes?.absent ?? []),
    ...((targetMinutes?.detailedAttendance ?? []) as any[]).map((row) => row?.name),
  ].map(normalizePersonKey).filter(Boolean));
  const attendeesOnlyInDuplicate = uniq([
    ...(duplicateMinutes?.attendees ?? []),
    ...((duplicateMinutes?.detailedAttendance ?? []) as any[]).map((row) => row?.name),
  ]).filter((name) => !targetNames.has(normalizePersonKey(name)));
  const label = String(duplicate.sourceTitle || duplicate.title || "Merged duplicate");
  const versionStatus: MergePlan["versionStatus"] = /\bdraft\b/i.test(label.replace(/_/g, " ")) ? "draft" : "unknown";
  return {
    versionId: `merged:${duplicate._id}`,
    versionLabel: label,
    versionStatus,
    sourceExternalIdsAdded,
    sourceDocumentIdsAdded,
    motionsToMove,
    motionsDuplicate,
    attendeesOnlyInDuplicate,
    duplicateSectionCount: Array.isArray(duplicateMinutes?.sections) ? duplicateMinutes.sections.length : 0,
    duplicateHasMinutes: !!duplicateMinutes,
    targetHasMinutes: !!targetMinutes,
    moveMinutesWhole: !targetMinutes && !!duplicateMinutes,
    blockers,
    warnings,
  };
}

/** JSON snapshot of the duplicate kept inside the version entry (no source documents' text). */
export function mergedVersionContent(duplicate: MergeMeetingLike & Record<string, any>, minutes: any | null | undefined, motions: readonly any[] = []): string {
  const pick = (row: any, keys: string[]) => Object.fromEntries(keys.filter((key) => row?.[key] !== undefined).map((key) => [key, row[key]]));
  const sourceRecord = minutes?.sourceMeetingRecord
    ? { ...minutes.sourceMeetingRecord, documents: (minutes.sourceMeetingRecord.documents ?? []).map((doc: any) => pick(doc, ["documentId", "title", "sourceReference"])) }
    : undefined;
  return JSON.stringify({
    mergedAtISO: new Date().toISOString(),
    meeting: pick(duplicate, ["_id", "title", "sourceTitle", "type", "scheduledAt", "scheduledAtPrecision", "localStartText", "localEndText", "timeZone", "location", "electronic", "status", "committeeId", "notes", "sourceReviewStatus"]),
    minutes: minutes
      ? {
          ...pick(minutes, ["_id", "heldAt", "attendees", "absent", "detailedAttendance", "discussion", "sections", "decisions", "actionItems", "chairName", "secretaryName", "recorderName", "calledToOrderAt", "adjournedAt", "quorumStatus", "quorumMet", "nextMeetingAt", "nextMeetings", "sourceExternalIds", "sourceDocumentIds", "sourceReviewStatus", "sourceReviewNotes", "draftTranscript"]),
          sourceMeetingRecord: sourceRecord,
        }
      : null,
    motions: motions.map((motion) => pick(motion, ["_id", "name", "text", "outcome", "status", "movedBy", "secondedBy", "votesFor", "votesAgainst", "abstentions", "sourceOutcomeText"])),
  });
}

/**
 * Which copy of a same-day group to keep by default: an approved or final
 * version over a draft, then minutes already approved in the app, then the
 * one with the most recorded sections and motions.
 */
export function preferredMeetingToKeep<T extends { _id: unknown; sourceTitle?: unknown; title?: unknown }>(
  meetings: readonly T[],
  summary: (meeting: T) => { approvedAt?: unknown; sectionCount?: number; motionCount?: number } | undefined,
): T | undefined {
  const score = (meeting: T) => {
    const label = String(meeting.sourceTitle ?? meeting.title ?? "").replace(/_/g, " ");
    const info = summary(meeting) ?? {};
    return (/\b(?:approved|final|adopted|signed)\b/i.test(label) ? 1000 : 0)
      - (/\bdraft\b/i.test(label) ? 500 : 0)
      + (info.approvedAt ? 2000 : 0)
      + (info.sectionCount ?? 0) + 2 * (info.motionCount ?? 0);
  };
  return [...meetings].sort((a, b) => score(b) - score(a))[0];
}
