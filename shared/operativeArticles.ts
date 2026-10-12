/**
 * The operative articles of a BC company: which articles the company adopted
 * (the prescribed Table 1, or custom articles), the custom Parts that add class
 * rights, and the article provisions that override statutory defaults.
 *
 * The record lives on the organization (`societies.operativeArticles`). It is
 * a description of the articles, never a legal conclusion: the signed articles
 * remain authoritative and `sourceDocumentId` points at them.
 *
 * Table 1 is never inferred from silence. A company "has Table 1" here only
 * when someone recorded `base: "bc_table_1"` and the Table 1 version adopted.
 * BCA s. 261(2): a regulation amending Table 1 also alters the articles of a
 * company that has Table 1 by operation of the Act or adopts a Table 1
 * provision by reference, unless the articles provide otherwise or the
 * provision was altered under s. 259. Reproduced text does not follow later
 * amendments automatically.
 *
 * Only BC companies use this record. Societies, CBCA and OBCA corporations are
 * never read from it (except the explicit transfer-consent flag, which is a
 * plain fact about the governing documents).
 *
 * Pure module so hosted Convex, the local runtime and the UI agree.
 */

import { legalGovernanceProfile } from "./legalGovernanceProfiles";
import { legalMeetingQuorum } from "./legalDecision";

export const OPERATIVE_ARTICLES_BASES = ["bc_table_1", "custom"] as const;
export type OperativeArticlesBase = (typeof OPERATIVE_ARTICLES_BASES)[number];

/**
 * Table 1 (B.C. Reg. 65/2004, Sch. Table 1) and its amending regulations, as
 * listed in the current consolidation. The adopted text is the version in
 * force when the company adopted it.
 */
export const TABLE1_VERSIONS = [
  { value: "original_2004", label: "Original Table 1 (B.C. Reg. 65/2004)" },
  { value: "am_315_2004", label: "Table 1 as amended by B.C. Reg. 315/2004" },
  { value: "am_186_2007", label: "Table 1 as amended by B.C. Regs. 315/2004 and 186/2007" },
  { value: "am_64_2021", label: "Table 1 as amended through B.C. Reg. 64/2021" },
  { value: "am_114_2022", label: "Table 1 as amended through B.C. Reg. 114/2022" },
  { value: "am_50_2023", label: "Table 1 as amended through B.C. Reg. 50/2023 (current consolidation)" },
] as const;
export type Table1Version = (typeof TABLE1_VERSIONS)[number]["value"];
export const CURRENT_TABLE1_VERSION: Table1Version = "am_50_2023";

export const TABLE1_INCORPORATION = [
  { value: "by_reference", label: "Adopted by reference (articles state that Table 1 applies)" },
  { value: "reproduced_text", label: "Text of Table 1 reproduced in the articles" },
  { value: "operation_of_act", label: "Table 1 applies by operation of the Act (BCA s. 16(b))" },
] as const;
export type Table1Incorporation = (typeof TABLE1_INCORPORATION)[number]["value"];

export type IndemnityType = "mandatory" | "permissive";

export type OperativeArticles = {
  base: OperativeArticlesBase;
  /** Required when base is bc_table_1. */
  table1Version?: Table1Version;
  table1Incorporation?: Table1Incorporation;
  /** Date the articles (or this version) took effect, YYYY-MM-DD. */
  adoptedOn?: string;
  /** Custom Parts, e.g. { part: "Parts 21-23", title: "Class A/B/C special rights and restrictions" }. */
  customParts?: Array<{ part: string; title: string }>;
  /** Article overrides. Absent = Table 1 (when adopted) or the statutory default. */
  noticeMinDays?: number;
  specialMajority?: "two_thirds" | "three_quarters";
  shareholderQuorum?: { people: number; minVotingSharesNumerator?: number; minVotingSharesDenominator?: number };
  boardQuorum?: { quorumType: "majority" | "fixed"; quorumValue?: number };
  chairCastingVote?: boolean;
  transferConsentRequired?: boolean;
  /** True when the articles restrict electronic participation (BCA ss. 140(1)(b), 174(1)). */
  electronicParticipationRestricted?: boolean;
  directorIndemnity?: IndemnityType;
  officerIndemnity?: IndemnityType;
  sourceDocumentId?: string;
  notes?: string;
  recordedAtISO?: string;
};

type Basis = "articles" | "table_1" | "statute";
export type ResolvedArticleRule<T> = { value: T; basis: Basis; citation: string };

export type ResolvedOperativeArticles = {
  model: OperativeArticlesBase;
  label: string;
  adoptedOn?: string;
  sourceDocumentId?: string;
  customParts: Array<{ part: string; title: string }>;
  noticeMinDays: ResolvedArticleRule<number>;
  specialMajority: ResolvedArticleRule<"two_thirds" | "three_quarters">;
  shareholderQuorum: ResolvedArticleRule<{ people: number; numerator?: number; denominator?: number }>;
  boardQuorum?: ResolvedArticleRule<{ quorumType: "majority" | "fixed"; quorumValue?: number }>;
  chairCastingVote?: ResolvedArticleRule<boolean>;
  transferConsentRequired: ResolvedArticleRule<boolean>;
  electronicParticipationRestricted: ResolvedArticleRule<boolean>;
  directorIndemnity?: ResolvedArticleRule<IndemnityType>;
  officerIndemnity?: ResolvedArticleRule<IndemnityType>;
  sourceIds: string[];
  warnings: string[];
};

const TABLE1 = "Table 1 (Business Corporations Regulation, B.C. Reg. 65/2004)";

/** Only an ordinary BC company profile reads the articles record. */
export function articlesApplyTo(organization: any): boolean {
  return legalGovernanceProfile(organization)?.id === "bc_company";
}

export function operativeArticlesOf(organization: any): OperativeArticles | undefined {
  const record = organization?.operativeArticles;
  return record && typeof record === "object" && OPERATIVE_ARTICLES_BASES.includes(record.base) ? record as OperativeArticles : undefined;
}

export function table1VersionLabel(version?: string): string {
  return TABLE1_VERSIONS.find((item) => item.value === version)?.label ?? "Table 1 (version not recorded)";
}

function positiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

/**
 * Whether director consent is needed before a share transfer is registered.
 * An explicit record wins. Otherwise a non-public BC company that recorded
 * Table 1 has Art. 20.2 (consent required, no reasons needed); Art. 20.1 lifts
 * it for a public company. Nothing is inferred when no articles are recorded.
 */
export function transferConsentRequired(org: any): boolean {
  const articles = operativeArticlesOf(org);
  if (typeof articles?.transferConsentRequired === "boolean") return articles.transferConsentRequired;
  return articles?.base === "bc_table_1" && articlesApplyTo(org) && org?.distributing !== true;
}

/** Problems with an articles record as entered (empty when valid). */
export function operativeArticlesProblems(input: unknown, organization: any): string[] {
  const problems: string[] = [];
  if (!articlesApplyTo(organization)) return ["Operative articles can be recorded only for a BC company under the Business Corporations Act."];
  const record = input as OperativeArticles | null | undefined;
  if (!record || typeof record !== "object") return ["Record which articles the company adopted."];
  if (!OPERATIVE_ARTICLES_BASES.includes(record.base)) problems.push("Choose Table 1 or custom articles.");
  if (record.base === "bc_table_1") {
    if (!TABLE1_VERSIONS.some((item) => item.value === record.table1Version)) problems.push("Record the Table 1 version the company adopted; Table 1 is never assumed.");
    if (record.table1Incorporation !== undefined && !TABLE1_INCORPORATION.some((item) => item.value === record.table1Incorporation)) problems.push("Choose how Table 1 forms part of the articles.");
  } else if (record.table1Version !== undefined || record.table1Incorporation !== undefined) {
    problems.push("A Table 1 version applies only when the base is Table 1.");
  }
  if (record.adoptedOn !== undefined) {
    const raw = String(record.adoptedOn);
    const time = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? Date.parse(`${raw}T00:00:00Z`) : NaN;
    if (!Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== raw) problems.push("Enter the adoption date as a valid date.");
    else if (time > Date.now() + 2 * 86_400_000) problems.push("The adoption date cannot be in the future.");
  }
  if (record.customParts !== undefined) {
    if (!Array.isArray(record.customParts)) problems.push("Custom Parts must be a list.");
    else {
      if (record.customParts.length > 50) problems.push("Record at most 50 custom Parts.");
      record.customParts.forEach((part, index) => {
        if (!part || typeof part.part !== "string" || !part.part.trim() || part.part.length > 60) problems.push(`Custom Part ${index + 1}: enter the Part number (for example "Part 21").`);
        if (!part || typeof part.title !== "string" || !part.title.trim() || part.title.length > 200) problems.push(`Custom Part ${index + 1}: enter what the Part covers.`);
      });
    }
  }
  if (record.noticeMinDays !== undefined) {
    const floor = organization?.distributing === true ? 21 : 10;
    if (!positiveInteger(record.noticeMinDays) || record.noticeMinDays < floor || record.noticeMinDays > 60) {
      problems.push(`The articles' notice period must be a whole number of days from ${floor} (Regulation s. 3) up to 60.`);
    }
  }
  if (record.specialMajority !== undefined && !["two_thirds", "three_quarters"].includes(record.specialMajority)) problems.push("The special majority must be two-thirds or three-quarters (BCA s. 1(1)).");
  if (record.shareholderQuorum !== undefined) {
    const quorum = record.shareholderQuorum;
    if (!quorum || !positiveInteger(quorum.people) || quorum.people > 100) problems.push("Shareholder quorum: enter the number of persons (1 to 100).");
    const numerator = quorum?.minVotingSharesNumerator, denominator = quorum?.minVotingSharesDenominator;
    if ((numerator === undefined) !== (denominator === undefined)) problems.push("Shareholder quorum: enter both parts of the voting-share fraction, or neither.");
    else if (numerator !== undefined && (!positiveInteger(numerator) || !positiveInteger(denominator) || numerator > denominator!)) problems.push("Shareholder quorum: the voting-share fraction must be between 0 and 1, for example 1/20.");
  }
  if (record.boardQuorum !== undefined) {
    const board = record.boardQuorum;
    if (!board || !["majority", "fixed"].includes(board.quorumType)) problems.push("Board quorum: choose a majority or a fixed number.");
    else if (board.quorumType === "fixed" && !(positiveInteger(board.quorumValue) && board.quorumValue <= 100)) problems.push("Board quorum: enter how many directors form a quorum.");
    else if (board.quorumType === "majority" && board.quorumValue !== undefined) problems.push("Board quorum: a majority rule has no fixed number.");
  }
  for (const field of ["chairCastingVote", "transferConsentRequired", "electronicParticipationRestricted"] as const) {
    if (record[field] !== undefined && typeof record[field] !== "boolean") problems.push(`${field} must be yes or no.`);
  }
  for (const field of ["directorIndemnity", "officerIndemnity"] as const) {
    if (record[field] !== undefined && !["mandatory", "permissive"].includes(record[field] as string)) problems.push("Indemnity must be mandatory or permissive.");
  }
  if (record.notes !== undefined && (typeof record.notes !== "string" || record.notes.length > 2000)) problems.push("Notes must be text of at most 2,000 characters.");
  return problems;
}

/** Keep only meaningful fields so the stored record stays small and exact. */
export function cleanOperativeArticles(record: OperativeArticles): OperativeArticles {
  const out: OperativeArticles = { base: record.base };
  if (record.base === "bc_table_1") {
    out.table1Version = record.table1Version;
    if (record.table1Incorporation) out.table1Incorporation = record.table1Incorporation;
  }
  if (record.adoptedOn) out.adoptedOn = record.adoptedOn;
  const parts = (record.customParts ?? []).map((part) => ({ part: part.part.trim(), title: part.title.trim() })).filter((part) => part.part && part.title);
  if (parts.length) out.customParts = parts;
  if (record.noticeMinDays !== undefined) out.noticeMinDays = record.noticeMinDays;
  if (record.specialMajority) out.specialMajority = record.specialMajority;
  if (record.shareholderQuorum) {
    out.shareholderQuorum = { people: record.shareholderQuorum.people };
    if (record.shareholderQuorum.minVotingSharesNumerator !== undefined) {
      out.shareholderQuorum.minVotingSharesNumerator = record.shareholderQuorum.minVotingSharesNumerator;
      out.shareholderQuorum.minVotingSharesDenominator = record.shareholderQuorum.minVotingSharesDenominator;
    }
  }
  if (record.boardQuorum) out.boardQuorum = record.boardQuorum.quorumType === "fixed"
    ? { quorumType: "fixed", quorumValue: record.boardQuorum.quorumValue }
    : { quorumType: "majority" };
  for (const field of ["chairCastingVote", "transferConsentRequired", "electronicParticipationRestricted"] as const) {
    if (typeof record[field] === "boolean") out[field] = record[field];
  }
  if (record.directorIndemnity) out.directorIndemnity = record.directorIndemnity;
  if (record.officerIndemnity) out.officerIndemnity = record.officerIndemnity;
  if (record.sourceDocumentId) out.sourceDocumentId = record.sourceDocumentId;
  if (record.notes?.trim()) out.notes = record.notes.trim();
  return out;
}

/**
 * Resolve each governance rule to its source: an article override, an
 * adopted Table 1 article, or the BCA default. Null when the organization is
 * not a BC company or no articles are recorded.
 */
export function resolveOperativeArticles(organization: any): ResolvedOperativeArticles | null {
  if (!articlesApplyTo(organization)) return null;
  const articles = operativeArticlesOf(organization);
  if (!articles) return null;
  const table1 = articles.base === "bc_table_1" && TABLE1_VERSIONS.some((item) => item.value === articles.table1Version);
  const publicCompany = organization?.distributing === true;
  const warnings: string[] = [];
  const sourceIds = ["BC-BCA-TABLE1-ARTICLES"];
  if (articles.base === "bc_table_1" && !table1) warnings.push("The Table 1 version is not recorded; Table 1 rules are not applied.");
  if (table1 && articles.table1Version !== CURRENT_TABLE1_VERSION && articles.table1Incorporation !== "reproduced_text") {
    warnings.push("BCA s. 261(2): later Table 1 amendments can alter articles that have Table 1 by operation of the Act or adopt it by reference, unless the articles provide otherwise. Confirm which Table 1 text governs.");
  }
  if (!articles.sourceDocumentId) warnings.push("Link the signed articles so the recorded provisions can be checked against them.");

  const fromArticles = <T,>(value: T): ResolvedArticleRule<T> => ({ value, basis: "articles", citation: "Recorded articles provision" });
  const fromTable1 = <T,>(value: T, articleNumbers: string): ResolvedArticleRule<T> => ({ value, basis: "table_1", citation: `${TABLE1}, Art. ${articleNumbers}` });
  const fromStatute = <T,>(value: T, citation: string): ResolvedArticleRule<T> => ({ value, basis: "statute", citation });

  const noticeMinDays = articles.noticeMinDays !== undefined
    ? fromArticles(publicCompany ? Math.max(21, articles.noticeMinDays) : articles.noticeMinDays)
    : fromStatute(21, "BCA s. 169; Business Corporations Regulation s. 3");
  const specialMajority = articles.specialMajority
    ? fromArticles(articles.specialMajority)
    : fromStatute("two_thirds" as const, "BCA s. 1(1) \"special majority\"");
  const shareholderQuorum = articles.shareholderQuorum
    ? fromArticles({
      people: articles.shareholderQuorum.people,
      ...(articles.shareholderQuorum.minVotingSharesNumerator !== undefined ? {
        numerator: articles.shareholderQuorum.minVotingSharesNumerator,
        denominator: articles.shareholderQuorum.minVotingSharesDenominator,
      } : {}),
    })
    : table1 ? fromTable1({ people: 2, numerator: 1, denominator: 20 }, "8.2–8.3")
      : fromStatute({ people: 2 }, "BCA s. 172(1)(b)–(c), (3)");
  const boardQuorum = articles.boardQuorum
    ? fromArticles(articles.boardQuorum)
    : table1 ? fromTable1({ quorumType: "majority" as const }, "11.10–11.11") : undefined;
  if (!boardQuorum) warnings.push("Board quorum comes from the articles or a directors' determination; record it to calculate board quorum.");
  const chairCastingVote = typeof articles.chairCastingVote === "boolean"
    ? fromArticles(articles.chairCastingVote)
    : table1 ? fromTable1(false, "8.19, 11.3 and 12.4(d)") : undefined;
  const transferConsent = typeof articles.transferConsentRequired === "boolean"
    ? fromArticles(articles.transferConsentRequired)
    : table1 ? fromTable1(!publicCompany, "20.1–20.2") : fromStatute(false, "No transfer restriction recorded in the articles");
  const electronicParticipationRestricted = typeof articles.electronicParticipationRestricted === "boolean"
    ? fromArticles(articles.electronicParticipationRestricted)
    : fromStatute(false, "BCA ss. 140(1)(b), 174(1): electronic participation unless the articles provide otherwise");
  sourceIds.push("BC-BCA-ELECTRONIC-MEETINGS");
  const directorIndemnity = articles.directorIndemnity
    ? fromArticles(articles.directorIndemnity)
    : table1 ? fromTable1("mandatory" as const, "15.1–15.2") : undefined;
  const officerIndemnity = articles.officerIndemnity ? fromArticles(articles.officerIndemnity) : undefined;
  if (directorIndemnity || officerIndemnity) sourceIds.push("BC-BCA-INDEMNITY");

  const parts = articles.customParts ?? [];
  const label = table1
    ? `${table1VersionLabel(articles.table1Version)}${parts.length ? `, supplemented by ${parts.map((part) => part.part).join(", ")}` : ""}`
    : articles.base === "bc_table_1" ? "Table 1 (version not recorded)" : "Custom articles";
  return {
    model: table1 ? "bc_table_1" : "custom",
    label,
    adoptedOn: articles.adoptedOn,
    sourceDocumentId: articles.sourceDocumentId,
    customParts: parts,
    noticeMinDays,
    specialMajority,
    shareholderQuorum,
    boardQuorum,
    chairCastingVote,
    transferConsentRequired: transferConsent,
    electronicParticipationRestricted,
    directorIndemnity,
    officerIndemnity,
    sourceIds,
    warnings,
  };
}

/** "the Table 1 Articles ... supplemented by Parts 21-23 ..." for the incorporation agreement. */
export function articlesAdoptionSentence(organization: any): string | undefined {
  const resolved = resolveOperativeArticles(organization);
  if (!resolved) return undefined;
  const parts = resolved.customParts.map((part) => `${part.part} (${part.title})`);
  if (resolved.model === "bc_table_1") {
    return `the Table 1 Articles prescribed under the Business Corporations Regulation (${table1VersionLabel(operativeArticlesOf(organization)?.table1Version)})${parts.length ? `, supplemented by ${parts.join("; ")}` : ""}`;
  }
  return `the articles signed by the incorporators${parts.length ? `, including ${parts.join("; ")}` : ""}`;
}

/**
 * Shareholder quorum under the recorded articles. Persons present (in person
 * or by proxy) and the issued voting shares they hold or represent come from
 * the attendance and securities registers; a headcount alone never meets a
 * share-fraction quorum.
 */
export function evaluateArticlesShareholderQuorum(input: {
  organization: any;
  eligibleShareholders: number;
  presentPersons: number;
  eligibleVotingShares?: number;
  presentVotingShares?: number;
}): { met: boolean | null; minimumPeople: number; minimumVotingShares?: number; citation: string } {
  const resolved = resolveOperativeArticles(input.organization);
  if (!resolved) return { met: null, minimumPeople: 0, citation: "No operative articles recorded for a BC company" };
  const quorum = resolved.shareholderQuorum.value;
  const presentPeople = Math.min(input.presentPersons, input.eligibleShareholders);
  const result = legalMeetingQuorum({
    entityType: "corporation__business_",
    jurisdiction: "CA-BC",
    eligiblePeople: input.eligibleShareholders,
    presentPeople,
    eligibleVotingShares: input.eligibleVotingShares,
    presentVotingShares: input.presentVotingShares,
    adoptedModel: quorum.numerator ? "bc_table_1" : undefined,
    configuredMinimum: quorum.people,
    votingShareFraction: quorum.numerator && quorum.denominator ? { numerator: quorum.numerator, denominator: quorum.denominator } : undefined,
  });
  const minimumVotingShares = quorum.numerator && quorum.denominator && input.eligibleVotingShares !== undefined
    ? Math.ceil(input.eligibleVotingShares * quorum.numerator / quorum.denominator) : undefined;
  const citation = resolved.shareholderQuorum.basis === "table_1" ? resolved.shareholderQuorum.citation
    : resolved.shareholderQuorum.basis === "articles" ? "Recorded articles quorum provision; BCA s. 172(1)(a)" : result.citation;
  return { met: result.met, minimumPeople: result.minimumPeople, ...(minimumVotingShares !== undefined ? { minimumVotingShares } : {}), citation };
}

/** A plain description of the shareholder quorum, e.g. for a minutes snapshot. */
export function describeArticlesShareholderQuorum(organization: any, counts?: { eligibleShareholders?: number; eligibleVotingShares?: number }): string | undefined {
  const resolved = resolveOperativeArticles(organization);
  if (!resolved) return undefined;
  const quorum = resolved.shareholderQuorum.value;
  const eligible = counts?.eligibleShareholders;
  const people = eligible !== undefined && eligible > 0 ? Math.min(eligible, quorum.people) : quorum.people;
  const persons = `${people} ${people === 1 ? "person" : "persons"} present or by proxy`;
  const shares = quorum.numerator && quorum.denominator && !(eligible === 1)
    ? ` holding or representing at least ${quorum.numerator}/${quorum.denominator} of the issued shares entitled to vote${counts?.eligibleVotingShares ? ` (${Math.ceil(counts.eligibleVotingShares * quorum.numerator / quorum.denominator)} of ${counts.eligibleVotingShares})` : ""}`
    : "";
  return `${resolved.shareholderQuorum.citation}: ${persons}${shares}. Confirm the shares represented from the securities register; attendee names alone do not establish this quorum.`;
}
