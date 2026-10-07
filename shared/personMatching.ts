/**
 * Fuzzy person matching for identity review (WP-H, findings P7, P10, P11, P13).
 *
 * Pure and deterministic. Never decides an identity: every result is a
 * suggestion with a reason that a reviewer confirms or dismisses.
 */
import { normalizeSearchName } from "./peopleDirectory";

/** Common English given-name variants. Keys and values are normalized. */
const NICKNAME_GROUPS: string[][] = [
  ["alexander", "alex", "alec", "sandy", "xander"],
  ["alexandra", "alex", "alexa", "sandra", "sandy"],
  ["andrew", "andy", "drew"],
  ["anthony", "tony"],
  ["barbara", "barb", "barbie", "babs"],
  ["benjamin", "ben", "benny"],
  ["catherine", "cathy", "cath", "kate", "katie", "kathy", "katherine", "kathryn"],
  ["charles", "charlie", "chuck", "chas"],
  ["christine", "chris", "christina", "tina", "chrissy"],
  ["christopher", "chris", "topher"],
  ["cynthia", "cindy", "cindi"],
  ["daniel", "dan", "danny"],
  ["daniela", "dani", "daniella"],
  ["david", "dave", "davey"],
  ["deborah", "debbie", "deb", "debra"],
  ["donald", "don", "donny"],
  ["douglas", "doug"],
  ["edward", "ed", "eddie", "ted", "ned"],
  ["elizabeth", "liz", "beth", "betty", "lisa", "eliza", "libby"],
  ["frederick", "fred", "freddie"],
  ["gerald", "gerry", "jerry"],
  ["gregory", "greg"],
  ["jeffrey", "jeff"],
  ["jennifer", "jen", "jenny"],
  ["jerome", "jerry"],
  ["john", "johnny", "jack", "jon"],
  ["jonathan", "jon", "jonny"],
  ["joseph", "joe", "joey"],
  ["kenneth", "ken", "kenny"],
  ["kimberly", "kim", "kimberley"],
  ["lawrence", "larry", "laurie", "lorne"],
  ["margaret", "maggie", "peggy", "meg", "marg", "margie"],
  ["matthew", "matt"],
  ["michael", "mike", "mick", "mikey"],
  ["nicholas", "nick", "nicky"],
  ["patricia", "pat", "patty", "trish"],
  ["patrick", "pat", "paddy"],
  ["peter", "pete"],
  ["rebecca", "becky", "becca"],
  ["richard", "rick", "dick", "rich", "ricky"],
  ["robert", "rob", "bob", "bobby", "robbie", "bert"],
  ["ronald", "ron", "ronnie"],
  ["samantha", "sam", "sammy"],
  ["samuel", "sam", "sammy"],
  ["stephen", "steve", "steven", "stevie"],
  ["susan", "sue", "suzy", "susie"],
  ["terrence", "terry", "terence"],
  ["theresa", "terri", "tess", "teresa", "tessa"],
  ["thomas", "tom", "tommy"],
  ["timothy", "tim", "timmy"],
  ["victoria", "vicky", "tori"],
  ["william", "will", "bill", "billy", "willy", "liam"],
];

const NICKNAMES = new Map<string, Set<string>>();
for (const group of NICKNAME_GROUPS) {
  for (const name of group) {
    const set = NICKNAMES.get(name) ?? new Set<string>();
    for (const other of group) if (other !== name) set.add(other);
    NICKNAMES.set(name, set);
  }
}

/** Levenshtein distance, bounded: returns max+1 as soon as the bound is exceeded. */
export function editDistance(a: string, b: string, max = 3): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + cost);
      if (row[j] < best) best = row[j];
    }
    if (best > max) return max + 1;
    prev = row;
  }
  return prev[b.length];
}

export function nameTokens(name: string): string[] {
  return normalizeSearchName(name).split(" ").filter(Boolean);
}

/** True when two given names are plausibly the same person's name. */
export function givenNamesCompatible(a: string, b: string): "same" | "nickname" | "prefix" | "spelling" | null {
  if (!a || !b) return null;
  if (a === b) return "same";
  if (NICKNAMES.get(a)?.has(b)) return "nickname";
  if (a.length >= 3 && b.length >= 3 && (a.startsWith(b) || b.startsWith(a))) return "prefix";
  if (Math.min(a.length, b.length) >= 4 && editDistance(a, b, 1) <= 1) return "spelling";
  return null;
}

/** True when two surnames are plausibly the same (exact or a small spelling variant). */
export function surnamesCompatible(a: string, b: string): "same" | "spelling" | null {
  if (!a || !b) return null;
  if (a === b) return "same";
  const limit = Math.min(a.length, b.length) >= 7 ? 2 : 1;
  if (Math.min(a.length, b.length) >= 4 && editDistance(a, b, limit) <= limit) return "spelling";
  return null;
}

export type MatchablePerson = {
  id: string;
  fullName: string;
  aliases?: string[];
  /** Meeting ids the person was observed at (for first-name-only scoring). */
  meetingIds?: string[];
  /** Observed date range (YYYY…). */
  firstObserved?: string;
  lastObserved?: string;
  occurrenceCount?: number;
  distinctFromIds?: string[];
};

export type DuplicateSuggestion = {
  /** Suggested survivor (more observations), then the other profile. */
  ids: [string, string];
  names: [string, string];
  score: number;
  reasons: string[];
  /** Co-attendance: both profiles listed at the same meeting — a sign they are different people. */
  sharedMeetings: number;
};

function forms(p: MatchablePerson): string[][] {
  return [p.fullName, ...(p.aliases ?? [])].map(nameTokens).filter((t) => t.length > 0);
}

/** Compare two token lists. Returns a score (0 = no match) and reasons. */
export function compareNames(a: string[], b: string[]): { score: number; reasons: string[] } {
  if (!a.length || !b.length) return { score: 0, reasons: [] };
  if (a.join(" ") === b.join(" ")) return { score: 100, reasons: ["Same name (ignoring case, accents and punctuation)"] };
  // Single given name versus a full name with that given name.
  if (a.length === 1 || b.length === 1) {
    const [single, full] = a.length === 1 ? [a, b] : [b, a];
    if (full.length === 1) {
      const g = givenNamesCompatible(single[0], full[0]);
      return g && g !== "same" ? { score: 40, reasons: [`Given names ${g === "nickname" ? "are common variants" : "differ by spelling"}`] } : { score: 0, reasons: [] };
    }
    const g = givenNamesCompatible(single[0], full[0]);
    if (g) return { score: 35, reasons: [`First name only ("${single[0]}") matches ${g === "same" ? "the given name" : "a variant of the given name"}`] };
    return { score: 0, reasons: [] };
  }
  const reasons: string[] = [];
  // Token-subset: "Gina Layte" vs "Gina Layte Liston".
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  if (short.length >= 2 && short.every((t) => long.includes(t))) {
    return { score: 70, reasons: ["One name contains the other (middle or married name)"] };
  }
  const given = givenNamesCompatible(a[0], b[0]);
  const surname = surnamesCompatible(a[a.length - 1], b[b.length - 1]);
  if (!given || !surname) return { score: 0, reasons: [] };
  let score = 50;
  if (given === "same") reasons.push("Same given name");
  else { reasons.push(given === "nickname" ? "Given names are common variants" : given === "prefix" ? "One given name is a short form of the other" : "Given names differ by one letter"); }
  if (surname === "same") { reasons.push("Same surname"); score += 25; }
  else reasons.push("Surnames differ by spelling");
  if (given === "same") score += 15;
  if (given === "same" && surname === "same") score = 90;
  return { score, reasons };
}

/**
 * Suggest pairs of directory profiles that may be the same person.
 * Spelling variants, nicknames, case/diacritics, token subsets and
 * first-name-only profiles (scored by observation overlap) are considered.
 */
export function suggestDuplicatePeople(people: MatchablePerson[], { minScore = 35, limit = 200 } = {}): DuplicateSuggestion[] {
  const result: DuplicateSuggestion[] = [];
  const tokenized = people.map((p) => ({ p, forms: forms(p), meetings: new Set(p.meetingIds ?? []) }));
  for (let i = 0; i < tokenized.length; i++) {
    for (let j = i + 1; j < tokenized.length; j++) {
      const A = tokenized[i], B = tokenized[j];
      if (A.p.distinctFromIds?.includes(B.p.id) || B.p.distinctFromIds?.includes(A.p.id)) continue;
      let best = { score: 0, reasons: [] as string[] };
      for (const fa of A.forms) for (const fb of B.forms) {
        const r = compareNames(fa, fb);
        if (r.score > best.score) best = r;
      }
      if (best.score < minScore) continue;
      let shared = 0;
      for (const m of A.meetings) if (B.meetings.has(m)) shared++;
      let score = best.score;
      const reasons = [...best.reasons];
      if (shared > 0) {
        score -= Math.min(30, shared * 10);
        reasons.push(`Both listed at ${shared} of the same meeting${shared === 1 ? "" : "s"} (may be different people)`);
      } else if (A.p.firstObserved && B.p.firstObserved && A.p.lastObserved && B.p.lastObserved) {
        const overlaps = A.p.firstObserved.slice(0, 4) <= B.p.lastObserved.slice(0, 4) && B.p.firstObserved.slice(0, 4) <= A.p.lastObserved.slice(0, 4);
        if (overlaps) { score += 5; reasons.push("Observed in overlapping years, never together"); }
      }
      if (score < minScore) continue;
      const aFirst = (A.p.occurrenceCount ?? 0) >= (B.p.occurrenceCount ?? 0);
      const [x, y] = aFirst ? [A.p, B.p] : [B.p, A.p];
      result.push({ ids: [x.id, y.id], names: [x.fullName, y.fullName], score: Math.min(100, score), reasons, sharedMeetings: shared });
    }
  }
  return result.sort((a, b) => b.score - a.score || a.names[0].localeCompare(b.names[0])).slice(0, limit);
}

/**
 * Directory people whose name could be the person behind a source name.
 * Exact name/alias matches come first; a single given name lists every
 * person with that given name or a common variant (P11).
 */
export function candidatePeopleForName<T extends { _id: string; fullName: string; aliases?: string[] }>(people: T[], sourceName: string, { fuzzy = true }: { fuzzy?: boolean } = {}): Array<{ person: T; reason: "exact" | "given_name" | "variant" }> {
  const tokens = nameTokens(sourceName.replace(/^\s*([^,]+),\s*([^,]+)$/, "$2 $1"));
  if (!tokens.length) return [];
  const key = tokens.join(" ");
  const exact: Array<{ person: T; reason: "exact" }> = [];
  const loose: Array<{ person: T; reason: "given_name" | "variant" }> = [];
  for (const person of people) {
    const all = [person.fullName, ...(person.aliases ?? [])].map(nameTokens);
    if (all.some((t) => t.join(" ") === key)) { exact.push({ person, reason: "exact" }); continue; }
    if (tokens.length === 1) {
      const g = all.map((t) => givenNamesCompatible(tokens[0], t[0] ?? "")).find(Boolean);
      if (g) loose.push({ person, reason: g === "same" ? "given_name" : "variant" });
    } else if (fuzzy) {
      const r = all.map((t) => compareNames(tokens, t)).sort((a, b) => b.score - a.score)[0];
      if (r && r.score >= 60) loose.push({ person, reason: "variant" });
    }
  }
  return [...exact, ...loose];
}

/** Leading role words removed before matching a fragment to a person (P10). */
const ROLE_PREFIX = /^(?:(?:acting|interim|past|co|vice|deputy|assistant|executive)[\s-]+)*(?:president|chair(?:person)?|secretary|treasurer|director|coordinator|manager|member|councill?or|mayor|regrets?|present|absent|guest|staff|recorder|minutes?|observer)\b[\s,:-]*/i;

export function stripRoleAffixes(fragment: string): string {
  let text = fragment.trim();
  for (let i = 0; i < 4; i++) {
    const next = text.replace(ROLE_PREFIX, "").trim();
    if (next === text) break;
    text = next;
  }
  return text.replace(/\s*[,(-]?\s*(?:regrets?|present|absent|chair|secretary|treasurer)\)?\s*$/i, "").trim();
}

/**
 * People whose full name (or alias) appears inside a source fragment, as
 * whole words. "Kim Menounos Northern Health Wayne Rommerdahl" → both people;
 * "Secretary Ministry of Transportation Barb Oke" → Barb Oke.
 */
export function peopleNamedInFragment<T extends { _id: string; fullName: string; aliases?: string[] }>(people: T[], fragment: string): T[] {
  const text = ` ${nameTokens(fragment).join(" ")} `;
  const found: Array<{ person: T; at: number }> = [];
  for (const person of people) {
    for (const name of [person.fullName, ...(person.aliases ?? [])]) {
      const tokens = nameTokens(name);
      if (tokens.length < 2) continue;
      const at = text.indexOf(` ${tokens.join(" ")} `);
      if (at >= 0) { found.push({ person, at }); break; }
    }
  }
  return found.sort((a, b) => a.at - b.at).map((f) => f.person);
}

/** Directory search: prefix of the full name, of any word in it, or of an alias (P13). */
export function personMatchesSearch(person: { fullName: string; firstName?: string; lastName?: string; aliases?: string[] }, query: string): boolean {
  const q = normalizeSearchName(query);
  if (!q) return true;
  const names = [person.fullName, ...(person.aliases ?? []), [person.lastName, person.firstName].filter(Boolean).join(" ")].filter(Boolean);
  return names.some((name) => {
    const n = normalizeSearchName(name);
    return n.startsWith(q) || ` ${n}`.includes(` ${q}`);
  });
}
