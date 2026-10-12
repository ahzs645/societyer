import { canonicalizeJurisdictionCode, homeJurisdictionCode, organizationEntityType } from "./organizationDomain";
import { legalGovernanceProfile } from "./legalGovernanceProfiles";
import { meetingBodyKind, type BodyQuorumRule } from "./bodyQuorum";
import { resolveOperativeArticles } from "./operativeArticles";

/** Operational draft defaults. This is never evidence of adopting model bylaws. */
export const DEFAULT_BYLAW_RULES = {
  societyId: "placeholder", version: 1, status: "Baseline",
  generalNoticeMinDays: 14, generalNoticeMaxDays: 60,
  allowElectronicMeetings: true, allowHybridMeetings: true, allowElectronicVoting: false,
  allowProxyVoting: false, proxyHolderMustBeMember: false, proxyLimitPerGrantorPerMeeting: 1,
  quorumType: "fixed", quorumValue: 3, quorumMinimumCount: 3,
  memberProposalThresholdPct: 5, memberProposalMinSignatures: 2, memberProposalLeadDays: 7,
  requisitionMeetingThresholdPct: 10, annualReportDueDaysAfterMeeting: 30,
  requireAgmFinancialStatements: true, requireAgmElections: true, ballotIsAnonymous: true,
  voterMustBeMemberAtRecordDate: true, inspectionMemberRegisterByMembers: true,
  inspectionMemberRegisterByPublic: false, inspectionDirectorRegisterByMembers: true,
  inspectionCopiesAllowed: true, ordinaryResolutionThresholdPct: 50,
  specialResolutionThresholdPct: 66.67, unanimousWrittenSpecialResolution: true,
  updatedAtISO: new Date(0).toISOString(),
};

export function bylawBaselineForOrganization<SocietyId extends string>(organization: any, societyId: SocietyId) {
  const rawJurisdiction = canonicalizeJurisdictionCode(homeJurisdictionCode(organization));
  const entityType = organizationEntityType(organization);
  const profile = legalGovernanceProfile(organization);
  // Use the resolver's authority consistently, including its deliberate empty
  // legacy BC compatibility. An explicit unknown retains the review state.
  const jurisdictionCode = profile?.jurisdictionCode ?? rawJurisdiction;
  const company = profile?.kind === "corporation" || entityType === "corporation__business_";
  const supported = !!profile;
  const bcCompany = profile?.id === "bc_company";
  // Recorded operative articles (BC companies only; never inferred from silence).
  const blocked = !supported || organization?.formationStatus === "preparing" || organization?.formationStatus === "submitted" || organization?.formationStatus === "unverified_existing";
  // Article rules drive automation only once formation is verified, like every
  // other legal baseline; the record itself is still shown in settings.
  const articles = bcCompany && !blocked ? resolveOperativeArticles(organization) : null;
  const articlesBoardRule: BodyQuorumRule | undefined = articles?.boardQuorum
    ? { body: "board", ...articles.boardQuorum.value, countBasis: "directors_in_office", ...(articles.boardQuorum.value.quorumType === "majority" ? { quorumMinimumCount: 1 } : {}), notes: articles.boardQuorum.citation }
    : undefined;
  const baselineLabel = !profile ? "Governance review required for this entity and jurisdiction"
    : articles ? `${articles.label}; recorded articles, review against the signed articles`
    : `${profile.name} statutory draft baseline; governing documents review required`;
  return {
    ...DEFAULT_BYLAW_RULES, societyId,
    ...(company ? {
      generalNoticeMinDays: articles ? articles.noticeMinDays.value : profile?.id === "ontario_obca" && organization?.distributing ? 21 : profile?.meetings.noticeMinDays ?? 21,
      // Compatibility field for stored day-based rules; BC uses the separate
      // calendar-month maximum in every statutory notice assessment.
      generalNoticeMaxDays: profile?.meetings.noticeMaxDays ?? 62,
      allowProxyVoting: true,
      quorumType: bcCompany ? "fixed" : "percentage",
      quorumValue: bcCompany ? articles?.shareholderQuorum.value.people ?? 2 : 50,
      quorumMinimumCount: bcCompany ? articles?.shareholderQuorum.value.people ?? 2 : 1,
      annualReportDueDaysAfterMeeting: 0,
      inspectionMemberRegisterByMembers: false,
      inspectionDirectorRegisterByMembers: false,
      ...(articles ? {
        specialResolutionThresholdPct: articles.specialMajority.value === "three_quarters" ? 75 : 66.67,
        ...(articles.electronicParticipationRestricted.value ? { allowElectronicMeetings: false, allowHybridMeetings: false } : {}),
        ...(articlesBoardRule ? { bodyQuorumRules: [articlesBoardRule] } : {}),
      } : {}),
    } : {}),
    updatedAtISO: new Date().toISOString(),
    isFallback: true, requiresLegalReview: true, jurisdictionCode,
    baselineLabel, authorityCitation: !supported ? "No reviewed legal authority for this entity and jurisdiction" : company ? bcCompany ? articles?.model === "bc_table_1" ? "BCA ss.169,172; Regulation s.3; adopted Table 1 Arts. 8.2-8.3, 11.10-11.11" : "BCA ss.169,172; Regulation s.3; applicable articles" : jurisdictionCode === "CA-FED-CBCA" ? "CBCA ss.135,139; CBCR; applicable by-laws" : "OBCA ss.96,101; applicable bylaws" : "Societies Act ss.77,82; applicable bylaws",
    quorumDenominator: !supported ? "review_required" : company ? bcCompany ? "legal_shareholders" : "issued_voting_shares" : "legal_voting_members",
    quorumRequiresLegalRegister: company || !supported,
    governanceAutomationBlocked: blocked,
    noticeUsesCalendarMonthsMaximum: bcCompany,
    noticeRequiresClearDays: jurisdictionCode === "CA-BC",
    // Corporate quorum rules come from the articles, society rules from bylaws.
    governingInstrumentLabel: company ? "articles" : "bylaw rules",
    ...(articles ? {
      operativeArticlesModel: articles.model,
      articlesShareholderQuorum: { ...articles.shareholderQuorum.value, citation: articles.shareholderQuorum.citation },
      boardQuorumFromArticles: Boolean(articlesBoardRule),
      chairCastingVote: articles.chairCastingVote?.value,
      articlesWarnings: articles.warnings,
    } : {}),
  };
}

/** Article-derived fields a stored rule set must not replace. */
const ARTICLES_FIELDS = ["governingInstrumentLabel", "operativeArticlesModel", "articlesShareholderQuorum", "boardQuorumFromArticles", "chairCastingVote", "articlesWarnings"] as const;

/**
 * Corporate headcount quorum needs the legal registers, except a board meeting
 * of a BC company whose recorded articles set the board quorum (directors in
 * office are the population).
 */
export function quorumRequiresLegalRegisterFor(rules: Record<string, any> | null | undefined, meetingType?: string | null, committeeId?: string | null): boolean {
  if (!rules?.quorumRequiresLegalRegister) return false;
  return !(rules.boardQuorumFromArticles && meetingBodyKind(meetingType, committeeId) === "board" && !rules.governanceAutomationBlocked);
}

export function contextualBylawRules<SocietyId extends string>(organization: any, societyId: SocietyId, stored?: Record<string, any>) {
  const baseline = bylawBaselineForOrganization(organization, societyId);
  if (!stored || stored.status === "Baseline") return baseline;
  const { baselineLabel, authorityCitation, jurisdictionCode, quorumDenominator, quorumRequiresLegalRegister, governanceAutomationBlocked, noticeUsesCalendarMonthsMaximum, noticeRequiresClearDays } = baseline;
  const articleFields = Object.fromEntries(ARTICLES_FIELDS.filter((key) => key in baseline).map((key) => [key, (baseline as any)[key]]));
  // Stored body rules win per body; recorded articles fill a body they omit.
  const storedBodies = new Set((Array.isArray(stored.bodyQuorumRules) ? stored.bodyQuorumRules : []).map((row: any) => `${row?.body}:${row?.committeeId ?? ""}`));
  const articleBodyRules = ((baseline as any).bodyQuorumRules ?? []).filter((row: BodyQuorumRule) => !storedBodies.has(`${row.body}:${row.committeeId ?? ""}`));
  const bodyQuorumRules = articleBodyRules.length ? [...(Array.isArray(stored.bodyQuorumRules) ? stored.bodyQuorumRules : []), ...articleBodyRules] : stored.bodyQuorumRules;
  return { ...baseline, ...stored, ...(bodyQuorumRules !== undefined ? { bodyQuorumRules } : {}), ...articleFields, societyId, isFallback: false, baselineLabel, authorityCitation, jurisdictionCode, quorumDenominator, quorumRequiresLegalRegister, governanceAutomationBlocked, noticeUsesCalendarMonthsMaximum, noticeRequiresClearDays };
}

/** Dates are date-only local-calendar values, excluding sending and meeting
 * days when clear days apply. Time zones and DST never shorten a clear day. */
export function clearNoticeDays(noticeDate: string, meetingDate: string): number | null {
  const date = (value: string) => {
    const raw = value.slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return NaN;
    const time = Date.parse(`${raw}T00:00:00Z`);
    return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === raw ? time : NaN;
  };
  const difference = (date(meetingDate) - date(noticeDate)) / 86400000;
  return Number.isFinite(difference) ? difference - 1 : null;
}
