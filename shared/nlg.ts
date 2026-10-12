/**
 * NLG GRAMMAR ENGINE (pure logic).
 *
 * Derives grammatical agreement tokens for a set of actors (people and/or
 * organizations) so legal-document language can read naturally regardless of
 * how many parties are involved or what their genders are.
 *
 * Mirrors the YCN Transaction!B6:B27 grammar helpers, hardened for edge cases
 * (zero actors, organization-named members, unknown genders).
 */

export interface Actor {
  name: string;
  gender?: "M" | "F" | "X";
  isOrganization?: boolean;
  /**
   * Stated pronouns that override the gender-derived default for a single
   * natural-person actor (e.g. they/them, xe/xir). Ignored for organizations
   * and for multi-actor groups (which always read "they/their").
   */
  customPronouns?: CustomPronouns;
}

/** A subjective pronoun + its possessive determiner, e.g. {he, his}. */
export interface CustomPronouns {
  subject: string;
  possessive: string;
}

/**
 * Canonicalise a free-form gender value to the engine's M | F | X domain, or
 * undefined when unknown. Accepts single letters and common words.
 */
export function normalizeGender(raw: string | null | undefined): "M" | "F" | "X" | undefined {
  const text = (raw ?? "").trim().toUpperCase();
  if (text === "M" || text.startsWith("MALE")) return "M";
  if (text === "F" || text.startsWith("FEMALE")) return "F";
  if (text === "X" || text === "O" || text.startsWith("NON")) return "X";
  return undefined;
}

const KNOWN_PRONOUNS: Record<string, CustomPronouns> = {
  "he/him": { subject: "he", possessive: "his" },
  "she/her": { subject: "she", possessive: "her" },
  "they/them": { subject: "they", possessive: "their" },
};

/**
 * Parse a stated-pronoun string into a {subject, possessive} pair.
 *   "she/her"      -> { she, her }
 *   "they/them"    -> { they, their }   (canonical possessive determiner)
 *   "xe/xir"       -> { xe, xir }
 *   "xe/xem/xyr"   -> { xe, xyr }       (3-part: subject / object / possessive)
 * Returns undefined for empty input.
 */
export function parsePronouns(raw?: string | null): CustomPronouns | undefined {
  if (!raw) {
    return undefined;
  }
  const key = raw.trim().toLowerCase();
  if (key === "") {
    return undefined;
  }
  if (KNOWN_PRONOUNS[key]) {
    return KNOWN_PRONOUNS[key];
  }
  const parts = key.split("/").map((p) => p.trim()).filter(Boolean);
  if (parts.length >= 3) {
    return { subject: parts[0], possessive: parts[2] };
  }
  if (parts.length === 2) {
    return { subject: parts[0], possessive: parts[1] };
  }
  if (parts.length === 1) {
    return { subject: parts[0], possessive: parts[0] };
  }
  return undefined;
}

export interface ActorGrammar {
  count: number;
  gender: "M" | "F" | "B" | "N";
  plural: string;
  possessive: string;
  pronoun: string;
  pronPoss: string;
  verbS: string;
  hasHave: string;
  allTheSole: string;
  isAre: string;
  wasWere: string;
}

const ORGANIZATION_PATTERN = buildOrganizationPattern();

function buildOrganizationPattern(): RegExp {
  // Multi-word / punctuation-bearing keywords handled explicitly so word
  // boundaries land where we want them. Single-token keywords share the
  // boundary-anchored alternation.
  const tokens = [
    "Inc",
    "Ltd",
    "LLC",
    "LLP",
    "Corp",
    "Corporation",
    "Co",
    "Company",
    "GmbH",
    "PLC",
    "SOCIETY",
    "ASSOCIATION",
    "FOUNDATION",
    "COOP",
    "COOPERATIVE",
    "TRUST",
    "FUND",
    "HOLDINGS",
    "PARTNERSHIP",
  ];
  // \b after a token would not fire correctly before a trailing "." (since
  // "." is a non-word char and "p." has a boundary between p and .). We anchor
  // each token so it is a whole word: preceded by a non-letter (or start) and
  // followed by a non-letter (or end). We allow optional trailing punctuation.
  const alternation = tokens.join("|");
  // Patterns with punctuation/spaces that need literal handling:
  //   L.P.        -> dotted
  //   & Co        -> ampersand company (already covered by Co token, but keep explicit)
  //   CO-OP       -> hyphenated
  const source =
    "(?:^|[^A-Za-z])" +
    "(?:" +
    alternation +
    "|L\\.P|CO-OP|CO\\.OP|& *Co" +
    ")" +
    "(?=$|[^A-Za-z])";
  return new RegExp(source, "i");
}

/**
 * Heuristic: does this name look like an organization rather than a natural
 * person? Case-insensitive, word-boundary anchored, tolerant of trailing
 * punctuation. Designed to avoid false positives on names that merely contain
 * an organization keyword as a substring (e.g. "Smithson", "Incognito").
 */
export function looksLikeOrganization(name: string): boolean {
  if (!name) {
    return false;
  }
  return ORGANIZATION_PATTERN.test(name);
}

function isNonGendered(actor: Actor): boolean {
  const org = actor.isOrganization ?? looksLikeOrganization(actor.name);
  return org || actor.gender === "X";
}

function resolveGender(actors: Actor[]): "M" | "F" | "B" | "N" {
  if (actors.length === 0) {
    return "N";
  }

  // Any organization / non-gendered / unknown-gender actor forces neutral
  // (combined) pronouns.
  const anyNonGendered = actors.some(isNonGendered);
  if (anyNonGendered) {
    return "B";
  }

  const allMale = actors.every((actor) => actor.gender === "M");
  if (allMale) {
    return "M";
  }

  const allFemale = actors.every((actor) => actor.gender === "F");
  if (allFemale) {
    return "F";
  }

  return "B";
}

export function actorGrammar(actors: Actor[]): ActorGrammar {
  const count = actors.length;
  const gender = resolveGender(actors);

  const isEmpty = count === 0;
  const isSingle = count === 1;
  // Strictly more-than-one is grammatically plural; a zero-actor set defaults
  // to the plural verb/auxiliary forms too (see spec).
  const isPluralWord = count > 1;
  const usePluralForms = count > 1 || isEmpty;

  const plural = isPluralWord ? "s" : "";
  const possessive = isSingle ? "'s" : "s'";

  let pronoun: string;
  let pronPoss: string;
  if (isPluralWord || isEmpty) {
    pronoun = "they";
    pronPoss = "their";
  } else {
    // Single actor.
    const actor = actors[0];
    const isOrg = actor.isOrganization ?? looksLikeOrganization(actor.name);
    const custom = actor.customPronouns;
    if (custom && custom.subject && custom.possessive && !isOrg) {
      // Stated pronouns win over the gender-derived default for a real person.
      pronoun = custom.subject;
      pronPoss = custom.possessive;
    } else if (isNonGendered(actor) || (actor.gender !== "M" && actor.gender !== "F")) {
      pronoun = "they";
      pronPoss = "their";
    } else if (actor.gender === "M") {
      pronoun = "he";
      pronPoss = "his";
    } else {
      pronoun = "she";
      pronPoss = "her";
    }
  }

  const verbS = usePluralForms ? "" : "s";
  const hasHave = usePluralForms ? "have" : "has";
  const allTheSole = usePluralForms ? "all the" : "the sole";
  const isAre = usePluralForms ? "are" : "is";
  const wasWere = usePluralForms ? "were" : "was";

  return {
    count,
    gender,
    plural,
    possessive,
    pronoun,
    pronPoss,
    verbS,
    hasHave,
    allTheSole,
    isAre,
    wasWere,
  };
}

// ---------------------------------------------------------------------------
// Sentence and quantity helpers (YCN PROPER(SHORT_NAME), Share_Single/Share_Desc).
// ---------------------------------------------------------------------------

/** Capitalize the first letter, e.g. "the Company records" -> "The Company records". */
export function capitalizeFirst(text: string | null | undefined): string {
  const value = String(text ?? "");
  const index = value.search(/\S/);
  if (index < 0) return value;
  return value.slice(0, index) + value.charAt(index).toUpperCase() + value.slice(index + 1);
}

const AN_EXCEPTIONS = /^(hour|honest|honou?r|heir)/i;
const A_EXCEPTIONS = /^(uni|use|usu|uti|eu|one\b|once|ubi|ura|ure|uri)/i;

/** "a" or "an" for the word that follows, by its opening sound (heuristic). */
export function indefiniteArticle(word: string | null | undefined): "a" | "an" {
  const value = String(word ?? "").trim();
  if (!value) return "a";
  // Acronyms read by letter name: "an MBA", "a CBCA corporation".
  if (/^[A-Z]{2,}\b/.test(value)) return /^[AEFHILMNORSX]/.test(value) ? "an" : "a";
  if (AN_EXCEPTIONS.test(value)) return "an";
  if (A_EXCEPTIONS.test(value)) return "a";
  return /^[aeiou]/i.test(value) ? "an" : "a";
}

/** "an application" / "a subscription". */
export function withIndefiniteArticle(phrase: string): string {
  return `${indefiniteArticle(phrase)} ${phrase}`;
}

/** Singular when exactly one, otherwise plural (zero reads plural: "no shares"). */
export function pluralize(count: number, singular: string, plural?: string): string {
  return count === 1 ? singular : plural ?? `${singular}s`;
}

/** "it" for one item, "them" otherwise. */
export function itThem(count: number): "it" | "them" {
  return count === 1 ? "it" : "them";
}

/** "A", "A and B", "A, B and C". */
export function joinNames(names: readonly string[], conjunction = "and"): string {
  const items = names.map((n) => String(n ?? "").trim()).filter(Boolean);
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} ${conjunction} ${items[items.length - 1]}`;
}

/** Share-class naming inputs (a rightsClasses row satisfies it). */
export interface ShareClassNaming {
  className?: string | null;
  /** COMMON contract: "Class A Voting Preferred Share". */
  singularDescription?: string | null;
  /** COMMON contract: "Class A Voting Preferred Shares". */
  pluralDescription?: string | null;
  /** Legacy YCN SHR_SINGLE display form ("Common Share"). */
  singularForm?: string | null;
}

/**
 * Quantity-aware class noun: "Class A Common Share" for one, "Class A Common
 * Shares" otherwise. Uses the stored singular/plural descriptions first and
 * falls back to the class name. Never produces "share(s)".
 */
export function shareClassNoun(count: number, cls: ShareClassNaming | null | undefined): string {
  const singularStored = String(cls?.singularDescription ?? cls?.singularForm ?? "").trim();
  const pluralStored = String(cls?.pluralDescription ?? "").trim();
  const name = String(cls?.className ?? "").trim();
  const base = name.replace(/\s+shares?$/i, "").trim();
  const shareWord = /\bshares?$/.test(name) ? "share" : "Share";
  const singular = singularStored || (base ? `${base} ${shareWord}` : "share");
  const plural = pluralStored
    || (singularStored ? (/s$/i.test(singularStored) ? singularStored : `${singularStored}s`) : base ? `${base} ${shareWord}s` : "shares");
  return count === 1 ? singular : plural;
}

/** "100 Class A Common Shares" / "1 Class A Common Share". */
export function shareQuantityLabel(count: number, cls: ShareClassNaming | null | undefined): string {
  const n = Number.isFinite(count) ? count : 0;
  return `${n.toLocaleString("en-CA")} ${shareClassNoun(n, cls)}`;
}
