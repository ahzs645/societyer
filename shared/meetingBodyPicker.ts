/**
 * Meeting body picker (schema B8): one control covering the board, general
 * meetings (AGM / SGM), every committee (Executive, Operations, working
 * groups, ...), "special" meetings of the board or a committee, and meetings
 * of an external body that the society attended (A18).
 *
 * A body choice is encoded as a string so it fits a single <select>:
 *   board · board:special · agm · sgm · committee:<id> · committee:<id>:special · external
 *
 * Pure module.
 */

export type BodyCommittee = { _id: string; name: string; status?: string | null; kind?: string | null };

export type BodyChoice = { value: string; label: string; group: string };

export type MeetingBodyFields = {
  type?: string | null;
  committeeId?: string | null;
  special?: boolean | null;
  hostBody?: string | null;
  externalOrganization?: string | null;
};

export type MeetingBodyPatch = {
  type: "Board" | "Committee" | "AGM" | "SGM";
  committeeId?: string;
  clearCommitteeId?: boolean;
  special: boolean;
  hostBody: "own" | "external";
};

export function meetingBodyOptions(committees: readonly BodyCommittee[] | null | undefined): BodyChoice[] {
  const options: BodyChoice[] = [
    { value: "board", label: "Board of directors", group: "Governing bodies" },
    { value: "board:special", label: "Special board meeting", group: "Governing bodies" },
    { value: "agm", label: "Annual general meeting (AGM)", group: "Members" },
    { value: "sgm", label: "Special general meeting (SGM)", group: "Members" },
  ];
  const sorted = [...(committees ?? [])].sort((a, b) => String(a.name).localeCompare(String(b.name)));
  for (const committee of sorted) {
    const inactive = committee.status && /inactive|dissolved|archived/i.test(committee.status) ? " (inactive)" : "";
    options.push({ value: `committee:${committee._id}`, label: `${committee.name}${inactive}`, group: "Committees" });
    options.push({ value: `committee:${committee._id}:special`, label: `Special meeting — ${committee.name}`, group: "Committees" });
  }
  options.push({ value: "external", label: "External body (attended)", group: "Other" });
  return options;
}

/** Current picker value for a meeting. */
export function bodyValueForMeeting(meeting: MeetingBodyFields | null | undefined): string {
  if (!meeting) return "board";
  if (meeting.hostBody === "external") return "external";
  const type = String(meeting.type ?? "").toLowerCase();
  if (type === "agm") return "agm";
  if (type === "sgm") return "sgm";
  if (meeting.committeeId) return `committee:${meeting.committeeId}${meeting.special ? ":special" : ""}`;
  if (type === "committee") return "committee:";
  return meeting.special ? "board:special" : "board";
}

/** Fields to write for a picked body. */
export function bodyPatchForValue(value: string): MeetingBodyPatch {
  if (value === "agm") return { type: "AGM", clearCommitteeId: true, special: false, hostBody: "own" };
  if (value === "sgm") return { type: "SGM", clearCommitteeId: true, special: false, hostBody: "own" };
  if (value === "board:special") return { type: "Board", clearCommitteeId: true, special: true, hostBody: "own" };
  if (value === "external") return { type: "Committee", clearCommitteeId: true, special: false, hostBody: "external" };
  if (value.startsWith("committee:")) {
    const rest = value.slice("committee:".length);
    const special = rest.endsWith(":special");
    const committeeId = special ? rest.slice(0, -":special".length) : rest;
    return committeeId
      ? { type: "Committee", committeeId, special, hostBody: "own" }
      : { type: "Committee", clearCommitteeId: true, special, hostBody: "own" };
  }
  return { type: "Board", clearCommitteeId: true, special: false, hostBody: "own" };
}

/** Human label for a meeting's body ("Special board meeting", "Executive Committee"). */
export function meetingBodyLabel(meeting: MeetingBodyFields | null | undefined, committees?: readonly BodyCommittee[] | null): string {
  if (!meeting) return "";
  if (meeting.hostBody === "external") return meeting.externalOrganization ? `External — ${meeting.externalOrganization}` : "External body";
  const type = String(meeting.type ?? "");
  if (type === "AGM") return "AGM";
  if (type === "SGM") return "SGM";
  if (meeting.committeeId) {
    const committee = (committees ?? []).find((row) => String(row._id) === String(meeting.committeeId));
    const name = committee?.name ?? "Committee";
    return meeting.special ? `Special — ${name}` : name;
  }
  if (type === "Committee") return "Committee (unassigned)";
  return meeting.special ? "Special board" : "Board";
}

/** Validation message for a body choice, or null. */
export function bodyChoiceIssue(value: string, externalOrganization?: string | null): string | null {
  if (value === "committee:" || value === "committee::special") return "Choose which committee met.";
  if (value === "external" && !String(externalOrganization ?? "").trim()) return "Name the external organization whose meeting was attended.";
  return null;
}
