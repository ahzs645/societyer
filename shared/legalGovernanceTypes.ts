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
/**
 * How far before the event a record date may fall. `statutory` means the cited
 * research states the limit; `conservative` means the research gives no limit
 * for this entity and purpose, so the product applies one and flags it for review.
 */
export type RecordDateLimit = {
  maxAgeDays?: number;
  /** Calendar months counted backwards from the event (month-end clamped). */
  maxAgeMonths?: number;
  /**
   * Fewest days a record date fixed in advance by the directors may precede the
   * event. Set only where the research states a minimum (OBCA s. 95(2): 30 days).
   * A record date that is the statutory default instead (OBCA s. 95(3)) is exempt.
   */
  minAgeDays?: number;
  basis: 'statutory' | 'conservative';
  /** Statute section as named in the research; not a source ID. */
  section?: string;
  /** Research report anchor supporting this entry, e.g. "meetings-records.md#mtg-5". */
  researchAnchor: string;
  /** Existing legal source IDs only; empty when no source record covers the section. */
  sourceIds: readonly string[];
  note: string;
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
    /**
     * A governing-instrument departure from unanimous directors' written consent
     * (Societies Act s. 54(2)(b); BC BCA s. 140(3)). Never a default: it applies
     * only when a reviewer records the bylaw/article provision and its threshold.
     */
    directorsWrittenOverride?: { provision: string; sourceIds: readonly string[] };
    /**
     * Societies Act s. 1 "ordinary resolution" (c) / "special resolution" (c):
     * where the bylaws authorize voting by mail or electronic means, the
     * threshold is a share of votes cast, not of all voting members.
     */
    memberMailElectronicVote?: {
      provision: string;
      ordinary: { numerator: number; denominator: number; strict: boolean };
      special: { numerator: number; denominator: number; strict: boolean };
      sourceIds: readonly string[];
    };
    sourceIds: readonly string[];
    caveat?: string;
  };
  /** Outer limits for a reviewed record date, measured back from the event it serves. */
  recordDates: {
    /** Shareholder/member meeting or election: measured from the meeting (or voting) date. */
    meeting: RecordDateLimit;
    /** Written resolution: measured from the circulation date. */
    writtenResolution: RecordDateLimit;
  };
  records: readonly LegalRecordRequirement[];
  /** Public/soliciting/benefit/ULC/regulated-sector overlays must not silently inherit private-core rules. */
  caveats: readonly string[];
};
