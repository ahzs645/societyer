import { canonicalizeJurisdictionCode, homeJurisdictionCode, organizationEntityType } from "./organizationDomain";

/** Operational draft defaults. This is never evidence of adopting model bylaws. */
export const DEFAULT_BYLAW_RULES = {
  societyId: "placeholder", version: 1, status: "Baseline",
  generalNoticeMinDays: 14, generalNoticeMaxDays: 60,
  allowElectronicMeetings: true, allowHybridMeetings: true, allowElectronicVoting: false,
  allowProxyVoting: false, proxyHolderMustBeMember: false, proxyLimitPerGrantorPerMeeting: 1,
  quorumType: "fixed", quorumValue: 3, quorumMinimumCount: 3,
  memberProposalThresholdPct: 5, memberProposalMinSignatures: 1, memberProposalLeadDays: 7,
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
  const legacyBcSociety = Boolean(organization && entityType === "organization" && !organization.entityType && !organization.kind && !organization.organizationKind &&
    (organization.actFormedUnder === "societies_act" || /^S\d/i.test(organization.incorporationNumber ?? "") || rawJurisdiction === "CA-BC"));
  const jurisdictionCode = legacyBcSociety && rawJurisdiction === "unknown" ? "CA-BC" : rawJurisdiction;
  const society = (entityType === "society" || legacyBcSociety) && jurisdictionCode === "CA-BC";
  const company = entityType === "corporation__business_";
  const supported = society || (company && ["CA-BC", "CA-FED-CBCA"].includes(jurisdictionCode));
  const bcCompany = company && jurisdictionCode === "CA-BC";
  const baselineLabel = !supported ? "Governance review required for this entity and jurisdiction" : company ? bcCompany ? "BC BCA statutory draft baseline; articles review required" : jurisdictionCode === "CA-FED-CBCA" ? "CBCA statutory draft baseline; articles/bylaws review required" : "Ontario governance review required" : "BC Societies Act statutory draft baseline; filed bylaws review required";
  return {
    ...DEFAULT_BYLAW_RULES, societyId,
    ...(company ? {
      generalNoticeMinDays: 21, generalNoticeMaxDays: bcCompany ? 62 : 60,
      allowProxyVoting: true,
      quorumType: bcCompany ? "fixed" : "percentage",
      quorumValue: bcCompany ? 2 : 50,
      quorumMinimumCount: bcCompany ? 2 : 1,
      annualReportDueDaysAfterMeeting: 0,
      inspectionMemberRegisterByMembers: false,
      inspectionDirectorRegisterByMembers: false,
    } : {}),
    updatedAtISO: new Date().toISOString(),
    isFallback: true, requiresLegalReview: true, jurisdictionCode,
    baselineLabel, authorityCitation: !supported ? "No reviewed legal authority for this entity and jurisdiction" : company ? bcCompany ? "BCA ss.169,172; Regulation; applicable articles" : jurisdictionCode === "CA-FED-CBCA" ? "CBCA ss.135,139; CBCR; applicable by-laws" : "OBCA; unverified governance configuration" : "Societies Act ss.67,77; applicable bylaws",
    quorumDenominator: !supported ? "review_required" : company ? bcCompany ? "legal_shareholders" : "issued_voting_shares" : "legal_voting_members",
    quorumRequiresLegalRegister: company || !supported,
    governanceAutomationBlocked: !supported || organization?.formationStatus === "preparing" || organization?.formationStatus === "submitted" || organization?.formationStatus === "unverified_existing",
    noticeUsesCalendarMonthsMaximum: bcCompany,
    noticeRequiresClearDays: jurisdictionCode === "CA-BC",
  };
}

export function contextualBylawRules<SocietyId extends string>(organization: any, societyId: SocietyId, stored?: Record<string, any>) {
  const baseline = bylawBaselineForOrganization(organization, societyId);
  if (!stored || stored.status === "Baseline") return baseline;
  const { baselineLabel, authorityCitation, jurisdictionCode, quorumDenominator, quorumRequiresLegalRegister, governanceAutomationBlocked, noticeUsesCalendarMonthsMaximum, noticeRequiresClearDays } = baseline;
  return { ...baseline, ...stored, societyId, isFallback: false, baselineLabel, authorityCitation, jurisdictionCode, quorumDenominator, quorumRequiresLegalRegister, governanceAutomationBlocked, noticeUsesCalendarMonthsMaximum, noticeRequiresClearDays };
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
