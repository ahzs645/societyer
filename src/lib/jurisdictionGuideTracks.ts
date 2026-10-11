import { canonicalizeJurisdictionCode, homeJurisdictionCode, type LegalEntityLike } from "../../shared/organizationDomain";
import { legalGovernanceProfile } from "../../shared/legalGovernanceProfiles";
import { legalSourceById } from "../../shared/legalSources";
import { resolvePrivacyProfile, PRIVACY_LAWS, PRIVACY_CITATIONS, PRIVACY_REVIEWED_ON, type PrivacyAssessmentInput, type PrivacyRule } from "../../shared/privacyRuleProfiles";
import { JURISDICTION_GUIDE_PACK_JSON } from "./jurisdictionGuidePackRegistry";
import {
  jurisdictionGuidePackSchema,
  type JurisdictionGuidePackV2,
} from "./jurisdictionGuideSchema";

export type JurisdictionCode = "CA-BC" | "CA-FED-CBCA" | "CA-ON-OBCA" | string;

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
  | "directors_quorum"
  | "privacy_officer"
  | "privacy_policy"
  | "privacy_consent"
  | "privacy_access"
  | "privacy_retention"
  | "privacy_breach"
  | "privacy_pia";

export type LegalGuideRuleKind =
  | "statutory_minimum"
  | "default_rule"
  | "model_bylaw"
  | "historical_caveat"
  | "policy_guidance";

export type LegalGuideRule = {
  id: string;
  jurisdictionCode: JurisdictionCode;
  jurisdictionName: string;
  statuteKey: string;
  instrument: string;
  sectionLabel: string;
  citationLabel: string;
  topics: LegalGuideTopic[];
  /** Present only when this rule wording's commencement has been verified. */
  effectiveFromISO?: string;
  /** Current wording reviewed on this date; does not establish historical validity. */
  currentAsOfISO?: string;
  reviewedAtISO?: string;
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
  metadata?: {
    schemaVersion: string;
    packId: string;
    status: string;
    version: string;
    reviewedAt: string;
    legalDisclaimer: string;
    maintainers: { name: string; role: string; contact?: string }[];
  };
};

export const JURISDICTION_GUIDE_PACKS: JurisdictionGuidePack[] =
  JURISDICTION_GUIDE_PACK_JSON.map(normalizeGuidePack);

export const JURISDICTION_OPTIONS = JURISDICTION_GUIDE_PACKS.filter((pack, index, packs) => index === packs.findIndex((item) => item.code === pack.code)).map((pack) => ({
  value: pack.code,
  label: pack.name,
  hint: pack.code === "CA-BC" ? "BC society and company guidance use separate governing Acts; select the matching entity setup." : pack.description,
}));

/** Internal guide track for a BC entity that is neither a BC society nor a BC company. */
export const BC_ENTITY_REVIEW_GUIDE_CODE = "CA-BC-ENTITY-REVIEW";

/** Resolve the governing Act first. Incorporation location alone cannot select
 * a business-corporation guide for an explicit nonprofit or custom entity. */
export function resolveJurisdictionCode(organization?: LegalEntityLike | null): JurisdictionCode {
  const code = canonicalizeJurisdictionCode(homeJurisdictionCode(organization));
  if (!organization || code === "unknown") return code;
  const profile = legalGovernanceProfile(organization);
  if (profile?.id === "bc_company") return "CA-BC-BCA";
  if (profile?.id === "bc_society") return "CA-BC";
  if (profile) return profile.jurisdictionCode;
  // An untyped jurisdiction selector may preview a pack; an explicit unmatched
  // Act/entity must not inherit that preview as applicable guidance.
  if (!organization.entityType && !organization.kind && !organization.organizationKind && !organization.actFormedUnder) return code;
  return code === "CA-BC" ? BC_ENTITY_REVIEW_GUIDE_CODE : `${code}-ENTITY-REVIEW`;
}

export function getJurisdictionGuidePack(
  jurisdictionCode: JurisdictionCode,
): JurisdictionGuidePack {
  return (
    JURISDICTION_GUIDE_PACKS.find((pack) => jurisdictionCode === "CA-BC-BCA" ? pack.metadata?.packId === "ca-bc-bca" : pack.code === jurisdictionCode) ??
    unsupportedJurisdictionGuidePack(jurisdictionCode)
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
  if (!rule.effectiveFromISO) return rule.currentAsOfISO
    ? `current wording reviewed ${shortISODate(rule.currentAsOfISO)}; commencement not established by this guide`
    : "effective period not established";
  const from = shortISODate(rule.effectiveFromISO);
  if (!rule.effectiveToISO) return `effective from ${from}`;
  return `${from} to before ${shortISODate(rule.effectiveToISO)}`;
}

function isEffective(rule: LegalGuideRule, dateTime: number) {
  // A current-source review cannot prove what the statute said at an earlier meeting.
  const from = timestamp(rule.effectiveFromISO ?? rule.currentAsOfISO) ?? Number.NEGATIVE_INFINITY;
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

function unsupportedJurisdictionGuidePack(
  jurisdictionCode: JurisdictionCode,
): JurisdictionGuidePack {
  if (jurisdictionCode.endsWith("-ENTITY-REVIEW")) {
    return {
      code: jurisdictionCode,
      name: `${jurisdictionCode.replace("-ENTITY-REVIEW", "")} — entity-specific review required`,
      countryCode: "CA",
      subdivisionCode: jurisdictionCode === BC_ENTITY_REVIEW_GUIDE_CODE ? "BC" : undefined,
      default: false,
      description:
        "No reviewed statutory guide pack is configured for this governing Act and entity type. Confirm the legal identity before relying on jurisdiction guidance.",
      sources: [],
      rules: [],
    };
  }
  return {
    code: jurisdictionCode || "unknown",
    name: jurisdictionCode ? `Unsupported jurisdiction (${jurisdictionCode})` : "Unsupported jurisdiction",
    countryCode: "",
    default: false,
    description:
      "No source-backed statutory guide pack is configured for this jurisdiction yet.",
    sources: [],
    rules: [],
  };
}

function normalizeGuidePack(pack: unknown): JurisdictionGuidePack {
  return adaptGuidePack(jurisdictionGuidePackSchema.parse(pack));
}

function adaptGuidePack(pack: JurisdictionGuidePackV2): JurisdictionGuidePack {
  const sourcesById = new Map(pack.sources.map((source) => [source.sourceId, source]));
  return {
    code: pack.jurisdiction.code,
    name: pack.jurisdiction.name,
    countryCode: pack.jurisdiction.countryCode,
    subdivisionCode: pack.jurisdiction.subdivisionCode,
    default: pack.defaultForJurisdiction,
    description: pack.description,
    metadata: {
      schemaVersion: pack.schemaVersion,
      packId: pack.packId,
      status: pack.status,
      version: pack.version,
      reviewedAt: pack.reviewedAt,
      legalDisclaimer: pack.legalDisclaimer,
      maintainers: pack.maintainers,
    },
    sources: pack.sources.map((source) => ({
      label: source.title,
      url: source.canonicalUrl,
      currentToISO: source.currentTo,
    })),
    rules: pack.rules.map((rule) => {
      const source = sourcesById.get(rule.authority.sourceId);
      const section = rule.authority.sections[0];
      const registrySources = (rule.authority.registrySourceIds ?? []).map((id) => {
        const record = legalSourceById.get(id);
        if (!record) throw new Error(`${rule.ruleId}: unknown shared legal source ${id}`);
        if (record.status === "proposed") throw new Error(`${rule.ruleId}: proposed law cannot supply an operative guide`);
        return record;
      });
      const primary = registrySources[0];
      const summary = registrySources.length ? registrySources.map((record) => record.summary).join(" ") : rule.content.summary;
      const sourceCaveats = registrySources.map((record) => record.caveat).filter(Boolean).join(" ");
      return {
        id: rule.ruleId,
        jurisdictionCode: pack.jurisdiction.code,
        jurisdictionName: pack.jurisdiction.name,
        statuteKey: rule.authority.sourceId,
        instrument: primary?.instrument ?? rule.authority.instrument,
        sectionLabel: primary?.section ?? section.label,
        citationLabel: primary?.fullCitation ?? rule.content.displayCitation,
        topics: rule.topics,
        effectiveFromISO: rule.validity.effectiveFrom,
        effectiveToISO: rule.validity.effectiveTo ?? undefined,
        currentAsOfISO: rule.validity.currentAsOf,
        reviewedAtISO: primary?.reviewedOn ?? rule.provenance.verifiedAt,
        sourceUrl: primary?.url ?? section.url,
        pointInTimeUrl: section.pointInTimeUrl ?? source?.pointInTimeUrl,
        sourceCurrentToISO: primary ? primary.consolidatedThrough : rule.provenance.sourceCurrentTo ?? source?.currentTo,
        ruleKind: legacyRuleKind(rule.ruleType),
        summary,
        tooltipText: primary ? summary : rule.content.tooltip,
        caveatText: sourceCaveats || rule.content.caveat,
        priority: rule.priority,
      };
    }),
  };
}

function legacyRuleKind(ruleKind: string): LegalGuideRuleKind {
  if (
    ruleKind === "statutory_minimum" ||
    ruleKind === "default_rule" ||
    ruleKind === "model_bylaw" ||
    ruleKind === "historical_caveat" ||
    ruleKind === "policy_guidance"
  ) {
    return ruleKind;
  }
  if (ruleKind === "transitional_rule") return "historical_caveat";
  return "statutory_minimum";
}

/** Privacy guidance has its own activity-based resolver and never lives in an
 * incorporation guide pack. Conditional profiles remain in the assessment UI;
 * this API returns requirements only for recorded applicable handling. */
export function getPrivacyLegalGuideRules({ organization, topics }: {
  organization?: PrivacyAssessmentInput | null;
  topics?: PrivacyRule["key"][];
}): LegalGuideRule[] {
  const topicSet = topics ? new Set(topics) : null;
  return resolvePrivacyProfile(organization).applicableLawIds.flatMap((lawId) => {
    const law = PRIVACY_LAWS[lawId];
    return law.rules.filter((rule) => !topicSet || topicSet.has(rule.key)).map((rule) => {
      const source = PRIVACY_CITATIONS[rule.citationIds[0]];
      return {
        id: `privacy-${lawId}-${rule.key}`,
        jurisdictionCode: law.jurisdiction,
        jurisdictionName: law.label,
        statuteKey: lawId,
        instrument: source.instrument,
        sectionLabel: source.section,
        citationLabel: source.fullCitation,
        topics: [`privacy_${rule.key}` as LegalGuideTopic],
        currentAsOfISO: PRIVACY_REVIEWED_ON,
        reviewedAtISO: PRIVACY_REVIEWED_ON,
        sourceUrl: source.url,
        sourceCurrentToISO: source.sourceCurrentToISO,
        ruleKind: rule.obligation === "recommended" ? "policy_guidance" as const : "statutory_minimum" as const,
        summary: rule.body,
        tooltipText: rule.body,
        caveatText: source.caveat,
      };
    });
  });
}
