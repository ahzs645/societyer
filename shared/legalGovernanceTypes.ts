/** Versioned, framework-free legal profiles. New Acts add data, not scattered entity switches. */
export type LegalSourceRecord = {
  id: string;
  instrument: string;
  section: string;
  fullCitation: string;
  url: string;
  /** Date actually displayed by the consolidation. Omit if the publisher does not expose it. */
  consolidatedThrough?: string;
  reviewedOn: string;
  status: 'in_force' | 'registry_guidance' | 'proposed';
  summary: string;
  caveat?: string;
};
export type LegalRecordRequirement = {
  key: string;
  label: string;
  requirement: 'statutory' | 'conditional' | 'recommended';
  sourceIds: readonly string[];
  /** Document categories are evidence hints, never proof that a legal requirement is satisfied. */
  documentCategories: readonly string[];
  retention: string;
  access: string;
  caveat?: string;
};
export type LegalGovernanceProfile = {
  id: string;
  name: string;
  jurisdictionCode: string;
  kind: 'society' | 'corporation' | 'organization';
  actKeys: readonly string[];
  reviewedOn: string;
  /** Core rules verified; special subtypes and entity facts can still require review. */
  confidence: 'verified_core' | 'review_required';
  directors: {
    minimum: number;
    publicMinimum?: number;
    memberFundedMinimum?: number;
    residency: 'bc_ordinary' | 'canadian_25_percent' | 'none';
    sourceIds: readonly string[];
    consent: string;
    consentSourceIds: readonly string[];
    changeFilingDays?: number;
    changeFilingTiming?: string;
    caveat?: string;
  };
  annualMeeting: {
    label: string;
    first: 'following_calendar_year' | 'months_after_incorporation';
    firstMonths?: number;
    subsequentMonths?: number;
    eachCalendarYear: boolean;
    afterFiscalYearEndMonths?: number;
    sourceIds: readonly string[];
    writtenAlternative: string;
    caveat?: string;
  };
  annualReturn: {
    label: string;
    anchor: 'agm_or_january_31' | 'anniversary' | 'fiscal_year_end';
    days?: number;
    months?: number;
    sourceIds: readonly string[];
    caveat?: string;
  };
  meetings: {
    noticeMinDays: number;
    noticeMaxDays?: number;
    noticeMaxMonths?: number;
    articlesMayReduceNoticeToDays?: number;
    quorum: 'society_members' | 'two_shareholders' | 'majority_voting_shares';
    noticeSourceIds: readonly string[];
    quorumSourceIds: readonly string[];
    proxies: 'bylaws_must_permit' | 'permitted';
    caveat?: string;
  };
  resolutions: {
    /** Ordinary meeting resolutions require strictly more than one half of votes cast. */
    specialMeetingNumerator: number;
    specialMeetingDenominator: number;
    ordinaryWrittenNumerator: number;
    ordinaryWrittenDenominator: number;
    ordinaryWrittenStrict: boolean;
    /** BC ordinary written threshold follows the special majority in the operative articles. */
    ordinaryWrittenUsesSpecialMajority?: boolean;
    /** Ontario majority route applies only to non-offering corporations. */
    ordinaryWrittenNonPublicOnly?: boolean;
    ordinaryWrittenNoticeBusinessDays?: number;
    ordinaryWrittenDenominatorBasis?: 'votes' | 'shares';
    specialWrittenUnanimous: boolean;
    directorsWrittenUnanimous: boolean;
    sourceIds: readonly string[];
    caveat?: string;
  };
  records: readonly LegalRecordRequirement[];
  /** Public/soliciting/benefit/ULC/regulated-sector overlays must not silently inherit private-core rules. */
  caveats: readonly string[];
};
