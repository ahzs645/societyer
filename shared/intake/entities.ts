/** Stage 7 helpers: deterministic entity resolution for people, bodies and
 * meetings. Ambiguous cases are returned as candidates for review (or LLM
 * adjudication), never silently merged. */
import { bodyFromText } from "./minutes/extractMinutes";
import { initialsOf, levenshtein, normalizePersonKey, referenceMatches, similarNames } from "./names";

export type DirectoryPerson = { id: string; fullName: string; aliases?: string[] };
export type OfficeTerm = { personId: string; title: string; start?: string; end?: string };
export type PersonCandidate = { personId: string; fullName: string; score: number; reason: string };
export type PersonResolution = { reference: string; status: "matched" | "ambiguous" | "unmatched"; personId?: string; candidates: PersonCandidate[] };

const OFFICE_WORDS = /\b(?:president|vice[- ]president|vp|secretary|treasurer|chair(?:person)?|co-chair|past president|executive director|coordinator)\b/i;

/** Office title written instead of a name ("Vice President", "the Chair") → holder on that date. */
export function officeHolderOn(title: string, date: string | undefined, terms: OfficeTerm[]): OfficeTerm[] {
  const wanted = title.toLowerCase().replace(/^the\s+/, "").replace(/vice[- ]president/, "vice president").replace(/^vp$/, "vice president").replace(/chairperson/, "chair").trim();
  return terms.filter((term) => {
    const held = term.title.toLowerCase().replace(/vice[- ]president/, "vice president").replace(/chairperson/, "chair");
    if (held !== wanted) return false;
    if (!date) return true;
    return (!term.start || term.start <= date) && (!term.end || date <= term.end);
  });
}

export function resolvePerson(reference: string, directory: DirectoryPerson[], options: { date?: string; terms?: OfficeTerm[]; contextNames?: string[] } = {}): PersonResolution {
  const ref = reference.trim();
  const key = normalizePersonKey(ref);
  const candidates: PersonCandidate[] = [];
  const push = (person: DirectoryPerson, score: number, reason: string) => {
    const existing = candidates.find((candidate) => candidate.personId === person.id);
    if (existing) {
      if (score > existing.score) Object.assign(existing, { score, reason });
    } else candidates.push({ personId: person.id, fullName: person.fullName, score, reason });
  };
  if (OFFICE_WORDS.test(ref) && options.terms?.length && ref.split(/\s+/).length <= 3) {
    for (const term of officeHolderOn(ref, options.date, options.terms)) {
      const person = directory.find((candidate) => candidate.id === term.personId);
      if (person) push(person, 0.8, `Held the office "${term.title}" on ${options.date ?? "the meeting date"}`);
    }
  }
  for (const person of directory) {
    const names = [person.fullName, ...(person.aliases ?? [])];
    if (names.some((name) => normalizePersonKey(name) === key)) push(person, 1, "Exact name or alias");
    else if (names.some((name) => similarNames(name, ref))) push(person, 0.85, "Spelling variant (edit distance)");
    else if (names.some((name) => referenceMatches(ref, name))) push(person, /^[A-Z]{2,3}$/.test(ref) ? 0.55 : 0.7, /^[A-Z]{2,3}$/.test(ref) ? "Initials" : "Short form (first name, surname or initial)");
  }
  // Prefer people who appear in the same document when a short form is ambiguous.
  if (options.contextNames?.length) {
    for (const candidate of candidates) if (options.contextNames.some((name) => normalizePersonKey(name) === normalizePersonKey(candidate.fullName))) candidate.score = Math.min(1, candidate.score + 0.1);
  }
  candidates.sort((a, b) => b.score - a.score);
  const [top, second] = candidates;
  if (!top) return { reference: ref, status: "unmatched", candidates };
  if (top.score >= 0.85 && (!second || top.score - second.score >= 0.1)) return { reference: ref, status: "matched", personId: top.personId, candidates };
  if (top.score >= 0.7 && !second) return { reference: ref, status: "matched", personId: top.personId, candidates };
  return { reference: ref, status: "ambiguous", candidates };
}

/** Build a directory from names seen across a run (people-directory bootstrap):
 * spelling variants and short forms collapse onto the longest full name. */
export function buildDirectoryFromOccurrences(names: string[]): DirectoryPerson[] {
  const full = [...new Set(names.map((name) => name.trim()).filter((name) => name.split(/\s+/).length >= 2))].sort((a, b) => b.length - a.length);
  const people: DirectoryPerson[] = [];
  for (const name of full) {
    const match = people.find((person) => similarNames(person.fullName, name) || levenshtein(normalizePersonKey(person.fullName), normalizePersonKey(name)) <= 1);
    if (match) {
      if (!match.aliases!.includes(name)) match.aliases!.push(name);
    } else people.push({ id: `person:${normalizePersonKey(name).replace(/\s+/g, "-")}`, fullName: name, aliases: [] });
  }
  return people;
}

// ---------------------------------------------------------------- bodies
export type BodyAlias = { key: string; label: string; aliases: string[] };
export const DEFAULT_BODY_ALIASES: BodyAlias[] = [
  { key: "board", label: "Board of Directors", aliases: ["board", "board of directors", "directors", "directors meeting", "director's meeting", "bod", "board meeting"] },
  { key: "executive", label: "Executive Committee", aliases: ["executive", "exec", "executive committee"] },
  { key: "operations", label: "Operations Committee", aliases: ["operations", "ops", "operations committee", "operations/executive", "operations executive"] },
  { key: "agm", label: "Annual General Meeting", aliases: ["agm", "annual general meeting", "annual meeting"] },
  { key: "sgm", label: "Special General Meeting", aliases: ["sgm", "special general meeting", "extraordinary general meeting"] },
];

export function bodyKeyFor(label: string | undefined, aliases: BodyAlias[] = DEFAULT_BODY_ALIASES): string {
  if (!label) return "unknown";
  const clean = label.toLowerCase().replace(/[_\-–]+/g, " ").replace(/\bmeeting\b|\bminutes\b/g, " ").replace(/\s+/g, " ").trim();
  for (const alias of aliases) if (alias.aliases.some((candidate) => clean === candidate || clean.includes(` ${candidate} `) || clean.startsWith(`${candidate} `) || clean.endsWith(` ${candidate}`))) return alias.key;
  const found = bodyFromText(label);
  if (!found) return "unknown";
  return found.body === "committee" ? `committee:${found.label.toLowerCase().replace(/\s+committee$/, "").replace(/\s+/g, "-")}` : found.body;
}

/** Stable meeting identity: body + day. Two sources describe the same meeting
 * when their keys match, or the bodies match and the dates are within `toleranceDays`. */
export function meetingKey(bodyKey: string, dateIso: string): string {
  return `${bodyKey}@${dateIso}`;
}
export function sameMeeting(a: { bodyKey: string; date: string }, b: { bodyKey: string; date: string }, toleranceDays = 0): boolean {
  if (a.bodyKey !== b.bodyKey && a.bodyKey !== "unknown" && b.bodyKey !== "unknown") return false;
  const diff = Math.abs(Date.parse(`${a.date}T00:00:00Z`) - Date.parse(`${b.date}T00:00:00Z`)) / 86400000;
  return diff <= toleranceDays;
}

export { initialsOf };
