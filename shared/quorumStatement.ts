/**
 * Quorum as stated by source minutes ("Quorum achieved (13 directors
 * present)", "Quorum was reached at 5:04", "No quorum"). The Drive staging
 * script used to force every meeting to `not_recorded`, discarding 40 explicit
 * "quorum achieved" statements in the PGAIR corpus. Only explicit statements
 * are used; attendance counts alone never establish quorum.
 *
 * Pure module.
 */

export type QuorumStatement = {
  quorumStatus: "confirmed" | "not_met" | "not_recorded";
  quorumMet: boolean;
  /** Number of people the statement says were present, when given. */
  presentCount?: number;
  /** The sentence the status was read from (≤ 240 chars). */
  quote?: string;
};

const NOT_MET = /\b(?:no quorum|quorum (?:was |is )?not (?:met|present|reached|achieved|established)|lack(?:ed|ing)? (?:of )?(?:a )?quorum|without (?:a )?quorum|did not (?:have|reach|achieve) (?:a )?quorum|quorum (?:was |is )?(?:lost|absent))\b/i;
const MET = /\b(?:quorum (?:was |is |has been )?(?:met|present|reached|achieved|established|confirmed|declared|attained|obtained)|(?:achieved|reached|confirmed|declared|established|have|had|has) (?:a )?quorum|quorum (?:being )?present|there (?:was|is) (?:a )?quorum)\b/i;

function sentenceAround(text: string, index: number) {
  const start = Math.max(0, text.lastIndexOf(".", index) + 1, text.lastIndexOf("\n", index) + 1);
  const endCandidates = [text.indexOf(".", index), text.indexOf("\n", index)].filter((value) => value >= 0);
  const end = endCandidates.length ? Math.min(...endCandidates) + 1 : text.length;
  return text.slice(start, Math.min(end, start + 240)).replace(/\s+/g, " ").trim();
}

/** Read an explicit quorum statement from minutes text. */
export function quorumStatementFromText(text: unknown): QuorumStatement {
  const value = String(text ?? "");
  const notMet = NOT_MET.exec(value);
  if (notMet) return { quorumStatus: "not_met", quorumMet: false, quote: sentenceAround(value, notMet.index) };
  const met = MET.exec(value);
  if (!met) return { quorumStatus: "not_recorded", quorumMet: false };
  const quote = sentenceAround(value, met.index);
  const count = quote.match(/\b(\d{1,3})\s+(?:directors|members|voting members|people|persons|attendees|of\s+\d+)\b/i)
    ?? value.slice(met.index, met.index + 120).match(/\((\d{1,3})\s+[a-z ]*present\)/i);
  return { quorumStatus: "confirmed", quorumMet: true, presentCount: count ? Number(count[1]) : undefined, quote };
}
