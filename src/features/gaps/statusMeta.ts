import { CONTINUITY_STATUS_LABELS, type ContinuityStatus } from "../../../shared/continuity";
import type { ToneVariant } from "../../components/ui";

/**
 * Status encoding for the continuity heat-map and lists. Status is never
 * color-alone: every cell also carries a glyph and an accessible label.
 */
export const STATUS_META: Record<ContinuityStatus, { label: string; glyph: string; tone: ToneVariant; rank: number; description: string }> = {
  record_missing: { label: CONTINUITY_STATUS_LABELS.record_missing, glyph: "✕", tone: "danger", rank: 0, description: "Expected record not found. Evidence missing is not proof the event did not happen." },
  source_only: { label: CONTINUITY_STATUS_LABELS.source_only, glyph: "S", tone: "orange", rank: 1, description: "A source file mentions this period, but no native record exists yet." },
  draft_only: { label: CONTINUITY_STATUS_LABELS.draft_only, glyph: "D", tone: "yellow", rank: 2, description: "A record exists but approval (or verification) is not recorded." },
  upcoming: { label: CONTINUITY_STATUS_LABELS.upcoming, glyph: "…", tone: "info", rank: 3, description: "Not yet due." },
  cancelled: { label: CONTINUITY_STATUS_LABELS.cancelled, glyph: "C", tone: "gray", rank: 4, description: "Cancelled." },
  never_held: { label: CONTINUITY_STATUS_LABELS.never_held, glyph: "N", tone: "purple", rank: 5, description: "Marked as never held, with a reason." },
  waived: { label: CONTINUITY_STATUS_LABELS.waived, glyph: "W", tone: "blue", rank: 6, description: "Requirement waived or satisfied another way (e.g. extension, resolution in lieu)." },
  satisfied: { label: CONTINUITY_STATUS_LABELS.satisfied, glyph: "✓", tone: "success", rank: 7, description: "Native record on file." },
  not_applicable: { label: CONTINUITY_STATUS_LABELS.not_applicable, glyph: "–", tone: "neutral", rank: 8, description: "Not applicable for this period." },
};

export const STATUS_ORDER = Object.keys(STATUS_META).sort((a, b) => STATUS_META[a as ContinuityStatus].rank - STATUS_META[b as ContinuityStatus].rank) as ContinuityStatus[];

/** Worst (most actionable) status of several periods. */
export function worstStatus(statuses: ContinuityStatus[]): ContinuityStatus | undefined {
  return [...statuses].sort((a, b) => STATUS_META[a].rank - STATUS_META[b].rank)[0];
}

export const SEVERITY_LABELS: Record<string, string> = {
  statutory: "Statutory",
  bylaw: "Bylaw",
  practice: "Internal practice",
};

export const SEVERITY_TONE: Record<string, ToneVariant> = { statutory: "danger", bylaw: "warn", practice: "neutral" };

/** Where an evidence reference opens. */
export function evidenceHref(table: string, id: string): string | undefined {
  switch (table) {
    case "meetings": return `/app/meetings/${id}`;
    case "documents": return `/app/documents/${id}`;
    case "filings": return "/app/filings";
    case "financials": return "/app/financials";
    case "financialStatementImports": return "/app/financials/accounting";
    case "directors": return "/app/directors";
    case "insurancePolicies": return "/app/insurance";
    case "representationGaps": return `/app/coverage?tab=system&gap=${encodeURIComponent(id)}`;
    default: return undefined;
  }
}
