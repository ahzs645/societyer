export type JurisdictionCode = "CA-BC" | string;

export type LegalGuideTopic =
  | "bylaw_requirements"
  | "bylaw_effective_date"
  | "general_meeting_notice"
  | "agm_timing"
  | "annual_report"
  | "member_proposals"
  | "requisitioned_meetings"
  | "quorum"
  | "electronic_participation"
  | "proxy_voting"
  | "special_resolution"
  | "records"
  | "model_bylaws_quorum"
  | "model_bylaws_proxy"
  | "directors_quorum";

export type LegalGuideRuleKind =
  | "statutory_minimum"
  | "default_rule"
  | "model_bylaw"
  | "historical_caveat";

export type LegalGuideRule = {
  id: string;
  jurisdictionCode: JurisdictionCode;
  jurisdictionName: string;
  statuteKey: string;
  instrument: string;
  sectionLabel: string;
  citationLabel: string;
  topics: LegalGuideTopic[];
  effectiveFromISO: string;
  /** Exclusive end timestamp. Omit for current rules. */
  effectiveToISO?: string;
  sourceUrl: string;
  pointInTimeUrl?: string;
  sourceCurrentToISO?: string;
  ruleKind: LegalGuideRuleKind;
  summary: string;
  tooltipText: string;
  caveatText?: string;
  priority?: number;
};

export type JurisdictionGuidePack = {
  code: JurisdictionCode;
  name: string;
  countryCode: string;
  subdivisionCode?: string;
  default: boolean;
  description: string;
  sources: {
    label: string;
    url: string;
    currentToISO?: string;
  }[];
  rules: LegalGuideRule[];
};

const BC_SOCIETIES_ACT_URL =
  "https://www.bclaws.gov.bc.ca/civix/document/id/complete/statreg/15018_01";
const BC_SOCIETIES_ACT_PIT_URL =
  "https://www.bclaws.gov.bc.ca/civix/document/id/complete/statreg/15018_pit";
const BC_SOCIETIES_ACT_TLC_URL =
  "https://www.bclaws.gov.bc.ca/civix/document/id/complete/statreg/E3tlc15018";
const BC_SOCIETIES_REGULATION_URL =
  "https://www.bclaws.gov.bc.ca/civix/document/id/complete/statreg/216_2015";
const BC_FORMER_SOCIETY_ACT_PIT_URL =
  "https://www.bclaws.gov.bc.ca/civix/document/id/complete/statreg/96433_pit";

const BC_CURRENT_TO_ISO = "2026-04-14";
const BC_ACT_EFFECTIVE_FROM_ISO = "2016-11-28T00:00:00.000Z";

function bcRule(
  rule: Omit<
    LegalGuideRule,
    "jurisdictionCode" | "jurisdictionName" | "statuteKey"
  >,
): LegalGuideRule {
  return {
    jurisdictionCode: "CA-BC",
    jurisdictionName: "British Columbia",
    statuteKey: "bc-societies-act",
    ...rule,
  };
}

const bcRules: LegalGuideRule[] = [
  bcRule({
    id: "ca-bc-former-society-act-pre-2016",
    instrument: "Former Society Act",
    sectionLabel: "PIT archive",
    citationLabel: "Former BC Society Act PIT",
    topics: [
      "bylaw_requirements",
      "bylaw_effective_date",
      "general_meeting_notice",
      "agm_timing",
      "annual_report",
      "member_proposals",
      "requisitioned_meetings",
      "quorum",
      "electronic_participation",
      "proxy_voting",
      "special_resolution",
      "records",
    ],
    effectiveFromISO: "2000-09-06T00:00:00.000Z",
    effectiveToISO: BC_ACT_EFFECTIVE_FROM_ISO,
    sourceUrl: BC_FORMER_SOCIETY_ACT_PIT_URL,
    pointInTimeUrl: BC_FORMER_SOCIETY_ACT_PIT_URL,
    ruleKind: "historical_caveat",
    summary:
      "Meetings before Nov 28, 2016 belong to the former Society Act track, not the current Societies Act baseline.",
    tooltipText:
      "Use the former Society Act point-in-time archive for this date. Current BC Societies Act quorum, notice, electronic meeting, and proxy checks should not be applied automatically.",
    caveatText:
      "This app flags the historical source track only; it does not yet encode every pre-2016 rule.",
    priority: 0,
  }),
  bcRule({
    id: "ca-bc-societies-act-bylaw-requirements",
    instrument: "Societies Act",
    sectionLabel: "s.11",
    citationLabel: "BC Societies Act s.11",
    topics: ["bylaw_requirements"],
    effectiveFromISO: BC_ACT_EFFECTIVE_FROM_ISO,
    sourceUrl: BC_SOCIETIES_ACT_URL,
    pointInTimeUrl: BC_SOCIETIES_ACT_PIT_URL,
    sourceCurrentToISO: BC_CURRENT_TO_ISO,
    ruleKind: "statutory_minimum",
    summary:
      "BC bylaws are the local rule source for meeting procedures, including any quorum greater than the statutory default.",
    tooltipText:
      "Use this guide to keep society-specific bylaw rules separate from the statutory floor. A bylaw rule version should cite the filed bylaw or amendment that created it.",
    caveatText:
      "A society's filed bylaws can be stricter where the Act allows.",
    priority: 10,
  }),
  bcRule({
    id: "ca-bc-societies-act-bylaw-effective-date",
    instrument: "Societies Act",
    sectionLabel: "s.17",
    citationLabel: "BC Societies Act s.17",
    topics: ["bylaw_effective_date"],
    effectiveFromISO: BC_ACT_EFFECTIVE_FROM_ISO,
    sourceUrl: BC_SOCIETIES_ACT_URL,
    pointInTimeUrl: BC_SOCIETIES_ACT_PIT_URL,
    sourceCurrentToISO: BC_CURRENT_TO_ISO,
    ruleKind: "statutory_minimum",
    summary:
      "Bylaw changes are prospective from the filed/effective date, so old meetings should be checked against the rule in force on that date.",
    tooltipText:
      "When a bylaw change occurs, create a new rule version with its effective date. Do not overwrite the old version used by earlier meetings.",
    caveatText:
      "Use the actual filing/amendment source when available.",
    priority: 5,
  }),
  bcRule({
    id: "ca-bc-societies-act-agm-timing",
    instrument: "Societies Act",
    sectionLabel: "ss.71-73",
    citationLabel: "BC Societies Act ss.71-73",
    topics: ["agm_timing", "annual_report"],
    effectiveFromISO: BC_ACT_EFFECTIVE_FROM_ISO,
    sourceUrl: BC_SOCIETIES_ACT_URL,
    pointInTimeUrl: BC_SOCIETIES_ACT_PIT_URL,
    sourceCurrentToISO: BC_CURRENT_TO_ISO,
    ruleKind: "statutory_minimum",
    summary:
      "An AGM is generally held each calendar year, and the annual report is filed after the AGM.",
    tooltipText:
      "For BC annual workflows, check the AGM date, any registrar extension, and the annual report timing against the Act for the meeting year.",
    caveatText:
      "Registrar extensions and deemed AGMs can change the ordinary workflow.",
    priority: 30,
  }),
  bcRule({
    id: "ca-bc-societies-act-general-notice-2016",
    instrument: "Societies Act",
    sectionLabel: "ss.77-78 PIT",
    citationLabel: "BC Societies Act ss.77-78 PIT",
    topics: ["general_meeting_notice"],
    effectiveFromISO: BC_ACT_EFFECTIVE_FROM_ISO,
    effectiveToISO: "2023-05-04T00:00:00.000Z",
    sourceUrl: BC_SOCIETIES_ACT_PIT_URL,
    pointInTimeUrl: BC_SOCIETIES_ACT_PIT_URL,
    ruleKind: "historical_caveat",
    summary:
      "Notice timing/content rules changed around electronic meeting amendments before the current 2023 wording.",
    tooltipText:
      "For meetings before May 4, 2023, use the BC Laws point-in-time source for the exact notice wording in force on that date.",
    caveatText:
      "The app points to the correct historical source track but does not yet encode every notice-delivery variant.",
    priority: 20,
  }),
  bcRule({
    id: "ca-bc-societies-act-general-notice-current",
    instrument: "Societies Act",
    sectionLabel: "ss.77-78",
    citationLabel: "BC Societies Act ss.77-78",
    topics: ["general_meeting_notice"],
    effectiveFromISO: "2023-05-04T00:00:00.000Z",
    sourceUrl: BC_SOCIETIES_ACT_URL,
    pointInTimeUrl: BC_SOCIETIES_ACT_PIT_URL,
    sourceCurrentToISO: BC_CURRENT_TO_ISO,
    ruleKind: "statutory_minimum",
    summary:
      "General meeting notice is generally 14 to 60 days before the meeting; bylaws can set at least 7 days, and notice content must include meeting details and special resolution text.",
    tooltipText:
      "For current BC meetings, ss.77-78 guide notice timing and content. Electronic meetings also need attendance/participation instructions.",
    caveatText:
      "Bylaws may set a longer or Act-permitted shorter notice period.",
    priority: 20,
  }),
  bcRule({
    id: "ca-bc-societies-act-member-proposals",
    instrument: "Societies Act",
    sectionLabel: "s.81",
    citationLabel: "BC Societies Act s.81",
    topics: ["member_proposals"],
    effectiveFromISO: BC_ACT_EFFECTIVE_FROM_ISO,
    sourceUrl: BC_SOCIETIES_ACT_URL,
    pointInTimeUrl: BC_SOCIETIES_ACT_PIT_URL,
    sourceCurrentToISO: BC_CURRENT_TO_ISO,
    ruleKind: "statutory_minimum",
    summary:
      "Member proposal thresholds are based on voting members, with bylaws able to lower the percentage where allowed.",
    tooltipText:
      "Use this as the statutory baseline for AGM member-proposal intake, then apply any lower bylaw threshold stored in the bylaw rule version.",
    caveatText:
      "The proposal wording and delivery rules should be checked against the point-in-time source.",
    priority: 45,
  }),
  bcRule({
    id: "ca-bc-societies-act-requisition",
    instrument: "Societies Act",
    sectionLabel: "s.75",
    citationLabel: "BC Societies Act s.75",
    topics: ["requisitioned_meetings"],
    effectiveFromISO: BC_ACT_EFFECTIVE_FROM_ISO,
    sourceUrl: BC_SOCIETIES_ACT_URL,
    pointInTimeUrl: BC_SOCIETIES_ACT_PIT_URL,
    sourceCurrentToISO: BC_CURRENT_TO_ISO,
    ruleKind: "statutory_minimum",
    summary:
      "Voting members can requisition a general meeting using the Act's threshold unless bylaws provide a lower percentage.",
    tooltipText:
      "This guide track supports member-requisition workflows and should be paired with the bylaw rule version for the meeting date.",
    caveatText:
      "Use the point-in-time source for older requisition wording.",
    priority: 46,
  }),
  bcRule({
    id: "ca-bc-societies-act-quorum",
    instrument: "Societies Act",
    sectionLabel: "s.82",
    citationLabel: "BC Societies Act s.82",
    topics: ["quorum"],
    effectiveFromISO: BC_ACT_EFFECTIVE_FROM_ISO,
    sourceUrl: BC_SOCIETIES_ACT_URL,
    pointInTimeUrl: BC_SOCIETIES_ACT_PIT_URL,
    sourceCurrentToISO: BC_CURRENT_TO_ISO,
    ruleKind: "default_rule",
    summary:
      "The statutory quorum baseline is 3 voting members unless bylaws require more; if the society has fewer voting members, all voting members form quorum.",
    tooltipText:
      "Use the meeting date to pick the society's bylaw quorum version. The Act provides the floor; the filed bylaws can require a higher number or formula.",
    caveatText:
      "Court orders and adjourned-meeting bylaw provisions can affect a particular meeting.",
    priority: 1,
  }),
  bcRule({
    id: "ca-bc-societies-act-electronic-participation-2016",
    instrument: "Societies Act",
    sectionLabel: "s.83 PIT",
    citationLabel: "BC Societies Act s.83 PIT",
    topics: ["electronic_participation"],
    effectiveFromISO: BC_ACT_EFFECTIVE_FROM_ISO,
    effectiveToISO: "2021-05-20T00:00:00.000Z",
    sourceUrl: BC_SOCIETIES_ACT_PIT_URL,
    pointInTimeUrl: BC_SOCIETIES_ACT_PIT_URL,
    ruleKind: "historical_caveat",
    summary:
      "Before the May 20, 2021 amendments, electronic participation used older communication wording and facilitation obligations differed.",
    tooltipText:
      "For meetings before May 20, 2021, use the point-in-time s.83 text rather than the current electronic-meeting rule.",
    caveatText:
      "Bylaws may have restricted or shaped electronic participation.",
    priority: 31,
  }),
  bcRule({
    id: "ca-bc-societies-act-electronic-participation-current",
    instrument: "Societies Act",
    sectionLabel: "s.83",
    citationLabel: "BC Societies Act s.83",
    topics: ["electronic_participation"],
    effectiveFromISO: "2021-05-20T00:00:00.000Z",
    sourceUrl: BC_SOCIETIES_ACT_URL,
    pointInTimeUrl: BC_SOCIETIES_ACT_PIT_URL,
    sourceCurrentToISO: BC_CURRENT_TO_ISO,
    ruleKind: "statutory_minimum",
    summary:
      "Unless bylaws say otherwise, eligible participants may attend by telephone or other communications medium when participation requirements are met.",
    tooltipText:
      "Electronic and hybrid meeting checks should cite the rule in force on the meeting date and any bylaw override.",
    caveatText:
      "Fully electronic meetings carry separate facilitation and notice-instruction requirements.",
    priority: 31,
  }),
  bcRule({
    id: "ca-bc-societies-act-voting-rights",
    instrument: "Societies Act",
    sectionLabel: "s.84",
    citationLabel: "BC Societies Act s.84",
    topics: ["special_resolution"],
    effectiveFromISO: BC_ACT_EFFECTIVE_FROM_ISO,
    sourceUrl: BC_SOCIETIES_ACT_URL,
    pointInTimeUrl: BC_SOCIETIES_ACT_PIT_URL,
    sourceCurrentToISO: BC_CURRENT_TO_ISO,
    ruleKind: "statutory_minimum",
    summary:
      "Voting rights and one-vote rules start in the Act, with class and good-standing limits controlled by bylaws where allowed.",
    tooltipText:
      "Use this guide when checking who could vote on resolutions before applying bylaw-specific voting-class rules.",
    caveatText:
      "Voting by mail, delegate, or electronic means depends on bylaw authority.",
    priority: 55,
  }),
  bcRule({
    id: "ca-bc-societies-act-proxies-2016",
    instrument: "Societies Act",
    sectionLabel: "s.85 PIT",
    citationLabel: "BC Societies Act s.85 PIT",
    topics: ["proxy_voting"],
    effectiveFromISO: BC_ACT_EFFECTIVE_FROM_ISO,
    effectiveToISO: "2021-10-28T00:00:00.000Z",
    sourceUrl: BC_SOCIETIES_ACT_PIT_URL,
    pointInTimeUrl: BC_SOCIETIES_ACT_PIT_URL,
    ruleKind: "historical_caveat",
    summary:
      "Before Oct 28, 2021, the proxy rule used older wording but still depended on bylaw permission.",
    tooltipText:
      "For meetings before Oct 28, 2021, use the point-in-time s.85 text and the bylaw rule version effective on the meeting date.",
    caveatText:
      "Proxy authority is bylaw-dependent.",
    priority: 32,
  }),
  bcRule({
    id: "ca-bc-societies-act-proxies-current",
    instrument: "Societies Act",
    sectionLabel: "s.85",
    citationLabel: "BC Societies Act s.85",
    topics: ["proxy_voting"],
    effectiveFromISO: "2021-10-28T00:00:00.000Z",
    sourceUrl: BC_SOCIETIES_ACT_URL,
    pointInTimeUrl: BC_SOCIETIES_ACT_PIT_URL,
    sourceCurrentToISO: BC_CURRENT_TO_ISO,
    ruleKind: "statutory_minimum",
    summary:
      "Proxy voting is not available unless the society's bylaws permit it.",
    tooltipText:
      "Store proxy permission in the dated bylaw rule version, then cite this statutory guide for the default BC position.",
    caveatText:
      "A valid proxy appointment still has to meet Act and bylaw requirements.",
    priority: 32,
  }),
  bcRule({
    id: "ca-bc-societies-act-special-resolution",
    instrument: "Societies Act",
    sectionLabel: "s.1",
    citationLabel: "BC Societies Act s.1",
    topics: ["special_resolution"],
    effectiveFromISO: BC_ACT_EFFECTIVE_FROM_ISO,
    sourceUrl: BC_SOCIETIES_ACT_URL,
    pointInTimeUrl: BC_SOCIETIES_ACT_PIT_URL,
    sourceCurrentToISO: BC_CURRENT_TO_ISO,
    ruleKind: "statutory_minimum",
    summary:
      "Special resolutions generally use a 2/3 voting threshold unless the Act or valid bylaws require more.",
    tooltipText:
      "Use the meeting date's bylaw rule version for any higher threshold, especially bylaw or constitution amendments.",
    caveatText:
      "Some actions have special statutory rules or limits on higher thresholds.",
    priority: 50,
  }),
  bcRule({
    id: "ca-bc-societies-act-records",
    instrument: "Societies Act",
    sectionLabel: "ss.20-24",
    citationLabel: "BC Societies Act ss.20-24",
    topics: ["records"],
    effectiveFromISO: BC_ACT_EFFECTIVE_FROM_ISO,
    sourceUrl: BC_SOCIETIES_ACT_URL,
    pointInTimeUrl: BC_SOCIETIES_ACT_PIT_URL,
    sourceCurrentToISO: BC_CURRENT_TO_ISO,
    ruleKind: "statutory_minimum",
    summary:
      "Society records, maintenance, and inspection rights are statutory obligations that should stay outside bylaw-only configuration.",
    tooltipText:
      "Use this track for records and source-document audit checks rather than treating records access as only a society preference.",
    caveatText:
      "Access restrictions and fees can vary by record type and requester.",
    priority: 60,
  }),
  bcRule({
    id: "ca-bc-model-bylaws-quorum",
    instrument: "Societies Regulation - Model Bylaws",
    sectionLabel: "ss.3.6-3.7",
    citationLabel: "BC Model Bylaws ss.3.6-3.7",
    topics: ["model_bylaws_quorum"],
    effectiveFromISO: BC_ACT_EFFECTIVE_FROM_ISO,
    sourceUrl: BC_SOCIETIES_REGULATION_URL,
    sourceCurrentToISO: BC_CURRENT_TO_ISO,
    ruleKind: "model_bylaw",
    summary:
      "The BC Model Bylaws quorum is 3 voting members or 10% of voting members, whichever is greater.",
    tooltipText:
      "Show this only as a model-bylaw guide unless the society actually adopted the Model Bylaws or matching wording.",
    caveatText:
      "The society's own filed bylaws control if they differ.",
    priority: 2,
  }),
  bcRule({
    id: "ca-bc-model-bylaws-proxy",
    instrument: "Societies Regulation - Model Bylaws",
    sectionLabel: "s.3.15",
    citationLabel: "BC Model Bylaws s.3.15",
    topics: ["model_bylaws_proxy"],
    effectiveFromISO: BC_ACT_EFFECTIVE_FROM_ISO,
    sourceUrl: BC_SOCIETIES_REGULATION_URL,
    sourceCurrentToISO: BC_CURRENT_TO_ISO,
    ruleKind: "model_bylaw",
    summary:
      "The BC Model Bylaws do not permit proxy voting.",
    tooltipText:
      "Use this guide only if the society adopted the Model Bylaws or uses equivalent proxy wording.",
    caveatText:
      "Other BC bylaws may permit proxies because the Act allows bylaw permission.",
    priority: 33,
  }),
  bcRule({
    id: "ca-bc-model-bylaws-directors-quorum",
    instrument: "Societies Regulation - Model Bylaws",
    sectionLabel: "s.5.5",
    citationLabel: "BC Model Bylaws s.5.5",
    topics: ["directors_quorum"],
    effectiveFromISO: BC_ACT_EFFECTIVE_FROM_ISO,
    sourceUrl: BC_SOCIETIES_REGULATION_URL,
    sourceCurrentToISO: BC_CURRENT_TO_ISO,
    ruleKind: "model_bylaw",
    summary:
      "The BC Model Bylaws directors' meeting quorum is a majority of directors.",
    tooltipText:
      "Use this guide only if the society adopted the Model Bylaws or matching directors' quorum wording.",
    caveatText:
      "The society's board-meeting bylaw language controls if different.",
    priority: 34,
  }),
];

export const JURISDICTION_GUIDE_PACKS: JurisdictionGuidePack[] = [
  {
    code: "CA-BC",
    name: "British Columbia",
    countryCode: "CA",
    subdivisionCode: "BC",
    default: true,
    description:
      "BC-focused guide tracks for societies, with point-in-time source links for date-sensitive checks.",
    sources: [
      {
        label: "BC Societies Act",
        url: BC_SOCIETIES_ACT_URL,
        currentToISO: BC_CURRENT_TO_ISO,
      },
      {
        label: "BC Societies Act point-in-time",
        url: BC_SOCIETIES_ACT_PIT_URL,
      },
      {
        label: "BC Societies Regulation and Model Bylaws",
        url: BC_SOCIETIES_REGULATION_URL,
        currentToISO: BC_CURRENT_TO_ISO,
      },
      {
        label: "Former BC Society Act point-in-time",
        url: BC_FORMER_SOCIETY_ACT_PIT_URL,
      },
      {
        label: "BC Societies Act legislative changes",
        url: BC_SOCIETIES_ACT_TLC_URL,
      },
    ],
    rules: bcRules,
  },
];

export const JURISDICTION_OPTIONS = JURISDICTION_GUIDE_PACKS.map((pack) => ({
  value: pack.code,
  label: pack.name,
  hint: pack.description,
}));

export function resolveJurisdictionCode(society?: {
  jurisdictionCode?: string | null;
} | null): JurisdictionCode {
  return society?.jurisdictionCode || "CA-BC";
}

export function getJurisdictionGuidePack(
  jurisdictionCode: JurisdictionCode,
): JurisdictionGuidePack {
  return (
    JURISDICTION_GUIDE_PACKS.find((pack) => pack.code === jurisdictionCode) ??
    JURISDICTION_GUIDE_PACKS.find((pack) => pack.default) ??
    JURISDICTION_GUIDE_PACKS[0]
  );
}

export function getLegalGuideRules({
  jurisdictionCode,
  dateISO,
  topics,
}: {
  jurisdictionCode: JurisdictionCode;
  dateISO?: string | null;
  topics?: LegalGuideTopic[];
}): LegalGuideRule[] {
  const pack = getJurisdictionGuidePack(jurisdictionCode);
  const dateTime = timestamp(dateISO) ?? Date.now();
  const topicSet = topics ? new Set(topics) : null;

  return pack.rules
    .filter((rule) => isEffective(rule, dateTime))
    .filter((rule) =>
      topicSet ? rule.topics.some((topic) => topicSet.has(topic)) : true,
    )
    .sort(compareGuideRules);
}

export function getPrimaryLegalGuide(args: {
  jurisdictionCode: JurisdictionCode;
  dateISO?: string | null;
  topics: LegalGuideTopic[];
}): LegalGuideRule | null {
  return getLegalGuideRules(args)[0] ?? null;
}

export function formatGuideDateRange(rule: LegalGuideRule) {
  const from = shortISODate(rule.effectiveFromISO);
  if (!rule.effectiveToISO) return `effective from ${from}`;
  return `${from} to before ${shortISODate(rule.effectiveToISO)}`;
}

function isEffective(rule: LegalGuideRule, dateTime: number) {
  const from = timestamp(rule.effectiveFromISO) ?? Number.NEGATIVE_INFINITY;
  const to = timestamp(rule.effectiveToISO) ?? Number.POSITIVE_INFINITY;
  return dateTime >= from && dateTime < to;
}

function timestamp(value?: string | null) {
  if (!value) return null;
  const normalized = value.length === 10 ? `${value}T00:00:00.000Z` : value;
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function compareGuideRules(a: LegalGuideRule, b: LegalGuideRule) {
  const priority = (a.priority ?? 100) - (b.priority ?? 100);
  if (priority !== 0) return priority;
  return a.citationLabel.localeCompare(b.citationLabel);
}

function shortISODate(value: string) {
  return value.slice(0, 10);
}
