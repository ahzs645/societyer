/**
 * RENDER CONTEXT ASSEMBLER (pure logic).
 *
 * Composes the NLG grammar engine (shared/nlg.ts) and the organization domain
 * helpers (shared/organizationDomain.ts) into a single, typed template context
 * ready for rendering legal-document language. Framework-free.
 */

import { actorGrammar, type Actor, type ActorGrammar } from "./nlg";
import { formatLongDate, type DocLocale } from "./locale";
import {
  organizationKind,
  organizationLabel,
  type LegalEntityLike,
} from "./organizationDomain";

export interface GroupContext extends ActorGrammar {
  isEmpty: boolean;
  isSole: boolean;
  isMultiple: boolean;
  list: Actor[];
}

export interface RenderContext {
  org: {
    name: string;
    shortName: string;
    kind: string;
    jurisdiction: string;
    registrationNumber: string;
    legislation: string;
  };
  dir: GroupContext;
  members: GroupContext;
  officers: GroupContext;
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
};

export interface BuildRenderContextInput {
  org: RenderContextOrg;
  directors?: Actor[];
  members?: Actor[];
  officers?: Actor[];
  asOf: string /* ISO */;
  registrationNumber?: string;
  /** Document locale for date/prose rendering (default "en"). */
  locale?: DocLocale;
}

function buildGroup(list: Actor[]): GroupContext {
  const grammar = actorGrammar(list);
  const count = grammar.count;
  return {
    ...grammar,
    list,
    isEmpty: count === 0,
    isSole: count === 1,
    isMultiple: count > 1,
  };
}

/**
 * Map an organization kind to its governing legislation. Federal corporations
 * formed under the CBCA get the qualified name.
 */
function resolveLegislation(kind: string, actFormedUnder?: string | null): string {
  const act = typeof actFormedUnder === "string" ? actFormedUnder.toLowerCase() : "";
  switch (kind) {
    case "society":
      return "Societies Act";
    case "corporation":
      return act.includes("canada_business")
        ? "Canada Business Corporations Act"
        : "Business Corporations Act";
    default:
      return "applicable legislation";
  }
}

export function buildRenderContext(input: BuildRenderContextInput): RenderContext {
  const { org } = input;
  const kind = organizationKind(org);
  const name = organizationLabel(org);
  const shortName =
    typeof org.shortName === "string" && org.shortName.trim() ? org.shortName : name;

  return {
    org: {
      name,
      shortName,
      kind,
      jurisdiction: org.jurisdictionCode ?? "",
      registrationNumber: input.registrationNumber ?? org.incorporationNumber ?? "",
      legislation: resolveLegislation(kind, org.actFormedUnder),
    },
    dir: buildGroup(input.directors ?? []),
    members: buildGroup(input.members ?? []),
    officers: buildGroup(input.officers ?? []),
    date: {
      iso: input.asOf,
      long: formatLongDate(input.asOf, input.locale ?? "en"),
    },
  };
}
