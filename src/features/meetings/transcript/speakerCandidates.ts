// Who a transcript speaker can be assigned to. Notes and committee meetings
// often have no recorded attendance, so the list falls back through what the
// meeting does know: attendance, then the expected attendees, the committee's
// members, and the board. Pure, so the checks can exercise it.

import type { Attendee } from "./SpeakerPanel";

type PersonRow = {
  _id: string;
  firstName?: string;
  lastName?: string;
  directoryPersonId?: string;
  position?: string;
  status?: string;
  resignedAt?: string;
  termEnd?: string;
};
type CommitteeMemberRow = {
  name: string;
  role?: string;
  personId?: string;
  directorId?: string;
  memberId?: string;
  leftAt?: string;
};

export type SpeakerCandidateSources = {
  minutes?: { attendees?: readonly string[]; detailedAttendance?: readonly Attendee[] } | null;
  /** `meetings.attendeeIds`: director or member ids, or plain names (Board meetings snapshot names). */
  attendeeIds?: readonly string[];
  /** Members of the meeting's committee, when it has one. */
  committeeMembers?: readonly CommitteeMemberRow[];
  directors?: readonly PersonRow[];
  members?: readonly PersonRow[];
  /** `YYYY-MM-DD`; directors whose term ended before it are left out. */
  todayISO?: string;
  /**
   * The People directory: a name above without a record is linked to the
   * person it names, and everyone listed can be chosen ("People"), so a
   * transcript that already names its speakers (Teams, Zoom) matches them.
   */
  directory?: ReadonlyArray<{ _id: string; fullName: string; aliases?: readonly string[] | null; archivedAtISO?: string | null }>;
};

/** Group labels, in list order. */
export const SPEAKER_CANDIDATE_GROUPS = ["Attended", "Expected", "Committee", "Directors", "People"] as const;

/** A bound on the "People" group so a large register keeps the picker usable. */
export const SPEAKER_CANDIDATE_PEOPLE_MAX = 300;

/**
 * Candidates in order: minutes detailed attendance, minutes attendees, the
 * meeting's expected attendees, committee members, then current directors.
 * De-duplicated by people-directory id, then by case-insensitive name; a later
 * duplicate fills in a missing `personId` or role but keeps the earlier group.
 */
export function speakerCandidates(sources: SpeakerCandidateSources): Attendee[] {
  const rows: Attendee[] = [];
  const add = (candidate: Attendee) => {
    const name = candidate.name.replace(/\s+/g, " ").trim();
    if (!name) return;
    const key = name.toLocaleLowerCase();
    const existing = rows.find(
      (row) => (candidate.personId && row.personId === candidate.personId) || row.name.toLocaleLowerCase() === key,
    );
    if (!existing) {
      rows.push({ ...candidate, name });
      return;
    }
    if (!existing.personId && candidate.personId) existing.personId = candidate.personId;
    if (!existing.roleTitle && candidate.roleTitle) existing.roleTitle = candidate.roleTitle;
  };

  for (const attendee of sources.minutes?.detailedAttendance ?? []) add({ ...attendee, group: "Attended" });
  for (const name of sources.minutes?.attendees ?? []) add({ name, group: "Attended" });

  const directors = sources.directors ?? [];
  const members = sources.members ?? [];
  for (const id of sources.attendeeIds ?? []) {
    const person = directors.find((row) => row._id === id) ?? members.find((row) => row._id === id);
    if (person) add({ ...personCandidate(person), group: "Expected" });
    else if (looksLikeName(id)) add({ name: id, group: "Expected" });
  }

  for (const member of sources.committeeMembers ?? []) {
    if (member.leftAt) continue;
    const linked = directors.find((row) => row._id === member.directorId) ?? members.find((row) => row._id === member.memberId);
    add({
      name: member.name,
      personId: member.personId ?? linked?.directoryPersonId,
      roleTitle: member.role,
      group: "Committee",
    });
  }

  for (const director of directors) {
    if (isCurrentDirector(director, sources.todayISO)) add({ ...personCandidate(director), group: "Directors" });
  }

  const directory = (sources.directory ?? []).filter((person) => person.fullName?.trim() && !person.archivedAtISO);
  if (directory.length) {
    // A name with no record takes the one person it names (full name or alias).
    const key = (name: string) => name.normalize("NFKC").toLocaleLowerCase().replace(/[\s_]+/g, " ").trim();
    const byName = new Map<string, string[]>();
    for (const person of directory) {
      for (const name of [person.fullName, ...(person.aliases ?? [])]) {
        const k = key(name);
        if (k) byName.set(k, [...new Set([...(byName.get(k) ?? []), String(person._id)])]);
      }
    }
    for (const row of rows) {
      if (row.personId) continue;
      const ids = byName.get(key(row.name));
      if (ids?.length === 1) row.personId = ids[0];
    }
    // Everyone else listed, without touching a name already offered (an
    // ambiguous name stays unlinked rather than taking the first match).
    const offered = new Set(rows.map((row) => key(row.name)));
    for (const person of directory.slice(0, SPEAKER_CANDIDATE_PEOPLE_MAX)) {
      if (!offered.has(key(person.fullName))) add({ name: person.fullName, personId: String(person._id), group: "People" });
    }
  }
  return rows;
}

/** Group labels are worth showing once the list is long and mixes groups. */
export function showCandidateGroups(candidates: readonly Attendee[]): boolean {
  return candidates.length > 6 && new Set(candidates.map((candidate) => candidate.group)).size > 1;
}

function personCandidate(person: PersonRow): Attendee {
  return {
    name: `${person.firstName ?? ""} ${person.lastName ?? ""}`,
    personId: person.directoryPersonId,
    roleTitle: person.position,
  };
}

// Unresolved ids (still loading, or from another runtime) are not names.
function looksLikeName(value: string) {
  return /[\sA-Z]/.test(value.trim());
}

function isCurrentDirector(director: PersonRow, todayISO?: string) {
  if (director.resignedAt) return false;
  if (/former|resigned|removed|inactive|ended/i.test(director.status ?? "")) return false;
  return !todayISO || !director.termEnd || director.termEnd.slice(0, 10) >= todayISO;
}
