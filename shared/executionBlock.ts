/**
 * EXECUTION / SIGNATURE BLOCK (pure logic).
 *
 * Turns a generated resolution from a checklist into a signable instrument by
 * rendering the YCN-style adoption clause + signature page that closes every
 * `Doc - *` sheet:
 *
 *   "The undersigned, being all the directors of [shortName], hereby adopt the
 *    foregoing resolutions pursuant to the provisions of the [Act]."
 *
 *   followed by one signature line per signatory, with corporate signatories
 *   rendered as a "By: ___" line over the corporation name.
 *
 * Framework-free; the grammar (sole vs all, adopt vs adopts, resolution vs
 * resolutions) is driven by the shared NLG engine so it agrees with the rest of
 * the document. The convex/static layers compute this and attach it to the
 * render context as `execution`; the DOCX renderer just prints the strings.
 */

import { actorGrammar, type Actor } from "./nlg";
import type { DocLocale } from "./locale";

export interface SignerLine {
  name: string;
  /** Optional printed capacity, e.g. "Director", "President". */
  capacity?: string;
  /**
   * When set, this signatory signs on behalf of an organization: the block
   * renders the organization name, a "By:" signature line, and the authorized
   * individual's name beneath. (YCN ENT_PEOPLE.CORP_SIGN.)
   */
  corpSign?: string | null;
}

export interface ExecutionBlockInput {
  shortName: string;
  legislation: string;
  /** Singular noun for the resolving body, e.g. "director", "voting shareholder". */
  noun: string;
  /** True when the instrument carries more than one operative resolution. */
  resolutionsPlural: boolean;
  signers: SignerLine[];
  /** Long-form date for the "Dated:" line (e.g. "June 25, 2026"). Optional. */
  dateLong?: string;
  /** Document locale (default "en"); "fr" renders the French adoption clause. */
  locale?: DocLocale;
}

export interface ExecutionBlockResult {
  adoptionClause: string;
  /** Date line (if any) followed by the signature stack, ready as paragraphs. */
  lines: string[];
}

/** The blank rule a signatory signs on. */
const SIGNATURE_RULE = "____________________________";

/** A resolving body resolved from a packet's requiredSigners tags. */
export interface ResolvingBody {
  /** roleHolders.roleType values that make up the body (for the signer fallback). */
  roleTypes: string[];
  /** Singular noun used in the adoption clause. */
  noun: string;
  /** Printed capacity for fallback (role-holder) signers. */
  capacity: string;
  /** The render-context group (shared/renderContext.ts) holding the body as at the document date. */
  group: "dir" | "shareholders" | "votingShareholders" | "members" | "officers";
}

/**
 * Map a packet's `requiredSigners` tags (e.g. "all_voting_shareholders",
 * "all_directors", "officer___president") to the body that adopts the
 * resolution. An "all_*" tag names the resolving body and wins over the
 * individual signers (an entering shareholder or officer signs a consent or
 * subscription, not the resolution). Otherwise the most specific match wins;
 * directors are the default.
 */
export function resolvingBodyFor(requiredSigners: readonly string[]): ResolvingBody {
  const lowered = requiredSigners.map((s) => s.toLowerCase());
  const bodyTag = lowered.find((t) => t.startsWith("all_"));
  const tags = bodyTag ? [bodyTag] : lowered;
  const has = (needle: string) => tags.some((t) => t.includes(needle));
  if (has("voting_shareholder") || has("voting shareholder")) {
    return { roleTypes: ["shareholder"], noun: "voting shareholder", capacity: "Voting Shareholder", group: "votingShareholders" };
  }
  if (has("shareholder")) {
    return { roleTypes: ["shareholder"], noun: "shareholder", capacity: "Shareholder", group: "shareholders" };
  }
  if (has("member")) {
    return { roleTypes: ["member"], noun: "member", capacity: "Member", group: "members" };
  }
  if (has("officer")) {
    return { roleTypes: ["officer"], noun: "officer", capacity: "Officer", group: "officers" };
  }
  return { roleTypes: ["director"], noun: "director", capacity: "Director", group: "dir" };
}

/**
 * Uppercase instrument title with the possessive chosen by count (YCN
 * `UPPER("Director" & IF(n>1,"s'","'s") & " Resolution")`):
 * "CONSENT DIRECTOR'S RESOLUTION" / "CONSENT DIRECTORS' RESOLUTION".
 */
export function instrumentTitle(noun: string, count: number, prefix = "CONSENT"): string {
  const possessive = count === 1 ? "'s" : "s'";
  return `${prefix} ${noun}${possessive} resolution`.trim().toUpperCase();
}

/**
 * Signature lines for a resolving body: the body's members as at the document
 * date, enriched from the entity signer roster (YCN ENT_PEOPLE) where a roster
 * row names the same person or, for a corporate holder, names that corporation
 * as `corpSign` (rendered as the corporation, "By:" and the signatory).
 */
export function bodySigners(
  members: ReadonlyArray<{ name: string; isOrganization?: boolean }>,
  body: Pick<ResolvingBody, "capacity">,
  roster: ReadonlyArray<{ name?: string; corpSign?: string | null; signOrder?: number }> = [],
): SignerLine[] {
  const norm = (value: unknown) => String(value ?? "").trim().toLowerCase();
  const lines = members.map((member, index) => {
    const corporate = roster.find((row) => row.corpSign && norm(row.corpSign) === norm(member.name));
    const personal = roster.find((row) => !row.corpSign && norm(row.name) === norm(member.name));
    const order = corporate?.signOrder ?? personal?.signOrder ?? Number.POSITIVE_INFINITY;
    const line: SignerLine = corporate
      ? { name: String(corporate.name ?? ""), corpSign: String(corporate.corpSign) }
      : { name: member.name, capacity: body.capacity };
    return { line, order, index };
  });
  return lines.sort((a, b) => a.order - b.order || a.index - b.index).map((entry) => entry.line);
}

/**
 * Build the adoption clause + signature lines. Plurality (sole vs all, adopt vs
 * adopts) is derived from the number of signers via the shared NLG engine, so a
 * one-director corporation reads "the sole director … adopts" while a board
 * reads "all the directors … adopt". Corporate signatories are non-gendered.
 */
/**
 * The signature stack: an optional "Dated:" line followed by one signature
 * block per signatory (a blank rule + printed name, or a corporate "By:" block).
 * Shared by the resolution execution block and the subscription-agreement annex.
 */
export function signatureLines(
  signers: readonly SignerLine[],
  dateLong?: string,
  locale: DocLocale = "en",
): string[] {
  const lines: string[] = [];
  if (dateLong) {
    lines.push(`${locale === "fr" ? "Daté le" : "Dated"}: ${dateLong}`);
  }
  for (const signer of signers) {
    lines.push(""); // spacer between signatories
    const capacitySuffix = signer.capacity ? `, ${signer.capacity}` : "";
    if (signer.corpSign) {
      lines.push(signer.corpSign);
      lines.push(`By: ${SIGNATURE_RULE}`);
      lines.push(`    ${signer.name}${capacitySuffix}`);
    } else {
      lines.push(SIGNATURE_RULE);
      lines.push(`${signer.name}${capacitySuffix}`);
    }
  }
  return lines;
}

/** English resolving-body noun → French {singular, plural}. */
const NOUN_FR: Record<string, { one: string; many: string }> = {
  director: { one: "administrateur", many: "administrateurs" },
  shareholder: { one: "actionnaire", many: "actionnaires" },
  "voting shareholder": { one: "actionnaire votant", many: "actionnaires votants" },
  member: { one: "membre", many: "membres" },
  officer: { one: "dirigeant", many: "dirigeants" },
};

function frenchAdoptionClause(input: ExecutionBlockInput, count: number): string {
  const sole = count === 1;
  const noun = NOUN_FR[input.noun] ?? { one: input.noun, many: `${input.noun}s` };
  const subject = sole
    ? `Le soussigné, étant le seul ${noun.one}`
    : `Les soussignés, étant tous les ${noun.many}`;
  const verb = sole ? "adopte" : "adoptent";
  const resolution = input.resolutionsPlural
    ? "les résolutions qui précèdent"
    : "la résolution qui précède";
  return `${subject} de ${input.shortName}, ${verb} par les présentes ${resolution} conformément aux dispositions de la ${input.legislation}.`;
}

export function buildExecutionBlock(input: ExecutionBlockInput): ExecutionBlockResult {
  const locale = input.locale ?? "en";
  const actors: Actor[] = input.signers.map((s) => ({
    name: s.name,
    isOrganization: Boolean(s.corpSign),
  }));
  const grammar = actorGrammar(actors);
  const adoptionClause =
    locale === "fr"
      ? frenchAdoptionClause(input, grammar.count)
      : `The undersigned, being ${grammar.allTheSole} ${input.noun}${grammar.plural} of ${input.shortName}, ` +
        `hereby adopt${grammar.verbS} the foregoing resolution${input.resolutionsPlural ? "s" : ""} ` +
        `pursuant to the provisions of the ${input.legislation}.`;

  return { adoptionClause, lines: signatureLines(input.signers, input.dateLong, locale) };
}
