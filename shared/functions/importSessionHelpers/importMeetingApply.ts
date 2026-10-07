// Meeting-minutes import: body/committee resolution, date+body identity,
// title cleanup, attendance screening, person links and motion conversion.
// Pure ctx.db helpers used by importSessions.applyApprovedMeetingsPortable and
// the merge path (C3, C4, C5, C6, C7, C8, C13, C14, A1, A11, A13, A16).

import { screenAttendanceList, type ScreenedAttendanceName } from "../../attendanceNames";
import { bodyKeyForMeeting, cleanMeetingTitle, inferMeetingBody, isFilenameOrGenericMeetingTitle, meetingBodyFromImport, slugBody, sourceVersionStatusFromLabel, stripTablePipes, type MeetingBody } from "../../meetingBody";
import { parseLocalTimeText } from "../../meetingDates";
import { classifyMotionOutcome } from "../../motionOutcome";
import { sanitizeImportedVoteCount } from "../../motionValidation";
import { requirePermissionPortable } from "../permissions";
import { arrayOf, cleanText, compactRecord, unique } from "./importSessionUtils";

export const IMPORT_MEETING_STATUSES = ["Held", "HeldMinutesMissing", "Scheduled", "Draft", "Cancelled", "Postponed"] as const;

/** C14: the native meeting status from the payload; minutes default to Held. */
export function importedMeetingStatus(payload: any): string {
  for (const value of [payload?.meetingStatus, payload?.status]) {
    const text = cleanText(value)?.toLowerCase();
    if (!text) continue;
    const match = IMPORT_MEETING_STATUSES.find((status) => status.toLowerCase() === text);
    if (match) return match;
    if (text === "canceled") return "Cancelled";
    if (text === "planned" || text === "upcoming") return "Scheduled";
  }
  return "Held";
}

/** Normalize a person name for directory matching. */
export function personMatchKey(value: unknown): string | undefined {
  const text = cleanText(value);
  if (!text) return undefined;
  const withoutParens = text.replace(/\([^)]*\)/g, " ");
  const comma = withoutParens.match(/^\s*([^,]+),\s*(.+?)\s*$/);
  const name = comma && !/\s/.test(comma[1].trim()) ? `${comma[2]} ${comma[1]}` : withoutParens.split(",")[0];
  return name
    .normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\b(?:dr|mr|mrs|ms|mx|prof)\.?\s+/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ") || undefined;
}

export type DirectoryIndex = { byKey: Map<string, string[]>; loaded: boolean };

/** Load the society's people directory once per apply. */
export async function loadDirectoryIndex(ctx: any, societyId: string): Promise<DirectoryIndex> {
  // A trusted local workspace also keeps unowned directory rows (people created in the browser
  // workspace carry no society id); they are this workspace's people too (see visibleDirectoryRows).
  const trustedLocal = ctx.principal?.kind === "user" && ctx.principal?.assurance === "trusted-workspace" && ctx.principal?.runtime !== "convex-hosted";
  const rows = trustedLocal
    ? (await ctx.db.query("peopleDirectory").collect()).filter((row: any) => (!row.societyId || String(row.societyId) === String(societyId)) && !row.mergedIntoId)
    : (await ctx.db.query("peopleDirectory").withIndex("by_society", (q: any) => q.eq("societyId", societyId)).collect()).filter((row: any) => !row.mergedIntoId);
  const byKey = new Map<string, string[]>();
  for (const row of rows) {
    const keys = unique([row.fullName, `${row.firstName ?? ""} ${row.lastName ?? ""}`, ...arrayOf(row.aliases)].map(personMatchKey));
    for (const key of keys) byKey.set(key, unique([...(byKey.get(key) ?? []), String(row._id)]));
  }
  return { byKey, loaded: true };
}

/** A unique directory match for a name, never a guess between two people. */
export function directoryPersonId(index: DirectoryIndex | undefined, name: unknown): string | undefined {
  const key = personMatchKey(name);
  if (!key || !index) return undefined;
  const ids = index.byKey.get(key) ?? [];
  return ids.length === 1 ? ids[0] : undefined;
}

/** C5: find a committee for an imported body, creating it when allowed. */
export async function resolveImportCommittee(ctx: any, societyId: string, body: MeetingBody, options: { create: boolean }): Promise<{ committeeId?: string; created: boolean }> {
  if (body.type !== "Committee" || !body.committeeKey) return { created: false };
  const committees = await ctx.db.query("committees").withIndex("by_society", (q: any) => q.eq("societyId", societyId)).collect();
  const match = committees.find((row: any) => (row.bodyKey && row.bodyKey === body.committeeKey))
    ?? committees.find((row: any) => (inferMeetingBody(row.name).committeeKey ?? slugBody(row.name)) === body.committeeKey)
    ?? committees.find((row: any) => slugBody(row.name) === slugBody(body.committeeName));
  if (match) return { committeeId: String(match._id), created: false };
  if (!options.create) return { created: false };
  await requirePermissionPortable(ctx, societyId, "committees:write");
  const committeeId = await ctx.db.insert("committees", {
    societyId,
    name: body.committeeName ?? "Committee",
    description: "Created from imported meeting minutes. Review its mandate, members and quorum rule.",
    cadence: "Unknown",
    bodyKey: body.committeeKey,
    color: "gray",
    status: "Active",
    createdAtISO: new Date().toISOString(),
  });
  return { committeeId: String(committeeId), created: true };
}

/** Meeting identity for import: calendar date + body (+ special / explicit key). */
export async function findMeetingByIdentity(
  ctx: any,
  societyId: string,
  args: { dateKey: string; bodyKey: string; special?: boolean; identityKey?: string; sourceExternalIds?: string[]; title?: string; bodyBasis?: string },
): Promise<{ meetingId: any; minutesId: any } | null> {
  const meetings = await ctx.db.query("meetings").withIndex("by_society", (q: any) => q.eq("societyId", societyId)).collect();
  const sameDay = meetings.filter((meeting: any) => String(meeting.scheduledAt ?? "").slice(0, 10) === args.dateKey && meeting.minutesId);
  if (!sameDay.length) return null;
  // When nothing named a body, an exact title (or source title) match on the
  // same day is still the same meeting, as before body identity existed.
  if (args.bodyBasis === "default" && args.title) {
    const wanted = args.title.trim().toLowerCase();
    const byTitle = sameDay.filter((meeting: any) => [meeting.title, meeting.sourceTitle].some((value) => String(value ?? "").trim().toLowerCase() === wanted));
    if (byTitle.length === 1) return { meetingId: byTitle[0]._id, minutesId: byTitle[0].minutesId };
  }
  const committees = new Map<string, any>();
  for (const meeting of sameDay) {
    if (meeting.committeeId && !committees.has(String(meeting.committeeId))) committees.set(String(meeting.committeeId), await ctx.db.get(meeting.committeeId));
  }
  const candidates = sameDay.filter((meeting: any) => {
    const key = bodyKeyForMeeting(meeting, meeting.committeeId ? committees.get(String(meeting.committeeId)) : null);
    if (key !== args.bodyKey) return false;
    const special = /\bspecial\b/i.test(`${meeting.title ?? ""} ${meeting.sourceTitle ?? ""}`);
    if (Boolean(args.special) !== special) return false;
    return true;
  });
  if (args.identityKey) {
    const sources = new Set((args.sourceExternalIds ?? []).map((value) => value.toLowerCase()));
    for (const meeting of candidates) {
      const minutes = await ctx.db.get(meeting.minutesId);
      const keys = arrayOf(minutes?.importedSourceVersions).map((row: any) => row?.notes ?? "");
      if (keys.some((note: string) => note.includes(`identity:${args.identityKey}`))) return { meetingId: meeting._id, minutesId: meeting.minutesId };
      if (arrayOf(minutes?.sourceExternalIds).some((id: string) => sources.has(String(id).toLowerCase()))) return { meetingId: meeting._id, minutesId: meeting.minutesId };
    }
    return null;
  }
  if (candidates.length === 0) return null;
  // Prefer the candidate already carrying one of these sources.
  const sources = new Set((args.sourceExternalIds ?? []).map((value) => value.toLowerCase()));
  for (const meeting of candidates) {
    const minutes = await ctx.db.get(meeting.minutesId);
    if (arrayOf(minutes?.sourceExternalIds).some((id: string) => sources.has(String(id).toLowerCase()))) return { meetingId: meeting._id, minutesId: meeting.minutesId };
  }
  const first = candidates.sort((a: any, b: any) => (a._creationTime ?? 0) - (b._creationTime ?? 0))[0];
  return { meetingId: first._id, minutesId: first.minutesId };
}

export type PreparedImportedMeeting = {
  body: MeetingBody & { external?: string };
  dateKey: string;
  title: string;
  sourceTitle?: string;
};

/** Body, identity date and a clean title for an imported meeting payload. */
export function prepareImportedMeeting(payload: any, scheduledAt: string): PreparedImportedMeeting {
  const body = meetingBodyFromImport(payload);
  const dateKey = String(scheduledAt).slice(0, 10);
  const rawTitle = cleanText(payload?.meetingTitle);
  const titleIsLabel = !rawTitle || isFilenameOrGenericMeetingTitle(rawTitle);
  const title = titleIsLabel
    ? cleanMeetingTitle({ bodyKey: body.bodyKey, committeeName: body.committeeName, special: body.special, date: dateKey, external: body.external })
    : stripTablePipes(rawTitle);
  const sourceTitle = rawTitle && rawTitle !== title ? rawTitle : undefined;
  return { body, dateKey, title, sourceTitle };
}

/** A13: date precision, local time text and (when a zone is given) the real instant. */
export function importedMeetingTime(payload: any, placeholder: string): { scheduledAt: string; scheduledAtPrecision: "date" | "datetime"; localStartText?: string; localEndText?: string; timeZone?: string } {
  const localStartText = cleanText(payload?.localStartText);
  const localEndText = cleanText(payload?.localEndText);
  const timeZone = cleanText(payload?.timeZone);
  const meetingDate = cleanText(payload?.meetingDate) ?? "";
  const explicitInstant = /T\d{2}:\d{2}/.test(meetingDate);
  if (explicitInstant) return { scheduledAt: placeholder, scheduledAtPrecision: "datetime", localStartText, localEndText, timeZone };
  const hhmm = parseLocalTimeText(localStartText);
  if (hhmm && timeZone) {
    const instant = zonedTimeToUtc(placeholder.slice(0, 10), hhmm, timeZone);
    if (instant) return { scheduledAt: instant, scheduledAtPrecision: "datetime", localStartText, localEndText, timeZone };
  }
  return { scheduledAt: placeholder, scheduledAtPrecision: "date", localStartText, localEndText, timeZone };
}

/** Convert a local wall-clock time in an IANA zone to a UTC ISO instant. */
export function zonedTimeToUtc(date: string, hhmm: string, timeZone: string): string | undefined {
  try {
    const guess = Date.parse(`${date}T${hhmm}:00.000Z`);
    if (!Number.isFinite(guess)) return undefined;
    const offsetAt = (instant: number) => {
      const parts = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(new Date(instant));
      const get = (type: string) => Number(parts.find((part) => part.type === type)?.value);
      const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"), get("second"));
      return asUtc - instant;
    };
    let instant = guess - offsetAt(guess);
    instant = guess - offsetAt(instant);
    return new Date(instant).toISOString();
  } catch {
    return undefined;
  }
}

export type ScreenedAttendance = {
  attendees: string[];
  absent: string[];
  detailedAttendance?: any[];
  rejected: Array<ScreenedAttendanceName & { list: "attendees" | "absent" | "detailedAttendance" }>;
};

/** Attendance names that are role words, organizations or headings are kept as
 *  evidence, never created as attendees. People are linked to the directory. */
export function screenImportedAttendance(payload: any, directory?: DirectoryIndex): ScreenedAttendance {
  const present = screenAttendanceList(arrayOf(payload?.attendees));
  const absent = screenAttendanceList(arrayOf(payload?.absent));
  const rejected: ScreenedAttendance["rejected"] = [
    ...present.rejected.map((row) => ({ ...row, list: "attendees" as const })),
    ...absent.rejected.map((row) => ({ ...row, list: "absent" as const })),
  ];
  let detailedAttendance: any[] | undefined;
  if (arrayOf(payload?.detailedAttendance).length) {
    detailedAttendance = [];
    for (const row of arrayOf(payload.detailedAttendance)) {
      const screened = screenAttendanceList([row?.name]);
      if (!screened.people.length) {
        if (screened.rejected[0]) rejected.push({ ...screened.rejected[0], list: "detailedAttendance" });
        continue;
      }
      const person = screened.people[0];
      detailedAttendance.push(compactRecord({
        ...row,
        name: person.name,
        affiliation: row.affiliation ?? person.affiliation,
        roleTitle: row.roleTitle ?? person.roleTitle,
        personId: directoryPersonId(directory, person.name),
      }));
    }
  } else if (present.people.length || absent.people.length) {
    detailedAttendance = [
      ...present.people.map((person) => compactRecord({ name: person.name, status: "present", affiliation: person.affiliation, roleTitle: person.roleTitle, personId: directoryPersonId(directory, person.name) })),
      ...absent.people.map((person) => compactRecord({ name: person.name, status: "absent", affiliation: person.affiliation, roleTitle: person.roleTitle, personId: directoryPersonId(directory, person.name) })),
    ];
  }
  return {
    attendees: present.people.map((row) => row.name),
    absent: absent.people.map((row) => row.name),
    detailedAttendance: detailedAttendance?.length ? detailedAttendance : undefined,
    rejected,
  };
}

/** C3: resolve "adopt the minutes of <date>" to a minutes row. */
export async function resolveAdoptsMinutesId(ctx: any, societyId: string, ref: any, adopting: { dateKey: string; bodyKey: string }): Promise<string | undefined> {
  if (!ref) return undefined;
  const minutesRows = await ctx.db.query("minutes").withIndex("by_society", (q: any) => q.eq("societyId", societyId)).collect();
  if (ref.sourceExternalId) {
    const bySource = minutesRows.filter((row: any) => arrayOf(row.sourceExternalIds).includes(ref.sourceExternalId));
    if (bySource.length === 1) return String(bySource[0]._id);
  }
  const date = cleanText(ref.meetingDate)?.slice(0, 10);
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date) || date >= adopting.dateKey) return undefined;
  const wantedBody = ref.bodyKey || ref.committeeName ? meetingBodyFromImport({ body: ref.bodyKey, committeeName: ref.committeeName }).bodyKey : adopting.bodyKey;
  const sameDay = minutesRows.filter((row: any) => String(row.heldAt ?? "").slice(0, 10) === date);
  const matches: any[] = [];
  for (const row of sameDay) {
    const meeting = await ctx.db.get(row.meetingId);
    if (!meeting) continue;
    const committee = meeting.committeeId ? await ctx.db.get(meeting.committeeId) : null;
    if (bodyKeyForMeeting(meeting, committee) === wantedBody) matches.push(row);
  }
  if (matches.length === 1) return String(matches[0]._id);
  if (!matches.length && sameDay.length === 1 && !(ref.bodyKey || ref.committeeName)) return String(sameDay[0]._id);
  return undefined;
}

/** Convert one normalized motion payload into the embedded shape that
 *  syncMotionsForMinutes materializes, carrying C3/C4/C13/A1/A11 fields. */
export async function importedMotionFromPayload(ctx: any, societyId: string, motion: any, context: { dateKey: string; bodyKey: string; directory?: DirectoryIndex; sourceExternalIds?: string[]; sourceDocumentIdsByExternal?: Map<string, string> }) {
  const classified = classifyMotionOutcome(motion?.outcome);
  const movedBy = cleanText(motion?.movedByName);
  const secondedBy = cleanText(motion?.secondedByName);
  const named = (rows: any[] | undefined) => {
    const list = arrayOf(rows).map((row: any) => compactRecord({ name: cleanText(row?.name) ?? "", personId: directoryPersonId(context.directory, row?.name), notes: cleanText(row?.notes) })).filter((row: any) => row?.name);
    return list.length ? list : undefined;
  };
  const sourceLocator = compactRecord({
    voteSummary: cleanText(motion?.voteSummary),
    pageRef: cleanText(motion?.pageRef),
    evidenceText: cleanText(motion?.evidenceText),
    sectionReference: cleanText(motion?.sectionTitle),
    quote: cleanText(motion?.rawText)?.slice(0, 400),
    sourceExternalIds: arrayOf(motion?.sourceExternalIds).length ? unique(arrayOf(motion.sourceExternalIds)) : undefined,
  });
  const decidedBy = cleanText(motion?.decidedBy)?.toLowerCase();
  return compactRecord({
    text: cleanText(motion?.motionText) || "Imported motion",
    movedBy,
    movedByPersonId: directoryPersonId(context.directory, movedBy),
    secondedBy,
    secondedByPersonId: directoryPersonId(context.directory, secondedBy),
    // Raw wording is kept as `sourceOutcomeText` by syncMotionsForMinutes.
    outcome: cleanText(motion?.outcome) || "NeedsReview",
    votesFor: sanitizeImportedVoteCount(motion?.votesFor),
    votesAgainst: sanitizeImportedVoteCount(motion?.votesAgainst),
    abstentions: sanitizeImportedVoteCount(motion?.abstentions),
    resolutionType: cleanText(motion?.resolutionType),
    decidedBy: decidedBy && ["vote", "consent", "automatic", "chair_ruling"].includes(decidedBy) ? decidedBy : classified.decidedBy,
    sectionIndex: typeof motion?.sectionIndex === "number" ? motion.sectionIndex : undefined,
    sectionTitle: cleanText(motion?.sectionTitle) ? stripTablePipes(motion.sectionTitle) : undefined,
    adoptsMinutesId: await resolveAdoptsMinutesId(ctx, societyId, motion?.adoptsMinutes, context),
    abstainedBy: named(motion?.abstainedBy),
    opposedBy: named(motion?.opposedBy),
    dissentDocumentId: motion?.dissentSourceExternalId ? context.sourceDocumentIdsByExternal?.get(motion.dissentSourceExternalId) : undefined,
    outcomeOverrideNote: cleanText(motion?.outcomeOverrideNote),
    sourceLocator,
    sourceExternalIds: arrayOf(motion?.sourceExternalIds).length ? unique(arrayOf(motion.sourceExternalIds)) : context.sourceExternalIds,
  });
}

/** C7: section rows for the native minutes (motionIndex resolved to motionId,
 *  table pipes stripped with the source title kept, action items linked). */
export function importedSectionsWithLinks(sections: any[] | undefined, motionIds: any[], directory?: DirectoryIndex) {
  if (!Array.isArray(sections) || !sections.length) return sections;
  return sections.map((section: any) => {
    const { motionIndex, ...rest } = section;
    const title = stripTablePipes(section.title) || section.title;
    const out: any = { ...rest, title };
    if (title !== section.title) out.sourceTitle = section.title;
    if (typeof motionIndex === "number" && motionIds[motionIndex]) out.motionId = motionIds[motionIndex];
    if (Array.isArray(section.actionItems)) out.actionItems = section.actionItems.map((item: any) => linkActionItem(item, directory));
    return out;
  });
}

export function linkActionItem(item: any, directory?: DirectoryIndex) {
  if (!item || item.assigneePersonId || !item.assignee) return item;
  const personId = directoryPersonId(directory, item.assignee);
  return personId ? { ...item, assigneePersonId: personId } : item;
}

/** C6/A9: agenda rows from strings or objects. */
export function importedAgendaRows(items: any[]): Array<{ title: string; [key: string]: any }> {
  return arrayOf(items)
    .map((item: any) => typeof item === "string" ? { title: stripTablePipes(item) || item } : { ...item, title: stripTablePipes(item?.title) || cleanText(item?.title) })
    .filter((item: any) => item.title);
}

/** True when an existing version row already covers every one of these sources. */
export function sourceVersionsCover(versions: any[] | undefined, sourceExternalIds: string[]): boolean {
  return arrayOf(versions).some((row: any) => sourceExternalIds.every((id) => arrayOf(row?.sourceExternalIds).includes(id)));
}

/** One importedSourceVersions row per source file folded into a meeting. */
export function importedSourceVersionFor(payload: any, sourceExternalIds: string[], identityKey?: string) {
  if (!sourceExternalIds.length) return undefined;
  const label = cleanText(payload?.sourceDocumentTitle) || cleanText(payload?.meetingTitle) || sourceExternalIds[0];
  const explicit = cleanText(payload?.sourceVersionStatus)?.toLowerCase();
  const status = explicit === "draft" || explicit === "revised" ? explicit : sourceVersionStatusFromLabel(`${payload?.sourceDocumentTitle ?? ""} ${payload?.meetingTitle ?? ""}`);
  const approvedLabel = /\b(?:approved|final|adopted)\b/i.test(String(payload?.sourceDocumentTitle ?? payload?.meetingTitle ?? "").replace(/_/g, " "));
  return compactRecord({
    versionId: `import:${unique(sourceExternalIds).sort().join("|")}`,
    label,
    status,
    sourceExternalIds: unique(sourceExternalIds),
    sourceDate: /^\d{4}-\d{2}-\d{2}$/.test(String(payload?.meetingDate ?? "").slice(0, 10)) ? String(payload.meetingDate).slice(0, 10) : undefined,
    notes: [
      approvedLabel ? "Source file is labelled approved/final; adoption is not inferred from a file name." : undefined,
      identityKey ? `identity:${identityKey}` : undefined,
    ].filter(Boolean).join(" ") || undefined,
  });
}
