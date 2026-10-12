/**
 * RENDER CONTEXT ASSEMBLER (pure logic).
 *
 * Composes the NLG grammar engine (shared/nlg.ts) and the organization domain
 * helpers (shared/organizationDomain.ts) into a single, typed template context
 * ready for rendering legal-document language. Framework-free.
 */

import { actorGrammar, capitalizeFirst, joinNames, type Actor, type ActorGrammar } from "./nlg";
import { formatLongDate, type DocLocale } from "./locale";
import {
  canonicalizeJurisdictionCode,
  homeJurisdictionCode,
  isFederalCbca,
  isOntarioObca,
  organizationKind,
  organizationLabel,
  type LegalEntityLike,
} from "./organizationDomain";
import { currentRegime, type ConstatingEvent } from "./constating";

export interface GroupContext extends ActorGrammar {
  isEmpty: boolean;
  isSole: boolean;
  isMultiple: boolean;
  /** Noun suffix: "" for exactly one, "s" otherwise (zero reads plural). */
  nounS: string;
  /** "A", "A and B", "A, B and C". */
  names: string;
  list: Actor[];
}

export interface RenderContext {
  org: {
    name: string;
    shortName: string;
    /** shortName capitalized for a sentence start ("The Company records …"). */
    ShortName: string;
    /** First mention: `Acme Holdings Ltd. (the "Company")`, or the name alone. */
    definedTermIntro: string;
    kind: string;
    jurisdiction: string;
    registrationNumber: string;
    purposes: string;
    /** Governing Act named with its jurisdiction, as at the document date. */
    legislation: string;
    /** True when the entity records a corporate seal (seal clauses are conditional). */
    hasSeal: boolean;
  };
  dir: GroupContext;
  members: GroupContext;
  officers: GroupContext;
  /** All registered shareholders as at the document date (roleType "shareholder"). */
  shareholders: GroupContext;
  /** Shareholders holding voting-class shares as at the document date. */
  votingShareholders: GroupContext;
  date: {
    iso: string;
    long: string;
  };
}

/**
 * Organizations may carry fields beyond the base LegalEntityLike shape (a short
 * name and an incorporation number). We accept them optionally without forcing
 * callers to widen their own types.
 */
export type RenderContextOrg = LegalEntityLike & {
  shortName?: string | null;
  incorporationNumber?: string | null;
  purposes?: string | null;
  sealLocation?: string | null;
};

export interface BuildRenderContextInput {
  org: RenderContextOrg;
  directors?: Actor[];
  members?: Actor[];
  officers?: Actor[];
  shareholders?: Actor[];
  /** Omitted → the voting group falls back to all shareholders. */
  votingShareholders?: Actor[];
  asOf: string /* ISO */;
  registrationNumber?: string;
  /** Document locale for date/prose rendering (default "en"). */
  locale?: DocLocale;
  /** Constating timeline (YCN CONSTATING) used to name the Act in force at `asOf`. */
  constating?: readonly ConstatingEvent[];
}

export function buildGroup(list: Actor[]): GroupContext {
  const grammar = actorGrammar(list);
  const count = grammar.count;
  return {
    ...grammar,
    list,
    isEmpty: count === 0,
    isSole: count === 1,
    isMultiple: count > 1,
    nounS: count === 1 ? "" : "s",
    names: joinNames(list.map((actor) => actor.name)),
  };
}

/** The BC Business Corporations Act replaced the Company Act on March 29, 2004. */
export const BC_BCA_IN_FORCE = "2004-03-29";

const JURISDICTION_NAMES: Record<string, string> = {
  "CA-BC": "British Columbia",
  "CA-ON-OBCA": "Ontario",
  "CA-ON": "Ontario",
  "CA-AB": "Alberta",
};

function withJurisdiction(act: string, jurisdiction: string | undefined): string {
  if (!jurisdiction || /\(.*\)\s*$/.test(act) || /^canada\b/i.test(act)) return act;
  return `${act} (${jurisdiction})`;
}

/**
 * The governing Act named with its jurisdiction, as at `asOfISO` (YCN
 * `{Act}` lookup): "Business Corporations Act (British Columbia)",
 * "Business Corporations Act (Ontario)", "Canada Business Corporations Act",
 * and "Company Act (British Columbia)" for BC records dated before the BCA
 * came into force. A recorded constating timeline wins over the inference.
 * Societies keep "Societies Act"; an unknown jurisdiction keeps the bare name.
 */
export function resolveLegislation(org: RenderContextOrg, asOfISO = "", constating?: readonly ConstatingEvent[]): string {
  const kind = organizationKind(org);
  if (kind === "society") return "Societies Act";
  if (kind !== "corporation") return "applicable legislation";
  const day = String(asOfISO ?? "").slice(0, 10);
  const canonical = canonicalizeJurisdictionCode(homeJurisdictionCode(org));
  const regime = constating?.length && day ? currentRegime([...constating], day) : null;
  if (regime?.legislation?.trim()) {
    const regimeJurisdiction = canonicalizeJurisdictionCode(regime.jurisdiction);
    const act = regime.legislation.trim().replace(/\s*\((?:BC|B\.C\.|ON|Ont\.?)\)\s*$/i, "");
    if (/canada business corporations/i.test(act)) return "Canada Business Corporations Act";
    return withJurisdiction(act, JURISDICTION_NAMES[regimeJurisdiction] ?? (regime.jurisdiction.length > 3 ? regime.jurisdiction : undefined));
  }
  if (isFederalCbca(org)) return "Canada Business Corporations Act";
  if (isOntarioObca(org)) return "Business Corporations Act (Ontario)";
  const act = String(org.actFormedUnder ?? "").toLowerCase();
  if (act.includes("canada_business")) return "Canada Business Corporations Act";
  if (canonical === "CA-BC") {
    return day && day < BC_BCA_IN_FORCE ? "Company Act (British Columbia)" : "Business Corporations Act (British Columbia)";
  }
  return "Business Corporations Act";
}

function hasSeal(sealLocation: string | null | undefined): boolean {
  const value = String(sealLocation ?? "").trim();
  return Boolean(value) && !/^(none|no seal|no|n\/?a|not applicable|-)$/i.test(value);
}

/** `Acme Holdings Ltd. (the "Company")`; omitted when the short name is the name. */
export function definedTermIntro(name: string, shortName: string): string {
  if (!shortName || shortName === name) return name;
  const term = shortName.replace(/^the\s+/i, "");
  const article = /^the\s+/i.test(shortName) ? "the " : "";
  return `${name} (${article}"${term}")`;
}

export function buildRenderContext(input: BuildRenderContextInput): RenderContext {
  const { org } = input;
  const kind = organizationKind(org);
  const name = organizationLabel(org);
  const shortName =
    typeof org.shortName === "string" && org.shortName.trim() ? org.shortName : name;
  const shareholders = input.shareholders ?? [];

  return {
    org: {
      name,
      shortName,
      ShortName: capitalizeFirst(shortName),
      definedTermIntro: definedTermIntro(name, shortName),
      kind,
      jurisdiction: org.jurisdictionCode ?? "",
      registrationNumber: input.registrationNumber ?? org.incorporationNumber ?? "",
      purposes: org.purposes?.trim() || "[Insert the society’s reviewed lawful purposes.]",
      legislation: resolveLegislation(org, input.asOf, input.constating),
      hasSeal: hasSeal(org.sealLocation),
    },
    dir: buildGroup(input.directors ?? []),
    members: buildGroup(input.members ?? []),
    officers: buildGroup(input.officers ?? []),
    shareholders: buildGroup(shareholders),
    votingShareholders: buildGroup(input.votingShareholders ?? shareholders),
    date: {
      iso: input.asOf,
      long: formatLongDate(input.asOf, input.locale ?? "en"),
    },
  };
}
