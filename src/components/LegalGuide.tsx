import { ExternalLink, Scale } from "lucide-react";
import { Tooltip } from "./Tooltip";
import { Badge, type ToneVariant } from "./ui";
import {
  formatGuideDateRange,
  getJurisdictionGuidePack,
  LegalGuideRule,
} from "../lib/jurisdictionGuideTracks";
import { formatDate } from "../lib/format";

export function LegalGuideBadge({
  rule,
  compact = false,
}: {
  rule: LegalGuideRule;
  compact?: boolean;
}) {
  const label = compact ? rule.sectionLabel : `Legal guide: ${rule.citationLabel}`;

  return (
    <Tooltip
      placement="bottom"
      content={
        <div className="legal-guide-tooltip">
          <strong>{rule.citationLabel}</strong>
          <span>{rule.tooltipText}</span>
          {rule.caveatText && <span>{rule.caveatText}</span>}
          <span>{formatGuideDateRange(rule)}</span>
          {rule.sourceCurrentToISO && (
            <span>BC Laws source current to {formatDate(rule.sourceCurrentToISO)}.</span>
          )}
        </div>
      }
    >
      <a
        className="legal-guide-badge"
        href={rule.sourceUrl}
        target="_blank"
        rel="noreferrer"
        aria-label={`Open ${rule.citationLabel} source`}
      >
        <Scale size={12} aria-hidden="true" />
        <span>{label}</span>
        <ExternalLink size={11} aria-hidden="true" />
      </a>
    </Tooltip>
  );
}

export function LegalGuideInline({
  rules,
  max = 2,
}: {
  rules: LegalGuideRule[];
  max?: number;
}) {
  if (rules.length === 0) return null;
  const visible = rules.slice(0, max);
  const hiddenCount = rules.length - visible.length;

  return (
    <span className="legal-guide-inline" aria-label="Legal guide citations">
      {visible.map((rule) => (
        <LegalGuideBadge key={rule.id} rule={rule} compact />
      ))}
      {hiddenCount > 0 && <Badge tone="neutral">+{hiddenCount} guide tracks</Badge>}
    </span>
  );
}

export function LegalGuideTrackList({
  rules,
  jurisdictionCode,
  dateISO,
}: {
  rules: LegalGuideRule[];
  jurisdictionCode: string;
  dateISO?: string | null;
}) {
  const pack = getJurisdictionGuidePack(jurisdictionCode);

  if (rules.length === 0) {
    return (
      <div className="muted" style={{ fontSize: "var(--fs-sm)" }}>
        No legal guide tracks are configured for {pack.name}
        {dateISO ? ` on ${formatDate(dateISO)}` : ""}.
      </div>
    );
  }

  return (
    <div className="legal-guide-track-list">
      {rules.map((rule) => (
        <div className="legal-guide-track" key={rule.id}>
          <div className="legal-guide-track__top">
            <LegalGuideBadge rule={rule} />
            <Badge tone={toneForRule(rule)}>{labelForRuleKind(rule.ruleKind)}</Badge>
          </div>
          <div className="legal-guide-track__summary">{rule.summary}</div>
          <div className="legal-guide-track__meta">
            {rule.instrument} - {formatGuideDateRange(rule)}
          </div>
        </div>
      ))}
    </div>
  );
}

function labelForRuleKind(kind: LegalGuideRule["ruleKind"]) {
  if (kind === "statutory_minimum") return "Statute";
  if (kind === "default_rule") return "Default";
  if (kind === "model_bylaw") return "Model bylaw";
  return "Historical";
}

function toneForRule(rule: LegalGuideRule): ToneVariant {
  if (rule.ruleKind === "historical_caveat") return "warn";
  if (rule.ruleKind === "model_bylaw") return "info";
  if (rule.ruleKind === "default_rule") return "accent";
  return "neutral";
}
