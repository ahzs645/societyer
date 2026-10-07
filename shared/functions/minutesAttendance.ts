/**
 * Save a meeting's attendance grid in one transaction (schema B4/B5,
 * ui-meetings F5/F13, ui-people P9).
 *
 * The grid rows are the authority. One save writes:
 *  - minutes.detailedAttendance (status, role, affiliation, represented
 *    organization, people-directory link, quorum flag);
 *  - minutes.attendees / minutes.absent derived from the same rows;
 *  - meetings.attendeeIds;
 *  - the meeting's meetingAttendanceRecords (updated, created, or marked
 *    "removed" / "not_person" — never silently deleted, they are evidence);
 *  - entries marked "not a person" into the minutes' non-person evidence list
 *    and the matching person occurrences, so counts and quorum change at once.
 */
import type { PortableMutationCtx, PortableQueryCtx } from "../portable/ctx";
import { getOwned, requireOwnedRow } from "./access";
import { requirePermissionPortable } from "./permissions";
import {
  attendancePatchFromRows,
  normalizeAttendanceStatus,
  normalizePersonKey,
  type AttendanceGridRow,
} from "../meetingAttendanceGrid";
import { meetingCalendarDate } from "../meetingDates";
import { visibleDirectoryRows } from "./peopleDirectory";

export type SaveAttendanceGridArgs = {
  minutesId: string;
  rows: Array<Omit<AttendanceGridRow, "key"> & { key?: string }>;
  nonPersons?: Array<{ name: string; kind?: string }>;
  /** Quorum computed from the grid; applied only when the minutes record none. */
  quorumStatusIfUnset?: "confirmed" | "not_met" | "not_recorded";
};

const MAX_ROWS = 500;

/** The meeting's attendance register rows (B5), for the meeting page grid. */
export async function attendanceRecordsForMeetingPortable(ctx: PortableQueryCtx, { meetingId }: { meetingId: string }) {
  await requireOwnedRow(ctx, "meetings", meetingId);
  return ctx.db
    .query("meetingAttendanceRecords")
    .withIndex("by_meeting", (q) => q.eq("meetingId", meetingId))
    .collect();
}

export async function saveAttendanceGridPortable(ctx: PortableMutationCtx, args: SaveAttendanceGridArgs) {
  const minutes: any = await requireOwnedRow(ctx, "minutes", args.minutesId);
  const societyId = String(minutes.societyId);
  await requirePermissionPortable(ctx, societyId, "minutes:write");
  await requirePermissionPortable(ctx, societyId, "meetings:write");
  if (minutes.approvedAt || minutes.adoptedSnapshot) throw new Error("Adopted minutes are frozen. Start an amendment to change recorded content.");
  if (!Array.isArray(args.rows) || args.rows.length > MAX_ROWS) throw new Error(`Attendance can hold at most ${MAX_ROWS} rows.`);
  const meeting: any = await getOwned(ctx, "meetings", String(minutes.meetingId), societyId);
  const rows = args.rows.map((row) => ({ ...row, key: row.key ?? "", status: normalizeAttendanceStatus(row.status) })) as AttendanceGridRow[];
  // Person links must point at a directory person this workspace can see
  // (its own rows, or shared/local directory rows without an owner).
  if (rows.some((row) => row.personId)) {
    const visible = new Set((await visibleDirectoryRows(ctx, societyId)).map((person) => String(person._id)));
    for (const row of rows) {
      if (row.personId && !visible.has(String(row.personId))) throw new Error("Directory person not found.");
    }
  }
  const patch = attendancePatchFromRows(rows);
  const now = new Date().toISOString();

  const nonPersons = (args.nonPersons ?? [])
    .map((entry) => ({ name: String(entry?.name ?? "").trim(), kind: String(entry?.kind ?? "not_person") }))
    .filter((entry) => entry.name);
  const keptKeys = new Set(patch.detailedAttendance.map((row) => normalizePersonKey(row.name)));
  const nonPersonKeys = new Set(nonPersons.map((entry) => normalizePersonKey(entry.name)).filter((key) => !keptKeys.has(key)));

  const minutesPatch: Record<string, unknown> = {
    attendees: patch.attendees,
    absent: patch.absent,
    detailedAttendance: patch.detailedAttendance,
  };
  if (!minutes.quorumStatus && args.quorumStatusIfUnset && ["confirmed", "not_met", "not_recorded"].includes(args.quorumStatusIfUnset)) {
    minutesPatch.quorumStatus = args.quorumStatusIfUnset;
    minutesPatch.quorumMet = args.quorumStatusIfUnset === "confirmed";
  }
  if (nonPersonKeys.size) {
    let transcript: any = {};
    try {
      transcript = minutes.draftTranscript ? JSON.parse(minutes.draftTranscript) : {};
      if (!transcript || typeof transcript !== "object" || Array.isArray(transcript)) transcript = { originalDraftTranscript: minutes.draftTranscript };
    } catch {
      transcript = { originalDraftTranscript: minutes.draftTranscript };
    }
    const prior: any[] = Array.isArray(transcript.nonPersonAttendance) ? transcript.nonPersonAttendance : [];
    const priorKeys = new Set(prior.map((row) => normalizePersonKey(row?.name)));
    transcript.nonPersonAttendance = [
      ...prior,
      ...nonPersons
        .filter((entry) => nonPersonKeys.has(normalizePersonKey(entry.name)) && !priorKeys.has(normalizePersonKey(entry.name)))
        .map((entry) => ({ name: entry.name, kind: entry.kind, removedBy: "attendanceGrid", at: now })),
    ];
    minutesPatch.draftTranscript = JSON.stringify(transcript);
  }
  await ctx.db.patch(minutes._id, minutesPatch);
  await ctx.db.patch(meeting._id, { attendeeIds: patch.attendees });

  // Evidence register rows for this meeting.
  const records: any[] = await ctx.db
    .query("meetingAttendanceRecords")
    .withIndex("by_meeting", (q) => q.eq("meetingId", meeting._id))
    .collect();
  const byId = new Map(records.map((record) => [String(record._id), record]));
  const byName = new Map<string, any>();
  for (const record of records) {
    const key = normalizePersonKey(record.personName);
    if (key && !byName.has(key)) byName.set(key, record);
  }
  const touched = new Set<string>();
  let created = 0;
  let updated = 0;
  const detailedByKey = new Map(patch.detailedAttendance.map((row) => [normalizePersonKey(row.name), row]));
  for (const row of rows) {
    const key = normalizePersonKey(row.name);
    const detailed = detailedByKey.get(key);
    if (!detailed) continue;
    detailedByKey.delete(key);
    const existing = (row.recordId && byId.get(String(row.recordId))) || byName.get(key);
    const fields: Record<string, unknown> = {
      personName: detailed.name,
      attendanceStatus: detailed.status,
      quorumCounted: detailed.quorumCounted,
      roleTitle: detailed.roleTitle,
      affiliation: detailed.affiliation,
      representedOrganization: detailed.representedOrganization,
      directoryPersonId: detailed.personId,
      notes: detailed.notes ?? existing?.notes,
    };
    if (detailed.personId) fields.identityReviewStatus = "verified";
    if (existing && !touched.has(String(existing._id))) {
      touched.add(String(existing._id));
      await ctx.db.patch(existing._id, fields);
      updated += 1;
    } else {
      const id = await ctx.db.insert("meetingAttendanceRecords", {
        societyId,
        meetingId: meeting._id,
        minutesId: minutes._id,
        meetingTitle: String(meeting.title ?? ""),
        meetingDate: meetingCalendarDate(meeting) ?? String(meeting.scheduledAt ?? "").slice(0, 10),
        confidence: "reviewed",
        createdAtISO: now,
        ...Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined)),
      } as any);
      touched.add(String(id));
      created += 1;
    }
  }
  let retired = 0;
  for (const record of records) {
    if (touched.has(String(record._id))) continue;
    const status = String(record.attendanceStatus ?? "");
    const next = nonPersonKeys.has(normalizePersonKey(record.personName)) ? "not_person" : "removed";
    if (status === next) continue;
    await ctx.db.patch(record._id, { attendanceStatus: next, quorumCounted: false });
    retired += 1;
  }

  // Person occurrences on this minutes record that a reviewer marked "not a person".
  let occurrencesMarked = 0;
  if (nonPersonKeys.size) {
    const occurrences: any[] = await ctx.db
      .query("personOccurrences")
      .withIndex("by_record", (q) => q.eq("societyId", societyId).eq("recordTable", "minutes").eq("recordId", String(minutes._id)))
      .collect();
    const reviewer = await requirePermissionPortable(ctx, societyId, "minutes:write");
    for (const occurrence of occurrences) {
      if (!nonPersonKeys.has(normalizePersonKey(occurrence.personName))) continue;
      if (["verified", "not_person"].includes(String(occurrence.matchStatus))) continue;
      await ctx.db.patch(occurrence._id, {
        personId: undefined,
        matchStatus: "not_person",
        reviewHistory: [
          ...(Array.isArray(occurrence.reviewHistory) ? occurrence.reviewHistory : []),
          {
            previous: { personId: occurrence.personId ?? null, status: occurrence.matchStatus },
            personId: null,
            status: "not_person",
            rationale: "Marked not a person in the meeting attendance grid.",
            reviewedAtISO: now,
            reviewedByUserId: reviewer._id,
          },
        ],
      });
      occurrencesMarked += 1;
    }
  }

  return {
    attendees: patch.attendees.length,
    absent: patch.absent.length,
    rows: patch.detailedAttendance.length,
    recordsCreated: created,
    recordsUpdated: updated,
    recordsRetired: retired,
    nonPersons: nonPersonKeys.size,
    occurrencesMarked,
  };
}
