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

export const JURISDICTION_OPTIONS = JURISDICTION_GUIDE_PACKS.map((pack) => ({
  value: pack.code,
  label: pack.name,
  hint: pack.description,
}));

export function resolveJurisdictionCode(society?: {
  jurisdictionCode?: string | null;
} | null): JurisdictionCode {
  return society?.jurisdictionCode || "unknown";
}

export function getJurisdictionGuidePack(
  jurisdictionCode: JurisdictionCode,
): JurisdictionGuidePack {
  return (
    JURISDICTION_GUIDE_PACKS.find((pack) => pack.code === jurisdictionCode) ??
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

function unsupportedJurisdictionGuidePack(
  jurisdictionCode: JurisdictionCode,
): JurisdictionGuidePack {
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
      return {
        id: rule.ruleId,
        jurisdictionCode: pack.jurisdiction.code,
        jurisdictionName: pack.jurisdiction.name,
        statuteKey: rule.authority.sourceId,
        instrument: rule.authority.instrument,
        sectionLabel: section.label,
        citationLabel: rule.content.displayCitation,
        topics: rule.topics,
        effectiveFromISO: rule.validity.effectiveFrom,
        effectiveToISO: rule.validity.effectiveTo ?? undefined,
        sourceUrl: section.url,
        pointInTimeUrl: section.pointInTimeUrl ?? source?.pointInTimeUrl,
        sourceCurrentToISO: rule.provenance.sourceCurrentTo ?? source?.currentTo,
        ruleKind: legacyRuleKind(rule.ruleType),
        summary: rule.content.summary,
        tooltipText: rule.content.tooltip,
        caveatText: rule.content.caveat,
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
    ruleKind === "historical_caveat"
  ) {
    return ruleKind;
  }
  if (ruleKind === "transitional_rule") return "historical_caveat";
  return "statutory_minimum";
}
