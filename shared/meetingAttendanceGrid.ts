/**
 * Meeting attendance grid model (schema B4/B5, ui-meetings F5/F13, ui-people P9).
 *
 * One editable row per attendee with a status, role, affiliation, represented
 * organization and an optional people-directory link. The grid is the single
 * authority for a meeting's attendance: saving it derives the legacy
 * `minutes.attendees` / `minutes.absent` name lists, `minutes.detailedAttendance`
 * and the per-person `meetingAttendanceRecords` from the same rows, so counts,
 * quorum and the evidence register never disagree.
 *
 * Pure module: safe for the browser, Convex and scripts.
 */
import { screenAttendanceName, type AttendanceNameKind } from "./attendanceNames";

export const ATTENDANCE_GRID_STATUSES = ["present", "regrets", "absent", "staff", "guest", "proxy", "unknown"] as const;
export type AttendanceGridStatus = (typeof ATTENDANCE_GRID_STATUSES)[number];

export const ATTENDANCE_GRID_STATUS_LABELS: Record<AttendanceGridStatus, string> = {
  present: "Present",
  regrets: "Regrets",
  absent: "Absent",
  staff: "Staff",
  guest: "Guest",
  proxy: "Proxy",
  unknown: "Not stated",
};

/** Statuses that put a person in the room (legacy `attendees`). */
export const IN_ATTENDANCE_STATUSES: ReadonlySet<string> = new Set(["present", "staff", "guest", "proxy"]);
/** Statuses that list a person as not attending (legacy `absent`). */
export const NOT_ATTENDING_STATUSES: ReadonlySet<string> = new Set(["regrets", "absent"]);

export type AttendanceGridRow = {
  /** Stable client key (not persisted). */
  key: string;
  name: string;
  status: AttendanceGridStatus;
  roleTitle?: string;
  affiliation?: string;
  representedOrganization?: string;
  personId?: string;
  proxyFor?: string;
  memberIdentifier?: string;
  quorumCounted?: boolean;
  notes?: string;
  /** Linked `meetingAttendanceRecords` row, when one exists. */
  recordId?: string;
};

export type NonPersonAttendanceEntry = {
  name: string;
  kind: AttendanceNameKind | "not_person";
  list?: string;
};

export type DirectoryPersonLike = { _id?: string; id?: string; fullName?: string; name?: string; aliases?: string[] | null };

export function normalizeAttendanceStatus(value: unknown): AttendanceGridStatus {
  const raw = String(value ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  if ((ATTENDANCE_GRID_STATUSES as readonly string[]).includes(raw)) return raw as AttendanceGridStatus;
  if (raw === "regret" || raw === "absent_with_regrets" || raw === "apologies" || raw === "excused") return "regrets";
  if (raw === "attended" || raw === "in_attendance" || raw === "attending") return "present";
  if (raw === "invited" || raw === "observer" || raw === "visitor") return "guest";
  if (raw === "needs_review" || raw === "") return "unknown";
  return "unknown";
}

/** Quorum counts members/directors present in person or by proxy by default. */
export function defaultQuorumCounted(status: AttendanceGridStatus): boolean {
  return status === "present" || status === "proxy";
}

export function normalizePersonKey(value: unknown): string {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Exact (case/accent-insensitive) match on full name or alias; ambiguous → none. */
export function matchDirectoryPerson<T extends DirectoryPersonLike>(name: unknown, people: readonly T[] | null | undefined): T | undefined {
  const key = normalizePersonKey(name);
  if (!key) return undefined;
  const hits = (people ?? []).filter((person) =>
    [person.fullName ?? person.name, ...(person.aliases ?? [])].some((candidate) => normalizePersonKey(candidate) === key),
  );
  return hits.length === 1 ? hits[0] : undefined;
}

function clean(value: unknown): string | undefined {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text || undefined;
}

let keySeq = 0;
export function newAttendanceRowKey(): string {
  keySeq += 1;
  return `att-${Date.now().toString(36)}-${keySeq}`;
}

export function blankAttendanceRow(patch: Partial<AttendanceGridRow> = {}): AttendanceGridRow {
  return { key: newAttendanceRowKey(), name: "", status: "present", quorumCounted: true, ...patch };
}

/**
 * Add incoming rows (from the source, a paste or the directors list) to the
 * grid. A name already in the grid is not duplicated; instead its blank role,
 * affiliation and represented organization are filled from the incoming row,
 * so "Use names from source" also brings in "Terry Robert, President" roles
 * for attendees that were imported as bare names. Values a reviewer already
 * typed are never overwritten.
 */
export function mergeAttendanceRows(current: AttendanceGridRow[], incoming: AttendanceGridRow[]): { rows: AttendanceGridRow[]; added: number; filled: number } {
  const byKey = new Map<string, number>();
  const rows = current.map((row) => ({ ...row }));
  rows.forEach((row, index) => {
    const key = normalizePersonKey(row.name);
    if (key && !byKey.has(key)) byKey.set(key, index);
  });
  let added = 0;
  let filled = 0;
  for (const row of incoming) {
    const key = normalizePersonKey(row.name);
    if (!key) continue;
    const existingIndex = byKey.get(key);
    if (existingIndex === undefined) {
      byKey.set(key, rows.length);
      rows.push(row);
      added += 1;
      continue;
    }
    const existing = rows[existingIndex];
    let changed = false;
    for (const field of ["roleTitle", "affiliation", "representedOrganization"] as const) {
      const incomingValue = String(row[field] ?? "").trim();
      if (incomingValue && !String(existing[field] ?? "").trim()) {
        existing[field] = incomingValue;
        changed = true;
      }
    }
    if (changed) filled += 1;
  }
  return { rows, added, filled };
}

/**
 * Build grid rows from a minutes record plus the meeting's attendance register
 * rows. Detailed attendance wins; names only in the legacy lists are added; then
 * register rows not already represented are appended (except ones a reviewer
 * marked removed / not a person).
 */
export function attendanceRowsFromMinutes(minutes: any, records: any[] = []): AttendanceGridRow[] {
  const rows: AttendanceGridRow[] = [];
  const seen = new Map<string, AttendanceGridRow>();
  const push = (row: AttendanceGridRow) => {
    const key = normalizePersonKey(row.name);
    if (!key || seen.has(key)) return;
    seen.set(key, row);
    rows.push(row);
  };
  for (const detailed of Array.isArray(minutes?.detailedAttendance) ? minutes.detailedAttendance : []) {
    const status = normalizeAttendanceStatus(detailed?.status);
    push({
      key: newAttendanceRowKey(),
      name: String(detailed?.name ?? "").trim(),
      status,
      roleTitle: clean(detailed?.roleTitle),
      affiliation: clean(detailed?.affiliation),
      representedOrganization: clean(detailed?.representedOrganization),
      personId: clean(detailed?.personId),
      proxyFor: clean(detailed?.proxyFor),
      memberIdentifier: clean(detailed?.memberIdentifier),
      quorumCounted: typeof detailed?.quorumCounted === "boolean" ? detailed.quorumCounted : defaultQuorumCounted(status),
      notes: clean(detailed?.notes),
    });
  }
  for (const name of Array.isArray(minutes?.attendees) ? minutes.attendees : []) {
    push({ key: newAttendanceRowKey(), name: String(name ?? "").trim(), status: "present", quorumCounted: true });
  }
  for (const name of Array.isArray(minutes?.absent) ? minutes.absent : []) {
    push({ key: newAttendanceRowKey(), name: String(name ?? "").trim(), status: "regrets", quorumCounted: false });
  }
  for (const record of records ?? []) {
    const recordStatus = String(record?.attendanceStatus ?? "");
    const key = normalizePersonKey(record?.personName);
    const existing = key ? seen.get(key) : undefined;
    if (existing) {
      existing.recordId = existing.recordId ?? String(record._id);
      existing.personId = existing.personId ?? clean(record.directoryPersonId);
      existing.roleTitle = existing.roleTitle ?? clean(record.roleTitle);
      existing.affiliation = existing.affiliation ?? clean(record.affiliation);
      existing.representedOrganization = existing.representedOrganization ?? clean(record.representedOrganization);
      continue;
    }
    if (recordStatus === "removed" || recordStatus === "not_person") continue;
    const status = normalizeAttendanceStatus(recordStatus);
    push({
      key: newAttendanceRowKey(),
      name: String(record?.personName ?? "").trim(),
      status,
      roleTitle: clean(record?.roleTitle),
      affiliation: clean(record?.affiliation),
      representedOrganization: clean(record?.representedOrganization),
      personId: clean(record?.directoryPersonId),
      quorumCounted: typeof record?.quorumCounted === "boolean" ? record.quorumCounted : defaultQuorumCounted(status),
      notes: clean(record?.notes),
      recordId: String(record._id),
    });
  }
  return rows;
}

/** Rows from the parsed source record ("Use names from source"). */
export function attendanceRowsFromSourceParticipants(participants: unknown): AttendanceGridRow[] {
  const out: AttendanceGridRow[] = [];
  for (const participant of Array.isArray(participants) ? participants : []) {
    const name = clean((participant as any)?.name);
    if (!name) continue;
    const status = normalizeAttendanceStatus((participant as any)?.category ?? (participant as any)?.status);
    const screened = screenAttendanceName(name);
    const affiliation = clean((participant as any)?.affiliation);
    // Source tables often put an office in the affiliation column ("Secretary").
    const affiliationIsRole = affiliation ? ["role", "heading"].includes(screenAttendanceName(affiliation).kind) : false;
    out.push(blankAttendanceRow({
      name: screened.kind === "person" ? screened.name : name,
      status,
      roleTitle: affiliationIsRole ? affiliation : screened.roleTitle,
      affiliation: affiliationIsRole ? screened.affiliation : affiliation ?? screened.affiliation,
      quorumCounted: defaultQuorumCounted(status),
    }));
  }
  return out;
}

/**
 * Parse pasted names: one per line (or ";"-separated). "Name, Affiliation" and
 * "Name (Role)" are split; role words / organizations are flagged later.
 */
export function attendanceRowsFromPaste(text: string, status: AttendanceGridStatus = "present"): AttendanceGridRow[] {
  return String(text ?? "")
    .split(/\r?\n|;|\t(?=\S)/)
    .map((line) => line.replace(/^[\s\-–—•*·]+/, "").trim())
    .filter(Boolean)
    .map((line) => {
      // "Blair Sample (Chair), Ministry of Examples": role in brackets, then affiliation.
      const both = /^([^(),]+?)\s*\(([^)]+)\)\s*,\s*(.+)$/.exec(line);
      if (both) {
        return blankAttendanceRow({
          name: both[1].trim(),
          status,
          roleTitle: both[2].trim(),
          affiliation: both[3].trim(),
          quorumCounted: defaultQuorumCounted(status),
        });
      }
      const screened = screenAttendanceName(line);
      return blankAttendanceRow({
        name: screened.kind === "person" ? screened.name : line,
        status,
        roleTitle: screened.roleTitle,
        affiliation: screened.affiliation,
        quorumCounted: defaultQuorumCounted(status),
      });
    });
}

export type AttendanceSuggestion =
  | { kind: "not_person"; reason: AttendanceNameKind; label: string }
  | { kind: "split"; name: string; roleTitle?: string; affiliation?: string; label: string }
  | { kind: "link"; personId: string; personName: string; label: string };

const KIND_LABEL: Record<string, string> = {
  role: "a role or office, not a person",
  organization: "an organization",
  heading: "a heading or list label",
  fragment: "a text fragment",
};

/** What the screen thinks about one row: not a person, split name/affiliation, or link. */
export function attendanceRowSuggestion(row: Pick<AttendanceGridRow, "name" | "roleTitle" | "affiliation" | "personId">, people?: readonly DirectoryPersonLike[]): AttendanceSuggestion | null {
  const name = String(row.name ?? "").trim();
  if (!name) return null;
  const screened = screenAttendanceName(name);
  if (screened.kind !== "person") {
    return { kind: "not_person", reason: screened.kind, label: `“${name}” looks like ${KIND_LABEL[screened.kind] ?? "not a person"}` };
  }
  if (screened.name !== name && (screened.affiliation || screened.roleTitle)) {
    return {
      kind: "split",
      name: screened.name,
      roleTitle: row.roleTitle || screened.roleTitle,
      affiliation: row.affiliation || screened.affiliation,
      label: `Split into “${screened.name}”${screened.roleTitle ? ` · ${screened.roleTitle}` : ""}${screened.affiliation ? ` · ${screened.affiliation}` : ""}`,
    };
  }
  if (!row.personId && people?.length) {
    const match = matchDirectoryPerson(name, people);
    if (match) {
      const id = String(match._id ?? match.id ?? "");
      if (id) return { kind: "link", personId: id, personName: String(match.fullName ?? match.name ?? name), label: `Link to ${match.fullName ?? match.name}` };
    }
  }
  return null;
}

export type AttendanceCounts = { present: number; inAttendance: number; notAttending: number; quorumCounted: number; total: number };

export function attendanceCounts(rows: readonly Pick<AttendanceGridRow, "name" | "status" | "quorumCounted">[]): AttendanceCounts {
  const named = rows.filter((row) => String(row.name ?? "").trim());
  return {
    present: named.filter((row) => row.status === "present").length,
    inAttendance: named.filter((row) => IN_ATTENDANCE_STATUSES.has(row.status)).length,
    notAttending: named.filter((row) => NOT_ATTENDING_STATUSES.has(row.status)).length,
    quorumCounted: named.filter((row) => row.status === "present" && row.quorumCounted !== false).length,
    total: named.length,
  };
}

export type DetailedAttendanceRow = {
  name: string;
  status: string;
  roleTitle?: string;
  affiliation?: string;
  representedOrganization?: string;
  memberIdentifier?: string;
  personId?: string;
  proxyFor?: string;
  quorumCounted?: boolean;
  notes?: string;
};

/** Derive the minutes fields from the grid rows (deduplicated by name). */
export function attendancePatchFromRows(rows: readonly AttendanceGridRow[]): { attendees: string[]; absent: string[]; detailedAttendance: DetailedAttendanceRow[] } {
  const seen = new Set<string>();
  const detailedAttendance: DetailedAttendanceRow[] = [];
  for (const row of rows) {
    const name = String(row.name ?? "").replace(/\s+/g, " ").trim();
    const key = normalizePersonKey(name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const status = normalizeAttendanceStatus(row.status);
    const out: DetailedAttendanceRow = { name, status, quorumCounted: typeof row.quorumCounted === "boolean" ? row.quorumCounted : defaultQuorumCounted(status) };
    for (const field of ["roleTitle", "affiliation", "representedOrganization", "memberIdentifier", "personId", "proxyFor", "notes"] as const) {
      const value = clean(row[field]);
      if (value) out[field] = value;
    }
    detailedAttendance.push(out);
  }
  return {
    attendees: detailedAttendance.filter((row) => IN_ATTENDANCE_STATUSES.has(row.status)).map((row) => row.name),
    absent: detailedAttendance.filter((row) => NOT_ATTENDING_STATUSES.has(row.status)).map((row) => row.name),
    detailedAttendance,
  };
}

/** Present quorum count from a minutes record (detailed rows first). */
export function minutesPresentCount(minutes: any): number {
  const detailed = Array.isArray(minutes?.detailedAttendance) ? minutes.detailedAttendance : [];
  if (detailed.length) return detailed.filter((row: any) => normalizeAttendanceStatus(row?.status) === "present").length;
  return Array.isArray(minutes?.attendees) ? minutes.attendees.length : 0;
}
