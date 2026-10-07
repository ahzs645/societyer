import { v } from "convex/values";

/**
 * Validators shared by the gap-identification tables (representation gaps,
 * governance expectations, continuity period marks) and committee cadence.
 *
 * Enumerated values are stored as strings and validated by the portable
 * handlers in `shared/gaps.ts`, so older backups and offline rows that carry a
 * value added later still restore. See docs/implementation-notes/wp-c-gaps.md.
 */

/** Where in a source a detail was observed. Every part is optional. */
export const gapLocatorValidator = v.object({
  page: v.optional(v.string()),
  section: v.optional(v.string()),
  sheet: v.optional(v.string()),
  cellRange: v.optional(v.string()),
  lineRange: v.optional(v.string()),
  blockIndex: v.optional(v.number()),
  charStart: v.optional(v.number()),
  charEnd: v.optional(v.number()),
  path: v.optional(v.string()),
  sha256: v.optional(v.string()),
});

/** One triage step on a representation gap. */
export const gapReviewEventValidator = v.object({
  atISO: v.string(),
  actorUserId: v.optional(v.string()),
  actorName: v.optional(v.string()),
  fromStatus: v.optional(v.string()),
  toStatus: v.string(),
  note: v.optional(v.string()),
});

/**
 * A structured recurrence rule. `frequency`:
 * - `calendar_year`: once in each calendar year
 * - `annual`: once every 12 months (treated as calendar years for continuity)
 * - `monthly`: each month (optionally only `months`)
 * - `quarterly`: each calendar quarter
 * - `per_year_count`: `count` times per calendar year (optionally in `months`)
 * - `after_event`: within `offsetDays` after the anchor event (`anchor`)
 * - `continuous`: continuously in force (terms, coverage) checked per year
 * - `ad_hoc`: no expectation (documentation only)
 */
export const cadenceRuleValidator = v.object({
  frequency: v.string(),
  count: v.optional(v.number()),
  months: v.optional(v.array(v.number())),
  anchor: v.optional(v.string()),
  offsetDays: v.optional(v.number()),
  minimumCount: v.optional(v.number()),
  seriesKey: v.optional(v.string()),
  notes: v.optional(v.string()),
});

/** An effective-dated committee mandate / terms of reference version. */
export const committeeMandateVersionValidator = v.object({
  id: v.string(),
  effectiveFrom: v.string(),
  effectiveTo: v.optional(v.string()),
  title: v.optional(v.string()),
  mandate: v.optional(v.string()),
  documentId: v.optional(v.id("documents")),
  cadenceRule: v.optional(cadenceRuleValidator),
  quorumText: v.optional(v.string()),
  notes: v.optional(v.string()),
});
