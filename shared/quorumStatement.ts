/**
 * Quorum as stated by source minutes ("Quorum achieved (13 directors
 * present)", "Quorum reached at 5:04", "Secretary reported that quorum of
 * members (12) was present", "No quorum"). The Drive staging script used to
 * force every meeting to `not_recorded`, discarding the explicit statements.
 * Only explicit statements are used; attendance counts alone never establish
 * quorum, and conditional wording ("assuming quorum is reached", "confirm
 * whether there is a quorum") is ignored.
 *
 * Pure module.
 */

export type QuorumStatement = {
  quorumStatus: "confirmed" | "not_met" | "not_recorded";
  quorumMet: boolean;
  /** Number of people the statement says were present, when given. */
  presentCount?: number;
  /** The sentence(s) the status was read from (≤ 240 chars each). */
  quote?: string;
  /** True when the minutes say quorum was gained after the meeting opened. */
  gainedLater?: boolean;
};

const NOT_MET = /\b(?:no quorum|quorum (?:was |is )?not (?:met|present|reached|achieved|established|attained)|lack(?:ed|ing)? (?:of )?(?:a )?quorum|without (?:a )?quorum|did not (?:have|reach|achieve) (?:a )?quorum|quorum (?:was |is )?(?:lost|absent))\b/gi;
const MET = /\b(?:quorum (?:of [a-z ]{2,30}?(?:\s*\(\d{1,3}\))?\s+)?(?:was |is |has been |being )?(?:met|present|reached|achieved|established|confirmed|declared|attained|obtained)|(?:achieved|reached|confirmed|declared|established) (?:a |the )?quorum|there (?:was|is) (?:a )?quorum)\b/gi;
const CONDITIONAL = /\b(?:assum\w*|if|unless|until|whether|to (?:meet|reach|achieve|have|ensure)|need\w*|necessary|required to|better (?:able|ability)|in order|able to)\b[^.]{0,30}$/i;

function sentenceAround(text: string, index: number) {
  const before = text.slice(0, index);
  const start = Math.max(before.lastIndexOf(". ") + 1, before.lastIndexOf("\n") + 1, before.lastIndexOf(" / ") + 1, before.lastIndexOf("|") + 1, 0);
  const rest = text.slice(index);
  const stops = [rest.search(/\.(?:\s|$)/), rest.indexOf("\n"), rest.indexOf(" / "), rest.indexOf("|")].filter((value) => value >= 0);
  const end = index + (stops.length ? Math.min(...stops) + 1 : rest.length);
  return text.slice(start, Math.min(end, start + 240)).replace(/\s+/g, " ").replace(/^[\s|/.]+|[\s|/]+$/g, "").trim();
}

function matches(pattern: RegExp, text: string) {
  const out: Array<{ index: number; text: string }> = [];
  pattern.lastIndex = 0;
  for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
    const lead = text.slice(Math.max(0, match.index - 40), match.index);
    if (!CONDITIONAL.test(lead)) out.push({ index: match.index, text: match[0] });
  }
  return out;
}

function presentCount(text: string): number | undefined {
  const patterns = [
    /quorum of [a-z ]+\((\d{1,3})\)/i,
    /\((\d{1,3})\s+[a-z ]*present\)/i,
    /\b(\d{1,3})\s+(?:directors|members|voting members|people|persons|attendees)\b/i,
    /total of (\d{1,3})\b/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return Number(match[1]);
  }
  return undefined;
}

/** Read an explicit quorum statement from minutes text. */
export function quorumStatementFromText(text: unknown): QuorumStatement {
  const value = String(text ?? "");
  const notMet = matches(NOT_MET, value);
  const met = matches(MET, value);
  if (!notMet.length && !met.length) return { quorumStatus: "not_recorded", quorumMet: false };
  const lastMet = met[met.length - 1];
  const firstNotMet = notMet[0];
  // "Opened at 5:07 without quorum … Quorum met at 5:32": quorum was gained.
  if (lastMet && (!firstNotMet || lastMet.index > firstNotMet.index)) {
    const quote = sentenceAround(value, lastMet.index);
    const notMetQuote = firstNotMet ? sentenceAround(value, firstNotMet.index) : undefined;
    return {
      quorumStatus: "confirmed",
      quorumMet: true,
      presentCount: presentCount(quote),
      quote: notMetQuote && notMetQuote !== quote ? `${notMetQuote} … ${quote}`.slice(0, 480) : quote,
      gainedLater: Boolean(firstNotMet) || undefined,
    };
  }
  const quote = sentenceAround(value, firstNotMet.index);
  return { quorumStatus: "not_met", quorumMet: false, presentCount: presentCount(quote), quote };
}
