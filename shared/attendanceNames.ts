/**
 * Attendance-name screening for imports.
 *
 * Rule-based minutes parsers put role words ("Vice President", "Public
 * Member"), organizations ("City of Example"), headings ("Members", "MINUTES",
 * "Teleconference") and fragments into attendee lists. Those must not become
 * attendees (they inflate counts and quorum) but they are still source
 * evidence, so callers keep them as such.
 *
 * Pure module.
 */

export type AttendanceNameKind = "person" | "role" | "organization" | "heading" | "fragment";

export type ScreenedAttendanceName = {
  kind: AttendanceNameKind;
  /** The person's name with any trailing affiliation removed. */
  name: string;
  /** "Gail Example, Ministry of Environment" → "Ministry of Environment". */
  affiliation?: string;
  /** A role written next to the name ("Kim Example (chair)"). */
  roleTitle?: string;
  original: string;
};

const HEADINGS = new Set([
  "member", "members", "members present", "present", "absent", "regrets", "regret", "attendees", "attendance",
  "in attendance", "participants", "guest", "guests", "staff", "directors", "directors present", "board", "board members",
  "minutes", "meeting minutes", "teleconference", "via zoom", "zoom", "ms teams", "teams", "phone", "by phone", "call to order",
  "chair", "recorder", "note taker", "notetaker", "secretary", "others", "other", "none", "n a", "na", "tbd", "all",
  "public", "observers", "observer", "also present", "absent with regrets", "quorum", "agenda",
]);

const ROLE_WORDS = new Set([
  "president", "vice", "vice-president", "past", "secretary", "treasurer", "chair", "chairperson", "chairman", "co-chair",
  "cochair", "director", "directors", "public", "member", "members", "at", "large", "at-large", "coordinator", "executive",
  "manager", "staff", "guest", "observer", "alternate", "recorder", "note", "taker", "notetaker", "minute", "minutes",
  "liaison", "representative", "rep", "ex", "officio", "ex-officio", "acting", "interim", "honorary", "chief", "officer",
  "and", "&", "the", "of", "a", "an", "board", "committee", "elect", "delegate", "proxy", "trustee", "admin", "administrator",
]);

const ORG_MARKERS = /\b(?:ministry|minister|city|district|regional|region|council|society|association|assoc|inc|ltd|llc|corp|corporation|company|co|university|college|school|chamber|commerce|department|dept|government|govt|agency|health|hospital|authority|first nation|nation|band|club|foundation|institute|group|services|service|industries|industry|pulp|paper|hydro|energy|railway|airport|council|centre|center|division|bc|canada|canadian|province|provincial|federal|environment|climate|forest|forests|lung|cancer|partnership|coalition|alliance|credit|enterprises|consulting|consultants|solutions|northern health|interior health|bioenergy|lumber|rail|construction|paving|asphalt|oil|gas|petroleum|refinery|cement|mining|logistics|transportation|productions|products|committee|basin|ltd\.|inc\.)\b/i;

function isAcronymToken(token: string) {
  const bare = token.replace(/[.,()]/g, "");
  if (/^[A-Z]{2,}$/.test(bare)) return true;
  // Mixed-case acronyms ("CoPG", "MoE") — but not Mac/Mc surnames.
  const upper = (bare.match(/[A-Z]/g) ?? []).length;
  const lower = (bare.match(/[a-z]/g) ?? []).length;
  return upper >= 2 && lower <= 2 && /^[A-Za-z]+$/.test(bare);
}
/** Words that begin an organization name ("Ministry of ...", "City of ..."). */
const ORG_PREFIX_WORDS = new Set(["ministry", "city", "district", "regional", "region", "university", "college", "department", "province", "government", "town", "village", "county", "school", "office", "minister"]);
function isRoleToken(token: string) {
  return ROLE_WORDS.has(token.toLowerCase().replace(/[.,()]/g, ""));
}
function isOrgToken(token: string) {
  return ORG_MARKERS.test(token.replace(/[.,()]/g, ""));
}

const NAME_PARTICLES = new Set(["de", "da", "del", "della", "der", "den", "di", "du", "la", "le", "van", "von", "mc", "mac", "st", "st."]);

function clean(value: unknown): string {
  return String(value ?? "")
    .replace(/[’]/g, "'")
    .replace(/^[\s\-–—•*·|:;,]+|[\s\-–—•*·|:;,.]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeHeading(value: string): string {
  return value.toLowerCase().replace(/[^a-z ]+/g, " ").replace(/\s+/g, " ").trim();
}

function looksLikePersonName(value: string): boolean {
  if (!value || /\d/.test(value)) return false;
  const tokens = value.split(/\s+/);
  if (tokens.length > 5) return false;
  let capitalized = 0;
  for (const token of tokens) {
    const bare = token.replace(/[.,]/g, "");
    if (!bare) return false;
    if (NAME_PARTICLES.has(bare.toLowerCase())) continue;
    if (!/^[A-Z][A-Za-z'’\-]*$/.test(bare) && !/^[A-Z]\.?$/.test(bare) && !/^[A-Z][a-z]+-[A-Z][a-z]+$/.test(bare)) return false;
    capitalized += 1;
  }
  if (capitalized === 0) return false;
  // All-caps multi-letter words are headings or acronyms ("MINUTES", "PGAIR").
  if (tokens.every((token) => token.length > 2 && token === token.toUpperCase())) return false;
  return true;
}

function isOnlyRoleWords(value: string): boolean {
  const tokens = value.toLowerCase().replace(/[()]/g, " ").split(/[\s/]+/).filter(Boolean);
  return tokens.length > 0 && tokens.every((token) => ROLE_WORDS.has(token.replace(/[.,]/g, "")));
}

/** Screen one attendance entry. */
export function screenAttendanceName(raw: unknown): ScreenedAttendanceName {
  const original = String(raw ?? "");
  let value = clean(original);
  if (!value) return { kind: "fragment", name: "", original };
  if (/^(?:commented|comment|deleted|inserted|formatted)\b/i.test(value)) return { kind: "fragment", name: value, original };
  if (HEADINGS.has(normalizeHeading(value))) return { kind: "heading", name: value, original };
  if (/^[A-Z]{2,6}$/.test(value)) return { kind: "organization", name: value, original };
  if (/:\s*$/.test(original.trim()) || /^[A-Z ]{4,}$/.test(value) && !looksLikePersonName(value)) return { kind: "heading", name: value, original };
  let roleTitle: string | undefined;
  const paren = value.match(/^(.*?)\s*\(([^)]+)\)\s*$/);
  if (paren && looksLikePersonName(clean(paren[1]))) {
    value = clean(paren[1]);
    roleTitle = clean(paren[2]);
  }
  if (isOnlyRoleWords(value)) return { kind: "role", name: value, original };
  const parts = value.split(/\s*[,–—]\s*|\s+-\s+/).map(clean).filter(Boolean);
  if (parts.length > 1 && looksLikePersonName(parts[0]) && !ORG_MARKERS.test(parts[0])) {
    const rest = parts.slice(1).join(", ");
    if (isOnlyRoleWords(rest)) return { kind: "person", name: parts[0], roleTitle: roleTitle ?? rest, original };
    return { kind: "person", name: parts[0], affiliation: rest, roleTitle, original };
  }
  let tokens = value.split(/\s+/);
  // Leading role words or an organization acronym ("Public Member Jo Example",
  // "PGCoC Jo Example"): the person follows.
  let leadingRole: string | undefined;
  let leadingOrg: string | undefined;
  const lead = tokens.findIndex((token) => !(isRoleToken(token) || isAcronymToken(token)));
  if (lead > 0 && looksLikePersonName(tokens.slice(lead).join(" ")) && tokens.length - lead <= 3 && !tokens.slice(lead).some((token) => isOrgToken(token) || isAcronymToken(token))) {
    const leadTokens = tokens.slice(0, lead);
    if (leadTokens.every(isRoleToken)) leadingRole = leadTokens.join(" ");
    else leadingOrg = leadTokens.join(" ");
    tokens = tokens.slice(lead);
    value = tokens.join(" ");
    return { kind: "person", name: value, roleTitle: roleTitle ?? leadingRole, affiliation: leadingOrg, original };
  }
  if (tokens.every((token) => isRoleToken(token) || isAcronymToken(token))) {
    return { kind: tokens.some(isRoleToken) ? "role" : "organization", name: value, original };
  }
  // "Name Surname Executive Director", "Name Surname Ministry of Environment",
  // "Name Surname ORG": a person followed by a role or an affiliation.
  for (let size = Math.min(3, tokens.length - 1); size >= 2; size -= 1) {
    const head = tokens.slice(0, size);
    const tail = tokens.slice(size);
    if (head.some((token) => isRoleToken(token) || isAcronymToken(token) || isOrgToken(token))) continue;
    if (!looksLikePersonName(head.join(" "))) continue;
    const rest = tail.join(" ");
    if (tail.every(isRoleToken)) return { kind: "person", name: head.join(" "), roleTitle: roleTitle ?? rest, original };
    // "Prince George Chamber of Commerce", "Northern Medical Society": the
    // marker is the organization's own head noun, so this is not a person.
    const tailHead = tail[0].toLowerCase().replace(/[.,()]/g, "");
    if (isOrgToken(tail[0]) && !ORG_PREFIX_WORDS.has(tailHead) && !isAcronymToken(tail[0])) continue;
    if (tail.some((token) => isAcronymToken(token) || isOrgToken(token)) || ORG_MARKERS.test(rest)) {
      const roleLead = tail.findIndex((token) => !isRoleToken(token));
      return roleLead > 0
        ? { kind: "person", name: head.join(" "), roleTitle: roleTitle ?? tail.slice(0, roleLead).join(" "), affiliation: tail.slice(roleLead).join(" "), original }
        : { kind: "person", name: head.join(" "), affiliation: rest, roleTitle, original };
    }
  }
  if (ORG_MARKERS.test(value)) return { kind: "organization", name: value, original };
  if (tokens.some(isAcronymToken)) return { kind: "organization", name: value, original };
  if (looksLikePersonName(value)) return { kind: "person", name: value, roleTitle, original };
  if (value.split(/\s+/).length > 6 || /^[a-z]/.test(value)) return { kind: "fragment", name: value, original };
  if (/^[A-Z]{2,6}$/.test(value)) return { kind: "organization", name: value, original };
  return { kind: "fragment", name: value, original };
}

/** Split an attendance list into people and non-person evidence. */
export function screenAttendanceList(values: unknown[]): { people: ScreenedAttendanceName[]; rejected: ScreenedAttendanceName[] } {
  const people: ScreenedAttendanceName[] = [];
  const rejected: ScreenedAttendanceName[] = [];
  const seen = new Set<string>();
  for (const raw of values ?? []) {
    const screened = screenAttendanceName(raw);
    if (screened.kind === "person") {
      const key = screened.name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      people.push(screened);
    } else if (screened.name) {
      rejected.push(screened);
    }
  }
  return { people, rejected };
}
