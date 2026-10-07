/**
 * Meeting body (governing body / committee) inference, identity keys and
 * title cleanup for imported meetings (C5, meeting identity, F5/F6).
 *
 * A meeting's identity for import is its calendar date plus its body ("board",
 * "agm", "committee:operations", ...), not its title. Titles built from file
 * names ("2013-05-14 PGAIRExecutiveMinutes_May_ 2013 DRAFT.docx") or generic
 * header lines ("Subject: Meeting Minutes") never matched, so draft, approved
 * and copy variants became separate meetings while generic titles merged an
 * AGM and a Board meeting held the same evening.
 *
 * Pure module.
 */

export type MeetingBody = {
  /** Native meeting type: Board | Committee | AGM | SGM. */
  type: "Board" | "Committee" | "AGM" | "SGM";
  /** Stable identity key: board | agm | sgm | committee:<slug> | external:<slug>. */
  bodyKey: string;
  /** Committee display name when type is Committee. */
  committeeName?: string;
  /** Committee slug (bodyKey without the prefix). */
  committeeKey?: string;
  /** A special (not regular) meeting of the same body. */
  special?: boolean;
  /** "default" when nothing in the payload named a body (Board assumed). */
  basis?: "explicit" | "title" | "default";
};

export function slugBody(value: unknown): string {
  return String(value ?? "")
    .normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\b(?:the|of|pgair|society|meeting|meetings|minutes)\b/g, " ")
    .replace(/\bcommittee\b/g, " ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

type BodyRule = { test: RegExp; name: string; key: string };

/** Ordered: the first match wins. "Executive/Operations" reads as Executive. */
const COMMITTEE_RULES: BodyRule[] = [
  { test: /\bexecutive\b/i, name: "Executive Committee", key: "executive" },
  { test: /\boperations?\b|\bops\b/i, name: "Operations Committee", key: "operations" },
  { test: /\bstrategic\b|\bspc\b/i, name: "Strategic Planning Committee", key: "strategic-planning" },
  { test: /\bsecretariat\b/i, name: "Secretariat Strategy Working Group", key: "secretariat" },
  { test: /\baqmp\b|air quality management plan/i, name: "AQMP", key: "aqmp" },
  { test: /\bmwg\b/i, name: "MWG", key: "mwg" },
];

/** Infer the meeting body from a title, filename or heading. */
export function inferMeetingBody(text: unknown): MeetingBody {
  const value = String(text ?? "").replace(/[_]+/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").replace(/([A-Z])([A-Z][a-z])/g, "$1 $2");
  const special = /\bspecial\b/i.test(value);
  if (/\bannual general\b|\bagm\b/i.test(value)) return { type: "AGM", bodyKey: "agm" };
  if (/\b(?:special|extraordinary) general\b|\bsgm\b|\begm\b/i.test(value)) return { type: "SGM", bodyKey: "sgm" };
  for (const rule of COMMITTEE_RULES) {
    if (rule.test.test(value)) return { type: "Committee", bodyKey: `committee:${rule.key}`, committeeName: rule.name, committeeKey: rule.key, special: special || undefined };
  }
  const workingGroup = value.match(/([A-Z][A-Za-z&'-]*(?:\s+[A-Z][A-Za-z&'-]*){0,4})\s+Working Group/);
  if (workingGroup || /\bworking group\b/i.test(value)) {
    const name = workingGroup ? `${workingGroup[1]} Working Group` : "Working Group";
    const key = slugBody(name) || "working-group";
    return { type: "Committee", bodyKey: `committee:${key}`, committeeName: name, committeeKey: key, special: special || undefined };
  }
  const committee = value.match(/([A-Z][A-Za-z&'-]*(?:\s+[A-Z][A-Za-z&'-]*){0,4})\s+Committee/);
  if (committee || /\bcommittee\b/i.test(value)) {
    const name = committee ? `${committee[1]} Committee` : "Committee";
    const key = slugBody(name) || "committee";
    return { type: "Committee", bodyKey: `committee:${key}`, committeeName: name, committeeKey: key, special: special || undefined };
  }
  return { type: "Board", bodyKey: "board", special: special || undefined };
}

/** Body for an import payload: explicit fields win over title inference. */
export function meetingBodyFromImport(payload: {
  meetingType?: unknown; body?: unknown; bodyKey?: unknown; committeeName?: unknown; meetingTitle?: unknown;
  sourceDocumentTitle?: unknown; hostBody?: unknown; externalOrganization?: unknown;
}): MeetingBody & { external?: string } {
  if (String(payload.hostBody ?? "") === "external" && String(payload.externalOrganization ?? "").trim()) {
    const org = String(payload.externalOrganization).trim();
    return { type: "Committee", bodyKey: `external:${slugBody(org)}`, external: org };
  }
  const committeeName = String(payload.committeeName ?? "").trim();
  if (committeeName) {
    const inferred = inferMeetingBody(committeeName);
    const key = inferred.committeeKey ?? (slugBody(committeeName) || "committee");
    return { type: "Committee", bodyKey: `committee:${key}`, committeeName: inferred.committeeName ?? committeeName, committeeKey: key };
  }
  const explicit = String(payload.body ?? payload.bodyKey ?? "").trim();
  if (explicit) {
    const lower = explicit.toLowerCase();
    if (lower === "board" || lower === "board of directors" || lower === "directors") return { type: "Board", bodyKey: "board" };
    if (lower.startsWith("committee:")) {
      const key = slugBody(explicit.slice(10)) || "committee";
      const inferred = inferMeetingBody(explicit.slice(10));
      return { type: "Committee", bodyKey: `committee:${key}`, committeeName: inferred.committeeName ?? explicit.slice(10).trim(), committeeKey: key };
    }
    const inferred = inferMeetingBody(explicit);
    if (inferred.type !== "Board") return inferred;
    if (inferred.type === "Board" && !/board|director/i.test(explicit)) {
      const key = slugBody(explicit) || "committee";
      return { type: "Committee", bodyKey: `committee:${key}`, committeeName: explicit, committeeKey: key };
    }
    return inferred;
  }
  const type = String(payload.meetingType ?? "").trim();
  const fromTitle = inferMeetingBody(`${payload.meetingTitle ?? ""} ${payload.sourceDocumentTitle ?? ""}`);
  if (/^agm$/i.test(type)) return { type: "AGM", bodyKey: "agm" };
  if (/^sgm$/i.test(type)) return { type: "SGM", bodyKey: "sgm" };
  if (/^board$/i.test(type)) return { type: "Board", bodyKey: "board", special: fromTitle.special };
  if (/^committee$/i.test(type) && fromTitle.type === "Committee") return { ...fromTitle, basis: "title" };
  // A committee meeting whose committee is not named: no committee is created.
  if (/^committee$/i.test(type)) return { type: "Committee", bodyKey: "committee:unnamed", basis: "explicit" };
  if (fromTitle.type === "Board" && !/\b(?:board|directors?)\b/i.test(`${payload.meetingTitle ?? ""} ${payload.sourceDocumentTitle ?? ""}`)) return { ...fromTitle, basis: "default" };
  return { ...fromTitle, basis: "title" };
}

/** Identity key for an existing meeting row. */
export function bodyKeyForMeeting(
  meeting: { type?: string | null; committeeId?: string | null; hostBody?: string | null; externalOrganization?: string | null; title?: string | null },
  committee?: { name?: string | null; bodyKey?: string | null } | null,
): string {
  if (meeting.hostBody === "external" && meeting.externalOrganization) return `external:${slugBody(meeting.externalOrganization)}`;
  const type = String(meeting.type ?? "").toLowerCase();
  if (type === "agm") return "agm";
  if (type === "sgm") return "sgm";
  if (meeting.committeeId && committee) {
    const key = committee.bodyKey || inferMeetingBody(committee.name).committeeKey || slugBody(committee.name) || "committee";
    return `committee:${key}`;
  }
  if (type === "committee") {
    const inferred = inferMeetingBody(meeting.title);
    return inferred.type === "Committee" ? inferred.bodyKey : "committee:unnamed";
  }
  return "board";
}

/** True for titles that are file names or generic header lines, not names. */
export function isFilenameOrGenericMeetingTitle(title: unknown): boolean {
  const value = String(title ?? "").trim();
  if (!value) return true;
  if (/\.(?:docx?|pdf|rtf|odt|txt|xlsx?|msg)\b/i.test(value)) return true;
  if (/\bsection \d+$/i.test(value)) return true;
  if (/^\|/.test(value) || /\s\|\s/.test(value)) return true;
  if (/^(?:subject:|re:|fw:)/i.test(value)) return true;
  if (/^(?:draft\s+)?(?:board\s+|directors\s+)?meeting minutes:?(?:\s*\(?draft\)?)?$/i.test(value)) return true;
  if (/^minutes of (?:the )?meeting$/i.test(value)) return true;
  if (/^\d{4}-\d{2}-\d{2}\s+\S+/.test(value) && /[_]|\b(?:draft|approved|final|copy)\b/i.test(value)) return true;
  return false;
}

const BODY_TITLE: Record<string, string> = { board: "Board", agm: "Annual general", sgm: "Special general" };

/** "<Body> meeting — <date>" title used to replace file-name titles. */
export function cleanMeetingTitle(args: { bodyKey: string; committeeName?: string | null; special?: boolean; date: string; external?: string | null }): string {
  const date = String(args.date ?? "").slice(0, 10);
  const body = args.external
    ? `${args.external}`
    : args.bodyKey.startsWith("committee:")
      ? args.committeeName || "Committee"
      : BODY_TITLE[args.bodyKey] ?? "Board";
  const special = args.special && !/special/i.test(body) ? "Special " : "";
  const name = `${special}${special ? body.charAt(0).toLowerCase() + body.slice(1) : body}`;
  return `${name} meeting — ${date}`;
}

/** Source-version status from a file name or heading: draft / unknown. */
export function sourceVersionStatusFromLabel(label: unknown): "draft" | "unknown" {
  return /\bdraft\b/i.test(String(label ?? "").replace(/_/g, " ")) ? "draft" : "unknown";
}

/** Strip table-pipe artifacts ("| Welcome", "Funds | approval |") from a heading. */
export function stripTablePipes(title: unknown): string {
  return String(title ?? "")
    .replace(/^\s*(?:\|\s*)+/, "")
    .replace(/(?:\s*\|)+\s*$/, "")
    .replace(/\s*\|\s*(?:\|\s*)*/g, " — ")
    .replace(/\s+/g, " ")
    .trim();
}
