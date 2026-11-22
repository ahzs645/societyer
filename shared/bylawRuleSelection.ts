/**
 * Which bylaw rule set governs a meeting (or "today").
 *
 * A rule version is effective from a calendar day: "Save new version" stores
 * midnight UTC of the chosen day (`2026-06-01T00:00:00.000Z`), which is a
 * date-only value, not an instant. Comparing it to a meeting's instant made a
 * June 1 rule govern a May 31 6 p.m. Pacific meeting (already June 1 in UTC)
 * while a 4 p.m. meeting the same evening kept the old rule. Selection here
 * compares calendar days instead: the rule's effective day against the
 * meeting's local day in its own time zone, else the organization's.
 *
 * Pure selection plus one `ctx.db` loader shared by every portable handler
 * (meetings, minutes, bylaw rules).
 */
import { contextualBylawRules } from "./bylawBaselines";
import { meetingCalendarDate, type MeetingDateLike } from "./meetingDates";
import { organizationTimeZone } from "./organizationDomain";
import type { PortableDoc, PortableMutationCtx, PortableQueryCtx } from "./portable/ctx";
import { wallClockInZone } from "./timeZones";

type RuleSetRow = { status?: string; effectiveFromISO?: string; version?: number };

const DATE_ONLY_VALUE = /^(\d{4}-\d{2}-\d{2})(?:T00:00(?::00(?:\.000)?)?Z)?$/;

/**
 * The calendar day a rule version takes effect. A day (or midnight UTC of a
 * day) is that day; a click instant ("Reset to defaults") is the day it fell
 * on in `timeZone`. Undefined when there is no usable value (always eligible).
 */
export function bylawRuleEffectiveDay(effectiveFromISO: unknown, timeZone?: string): string | undefined {
  if (typeof effectiveFromISO !== "string" || !effectiveFromISO) return undefined;
  const day = DATE_ONLY_VALUE.exec(effectiveFromISO)?.[1];
  if (day) return day;
  const at = new Date(effectiveFromISO).getTime();
  if (!Number.isFinite(at)) return undefined;
  try {
    return wallClockInZone(at, timeZone).date;
  } catch {
    return effectiveFromISO.slice(0, 10);
  }
}

/**
 * The local calendar day a bylaw rule is selected for: a meeting (its own
 * zone, else `timeZone`) or a bare ISO value (a date-only placeholder keeps its
 * day). Undefined when the value is unparseable: every version is eligible.
 */
export function bylawRuleSelectionDay(at: MeetingDateLike | string, timeZone?: string): string | undefined {
  const meeting = typeof at === "string" ? { scheduledAt: at } : at;
  const day = meetingCalendarDate(meeting, timeZone);
  return day && /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : undefined;
}

/**
 * The non-draft rule version in force on `day`: the latest effective day on
 * or before it, and the highest version among versions effective the same day.
 */
export function selectBylawRuleSetForDay<Row extends object>(rows: readonly Row[], day: string | undefined, timeZone?: string): Row | undefined {
  let best: { row: Row; day: string; version: number } | undefined;
  for (const row of rows) {
    const { status, effectiveFromISO, version } = row as RuleSetRow;
    if (status === "Draft") continue;
    const effective = bylawRuleEffectiveDay(effectiveFromISO, timeZone) ?? "";
    if (day && effective > day) continue;
    const rank = Number(version) || 0;
    if (!best || effective > best.day || (effective === best.day && rank > best.version)) {
      best = { row, day: effective, version: rank };
    }
  }
  return best?.row;
}

/** The rule set governing `at` (a meeting or an ISO value), with the organization's baseline context. */
export async function bylawRuleSetForDate(
  ctx: PortableQueryCtx | PortableMutationCtx,
  societyId: string,
  at: MeetingDateLike | string,
): Promise<Partial<PortableDoc> & { isFallback?: boolean }> {
  const rows = await ctx.db
    .query("bylawRuleSets")
    .withIndex("by_society", (q) => q.eq("societyId", societyId))
    .collect();
  const organization = await ctx.db.get(societyId);
  const timeZone = organizationTimeZone(organization);
  const selected = selectBylawRuleSetForDay(rows, bylawRuleSelectionDay(at, timeZone), timeZone);
  return contextualBylawRules(organization, societyId, selected);
}
