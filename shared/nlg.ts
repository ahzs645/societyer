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
