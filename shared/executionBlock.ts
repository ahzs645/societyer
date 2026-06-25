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
}

/**
 * Map a packet's `requiredSigners` tags (e.g. "all_voting_shareholders",
 * "all_directors", "officer___president") to the body that adopts the
 * resolution. Most-specific match wins; directors are the default.
 */
export function resolvingBodyFor(requiredSigners: readonly string[]): ResolvingBody {
  const tags = requiredSigners.map((s) => s.toLowerCase());
  const has = (needle: string) => tags.some((t) => t.includes(needle));
  if (has("voting_shareholder") || has("voting shareholder")) {
    return { roleTypes: ["shareholder"], noun: "voting shareholder", capacity: "Voting Shareholder" };
  }
  if (has("shareholder")) {
    return { roleTypes: ["shareholder"], noun: "shareholder", capacity: "Shareholder" };
  }
  if (has("member")) {
    return { roleTypes: ["member"], noun: "member", capacity: "Member" };
  }
  if (has("officer")) {
    return { roleTypes: ["officer"], noun: "officer", capacity: "Officer" };
  }
  return { roleTypes: ["director"], noun: "director", capacity: "Director" };
}

/**
 * Build the adoption clause + signature lines. Plurality (sole vs all, adopt vs
 * adopts) is derived from the number of signers via the shared NLG engine, so a
 * one-director corporation reads "the sole director … adopts" while a board
 * reads "all the directors … adopt". Corporate signatories are non-gendered.
 */
export function buildExecutionBlock(input: ExecutionBlockInput): ExecutionBlockResult {
  const actors: Actor[] = input.signers.map((s) => ({
    name: s.name,
    isOrganization: Boolean(s.corpSign),
  }));
  const grammar = actorGrammar(actors);
  const nounPhrase = `${input.noun}${grammar.plural}`;
  const adoptionClause =
    `The undersigned, being ${grammar.allTheSole} ${nounPhrase} of ${input.shortName}, ` +
    `hereby adopt${grammar.verbS} the foregoing resolution${input.resolutionsPlural ? "s" : ""} ` +
    `pursuant to the provisions of the ${input.legislation}.`;

  const lines: string[] = [];
  if (input.dateLong) {
    lines.push(`Dated: ${input.dateLong}`);
  }
  for (const signer of input.signers) {
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
  return { adoptionClause, lines };
}
