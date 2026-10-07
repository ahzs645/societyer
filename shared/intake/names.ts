/** Person-name heuristics shared by the deterministic extractor and entity
 * resolution: role-word filtering, organisation detection and name keys. */

export const ROLE_WORDS = new Set([
  "president", "vice", "vp", "secretary", "treasurer", "chair", "chairperson", "co-chair", "cochair", "director", "directors",
  "coordinator", "manager", "gm", "staff", "member", "members", "facilitator", "recorder", "note-taker", "notetaker", "notes",
  "minute", "minutes", "taker", "executive", "past", "proxy", "guest", "guests", "public", "representative", "rep", "rep.", "alternate",
  "secretariat", "admin", "administrator", "observer", "presenter", "general", "chief", "officer", "ceo", "liaison", "advisor",
  "councillor", "mayor", "dr", "dr.", "mr", "mr.", "mrs", "mrs.", "ms", "ms.", "regrets", "absent", "present", "all", "board", "committee",
]);

const ORG_WORDS = new Set([
  "council", "ministry", "city", "regional", "district", "health", "chamber", "commerce", "university", "college", "school",
  "pulp", "lumber", "energy", "inc", "inc.", "ltd", "ltd.", "limited", "corporation", "corp", "corp.", "society", "association",
  "rail", "railway", "partnership", "authority", "services", "department", "dept", "group", "club", "foundation", "agency",
  "infrastructure", "transportation", "environment", "annex", "hall", "government", "company", "co.",
  "medical", "industries", "network", "institute", "commission", "board", "trustees", "cooperative", "co-op",
  "centre", "center", "office", "branch", "program", "project", "working", "airport", "citizen", "canada",
  "first", "nations", "band", "trust", "fund", "bank", "credit", "union", "church", "museum", "library", "hospital", "clinic",
]);

/** Words that never appear in a person's name but do appear in headings. */
const COMMON_WORDS = new Set(["and", "or", "the", "to", "for", "in", "on", "at", "with", "from", "by", "a", "an", "is", "was", "be", "will", "review", "adopt", "minutes", "meeting", "call", "order", "new", "old", "business", "next", "other", "update", "updates", "report", "reports", "welcome", "approval", "adoption", "agenda", "item", "items", "action", "notes", "discussion", "motion", "budget", "plan", "date", "time", "location", "subject"]);

const PARTICLES = new Set(["de", "van", "von", "der", "den", "la", "le", "du", "da", "di", "del", "st", "st.", "mac", "mc", "o'"]);

export function tokens(value: string): string[] {
  return value.replace(/[(),;:]/g, " ").split(/\s+/).filter(Boolean);
}

export function isRoleWord(word: string): boolean {
  return ROLE_WORDS.has(word.toLowerCase().replace(/[.,:;]+$/, ""));
}
export function isOrgWord(word: string): boolean {
  const bare = word.replace(/[.,:;()]+$/g, "").replace(/^[(]+/, "");
  // Acronyms ("YMCA", "BCIT") and mixed-case abbreviations ("CoV", "MoH") name organisations,
  // unlike surname prefixes ("MacLeod", "McKay", "DeLuca", "O'Hara").
  if (/^[A-Z]{3,}$/.test(bare)) return true;
  if (bare.split("-").some((segment) => (segment.match(/[A-Z]/g) ?? []).length >= 2 && /[a-z]/.test(segment) && !/^(?:Mc|Mac|O['’]|De|Di|Da|Du|Van|Von|La|Le|Fitz|St)[A-Z]/.test(segment))) return true;
  return ORG_WORDS.has(bare.toLowerCase().replace(/['’]s$/, ""));
}

const NAME_TOKEN = /^(?:[A-Z][a-zA-Z'’\-]*\.?|[A-Z]\.(?:[A-Z]\.)?)$/;

/** True when the string reads as a person's name: 2–4 capitalised tokens,
 * no digits, no organisation or role words. "T. Marsh" counts. */
export function looksLikePersonName(value: string): boolean {
  const clean = value.trim().replace(/[.,;:]+$/, "");
  if (!clean || /\d/.test(clean) || clean.length > 48) return false;
  const words = clean.split(/\s+/);
  if (words.length < 2 || words.length > 4) return false;
  let capitalised = 0;
  for (const word of words) {
    if (COMMON_WORDS.has(word.toLowerCase())) return false;
    if (PARTICLES.has(word.toLowerCase())) continue;
    if (!NAME_TOKEN.test(word)) return false;
    if (isOrgWord(word) || isRoleWord(word)) return false;
    capitalised += 1;
  }
  // Four capitalised words are almost always "Name Organisation"; real four-part names carry a particle or an initial.
  if (capitalised >= 4 && !words.some((word) => PARTICLES.has(word.toLowerCase()) || /^[A-Z]\.?$/.test(word))) return false;
  return capitalised >= 2;
}

/** A single given name or initials-only reference ("Dan", "TG", "Kim"). */
export function looksLikeNameFragment(value: string): boolean {
  const clean = value.trim().replace(/[.,;:]+$/, "");
  if (/^[A-Z]{2,3}$/.test(clean)) return true;
  return /^[A-Z][a-z'’\-]{1,20}$/.test(clean) && !isRoleWord(clean) && !isOrgWord(clean);
}

/** Splits a leading person name from trailing text ("Casey Lark Chamber of Commerce"). */
export function splitLeadingName(value: string): { name: string; rest: string } | undefined {
  const words = value.trim().split(/\s+/);
  // "Wren Albright Harbour Health Authority": when more words follow, most names are two words long.
  if (words.length > 3 && looksLikePersonName(words.slice(0, 2).join(" ")) && !/^(?:[A-Z]\.|de|van|von|la|le|st\.?)$/i.test(words[2])) {
    return { name: words.slice(0, 2).join(" "), rest: words.slice(2).join(" ") };
  }
  for (let length = Math.min(4, words.length); length >= 2; length--) {
    const candidate = words.slice(0, length).join(" ");
    const next = words[length];
    if (!looksLikePersonName(candidate)) continue;
    // Prefer the shortest name when the next word starts an organisation or role.
    if (length > 2) {
      const shorter = words.slice(0, 2).join(" ");
      const third = words[2];
      if (looksLikePersonName(shorter) && third && (isOrgWord(third) || isRoleWord(third) || /^[A-Z]{2,}$/.test(third))) {
        return { name: shorter, rest: words.slice(2).join(" ") };
      }
    }
    if (!next || !/^[a-z]/.test(next)) return { name: candidate, rest: words.slice(length).join(" ") };
  }
  return undefined;
}

export function normalizePersonKey(value: string): string {
  return value
    .normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(/\([^)]*\)/g, " ")
    .replace(/\b(?:dr|mr|mrs|ms|miss)\.?\s+/gi, "")
    .replace(/[^a-zA-Z\s'-]/g, " ")
    .toLowerCase().replace(/\s+/g, " ").trim();
}

/** Initials of a full name ("Taylor Brook" → "TB"). */
export function initialsOf(name: string): string {
  return normalizePersonKey(name).split(" ").filter((word) => word && !PARTICLES.has(word)).map((word) => word[0].toUpperCase()).join("");
}

/** Does a short reference ("T. Marsh", "Avery", "TB", "Marsh") plausibly name this person? */
export function referenceMatches(reference: string, fullName: string): boolean {
  const ref = normalizePersonKey(reference);
  const full = normalizePersonKey(fullName);
  if (!ref || !full) return false;
  if (ref === full) return true;
  const fullWords = full.split(" ");
  const refWords = ref.split(" ");
  const last = fullWords[fullWords.length - 1];
  if (/^[A-Z]{2,3}$/.test(reference.trim())) return initialsOf(fullName) === reference.trim();
  if (refWords.length === 1) return refWords[0] === fullWords[0] || refWords[0] === last;
  const refLast = refWords[refWords.length - 1];
  if (refLast !== last && !(last.startsWith(refLast) || refLast.startsWith(last))) return false;
  const refFirst = refWords[0];
  return refFirst === fullWords[0] || (refFirst.length === 1 && fullWords[0].startsWith(refFirst)) || fullWords[0].startsWith(refFirst) || refFirst.startsWith(fullWords[0]);
}

/** Edit-distance-tolerant equality for OCR/spelling variants ("Whitfield"/"Whitfeld"). */
export function similarNames(a: string, b: string): boolean {
  const x = normalizePersonKey(a), y = normalizePersonKey(b);
  if (x === y) return true;
  if (Math.abs(x.length - y.length) > 2) return false;
  return levenshtein(x, y) <= (Math.max(x.length, y.length) >= 12 ? 2 : 1);
}

export function levenshtein(a: string, b: string): number {
  const dp = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j];
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[b.length];
}
