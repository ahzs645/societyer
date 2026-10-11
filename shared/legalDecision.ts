/** Source-backed decision arithmetic. Legal electorates come from registers,
 * never from workspace access roles. Draft results require authority review. */
export type LegalDecisionInput = {
  jurisdiction: "CA-BC" | "CA-FED-CBCA" | "CA-ON-OBCA";
  entityType: "society" | "corporation__business_";
  body: "members" | "shareholders" | "directors";
  mode: "meeting" | "written" | "electronic_ballot";
  resolution: "ordinary" | "special" | "unanimous";
  votesFor: number;
  votesAgainst: number;
  eligibleVotes?: number;
  circulatedToAll?: boolean;
  quorumMet?: boolean;
  governingInstrumentEvidence?: string;
  specialMajority?: "two_thirds" | "three_quarters";
  preExistingCompany?: boolean;
  financialStatementsProvided?: boolean;
  annualBusinessComplete?: boolean;
  deemedAgm?: boolean;
};
export type LegalDecisionResult = {
  carries: boolean | null;
  denominator: "votes_cast" | "eligible_votes";
  denominatorCount?: number;
  thresholdNumerator: number;
  thresholdDenominator: number;
  strict: boolean;
  citation: string;
  classification: "statutory_baseline" | "review_required";
  warnings: string[];
};

export function evaluateLegalDecision(input: LegalDecisionInput): LegalDecisionResult {
  const bc = input.jurisdiction === "CA-BC";
  const society = input.entityType === "society";
  const written = input.mode === "written";
  const directors = input.body === "directors";
  const warnings: string[] = [];
  if (input.jurisdiction === "CA-ON-OBCA") warnings.push("Ontario governance automation remains gated pending review of the operative articles, bylaws and applicable statute.");
  let numerator = input.resolution === "special" ? 2 : 1;
  let divisor = input.resolution === "special" ? 3 : input.resolution === "ordinary" ? 2 : 1;
  let strict = input.resolution === "ordinary";
  let denominator: LegalDecisionResult["denominator"] = "votes_cast";
  const citation = society ? "BC Societies Act ss.1, 54, 67-71; applicable bylaws" : bc
    ? "BC Business Corporations Act ss.1, 167-175, 182; applicable articles"
    : input.jurisdiction === "CA-FED-CBCA" ? "CBCA ss.117, 139, 142; articles/by-laws" : "OBCA ss.129, 101, 104; articles/by-laws";
  if (society && (!bc || input.body === "shareholders")) warnings.push("This entity and decision body combination is unsupported.");
  if (!society && input.body === "members") warnings.push("Corporate voting requires shareholder or legal director authority.");
  if (!input.governingInstrumentEvidence) warnings.push("Record the operative articles/bylaws and applicable electorate evidence before relying on this result.");
  if (input.mode === "electronic_ballot") warnings.push("Non-meeting electronic ballots require reviewed enabling provisions and ballot mechanics.");
  if (bc && !society && (input.preExistingCompany || input.specialMajority === "three_quarters")) {
    if (input.resolution === "special" || (written && input.resolution === "ordinary")) { numerator = 3; divisor = 4; }
  }
  if (written) {
    denominator = "eligible_votes";
    strict = false;
    if (directors || input.resolution !== "ordinary" || (!bc && !society)) { numerator = 1; divisor = 1; }
    else if (!(bc && !society && (input.preExistingCompany || input.specialMajority === "three_quarters"))) { numerator = 2; divisor = 3; }
    if (!input.circulatedToAll) warnings.push("Written resolutions must be distributed to every person entitled to vote; distribution evidence is missing.");
    if (directors) warnings.push("Confirm director eligibility, conflicts and any society bylaw exception to the unanimous written baseline.");
  } else if (input.quorumMet !== true) warnings.push("A meeting result requires evidenced quorum.");
  if (input.resolution === "unanimous") warnings.push("Identify everyone whose consent is legally required, including non-voting holders where the matter requires their consent.");
  if (input.deemedAgm && (input.mode !== "written" || input.votesFor !== input.eligibleVotes || !input.financialStatementsProvided || !input.annualBusinessComplete)) {
    warnings.push("A deemed AGM requires unanimous eligible consent, complete annual business and the required financial statements.");
  }
  const count = denominator === "eligible_votes" ? input.eligibleVotes : input.votesFor + input.votesAgainst;
  const valid = [input.votesFor, input.votesAgainst, count].every(n => typeof n === "number" && Number.isSafeInteger(n) && n >= 0);
  if (!valid || !count || input.votesFor + input.votesAgainst > count) warnings.push("Supply consistent nonnegative integer vote totals and the required electorate denominator.");
  // Cross multiplication avoids floating point two-thirds boundary drift.
  const unsafe = valid && !!count && (!Number.isSafeInteger(input.votesFor * divisor) || !Number.isSafeInteger(count * numerator));
  if (unsafe) warnings.push("Vote totals exceed the supported exact-integer range.");
  const carries = warnings.length ? null : strict ? input.votesFor * divisor > count! * numerator : input.votesFor * divisor >= count! * numerator;
  return { carries, denominator, denominatorCount: count, thresholdNumerator: numerator, thresholdDenominator: divisor, strict, citation, classification: warnings.length ? "review_required" : "statutory_baseline", warnings };
}

export function legalMeetingQuorum(input: {
  entityType: LegalDecisionInput["entityType"];
  jurisdiction: LegalDecisionInput["jurisdiction"];
  eligiblePeople: number;
  presentPeople: number;
  eligibleVotes?: number;
  presentVotes?: number;
  eligibleVotingShares?: number;
  presentVotingShares?: number;
  adoptedModel?: "bc_society" | "bc_table_1";
  configuredMinimum?: number;
}): { met: boolean | null; minimumPeople: number; minimumVotes?: number; citation: string } {
  const { eligiblePeople, presentPeople } = input;
  if (![eligiblePeople, presentPeople].every(n => Number.isSafeInteger(n) && n >= 0) || presentPeople > eligiblePeople || eligiblePeople === 0) {
    return { met: null, minimumPeople: 0, citation: "Verify the legal electorate and attendance" };
  }
  if (input.configuredMinimum !== undefined && (!Number.isSafeInteger(input.configuredMinimum) || input.configuredMinimum < 1)) return { met: null, minimumPeople: 0, citation: "Review the configured quorum" };
  if (input.eligibleVotingShares !== undefined && input.presentVotingShares !== undefined &&
    (![input.eligibleVotingShares, input.presentVotingShares].every(n => Number.isSafeInteger(n) && n >= 0) || input.presentVotingShares > input.eligibleVotingShares)) return { met: null, minimumPeople: 0, citation: "Review issued voting share attendance totals" };
  if (input.entityType === "society") {
    const configured = input.configuredMinimum ?? (input.adoptedModel === "bc_society" ? Math.max(3, Math.ceil(eligiblePeople / 10)) : 3);
    const minimumPeople = Math.min(eligiblePeople, Math.max(3, configured));
    return { met: presentPeople >= minimumPeople, minimumPeople, citation: "Societies Act s.67; adopted Model Bylaw 3.7 where applicable" };
  }
  if (input.jurisdiction !== "CA-BC") {
    if (input.jurisdiction === "CA-ON-OBCA" || input.eligibleVotingShares === undefined || input.presentVotingShares === undefined || input.eligibleVotingShares <= 0) return { met: null, minimumPeople: 1, citation: "CBCA s.139 / OBCA s.101; applicable by-laws and issued voting shares required" };
    return { met: presentPeople > 0 && input.presentVotingShares * 2 > input.eligibleVotingShares, minimumPeople: 1, citation: "CBCA s.139; verify any by-law departure" };
  }
  const minimumPeople = Math.min(eligiblePeople, input.configuredMinimum ?? 2);
  if (input.adoptedModel === "bc_table_1" && eligiblePeople > 1) {
    if (input.eligibleVotingShares === undefined || input.presentVotingShares === undefined) return { met: null, minimumPeople, citation: "Adopted Table 1 article 8.2 requires the issued voting share denominator" };
    return { met: presentPeople >= minimumPeople && input.presentVotingShares * 20 >= input.eligibleVotingShares, minimumPeople, citation: "Adopted Table 1 article 8.2" };
  }
  return { met: presentPeople >= minimumPeople, minimumPeople, citation: "BC BCA s.172; applicable articles" };
}
