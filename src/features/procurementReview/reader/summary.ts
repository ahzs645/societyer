import { format, isThisYear, isToday, isYesterday } from "date-fns";
import { DEADLINE_ZONE } from "../lib/notice";

/** "today, 10:02 AM", "yesterday, 10:02 AM", "Oct 18, 10:02 AM", or "Oct 18, 2025" in another year. */
function publishedWhen(published: Date): string {
  if (isToday(published)) return `today, ${format(published, "h:mm a")}`;
  if (isYesterday(published)) return `yesterday, ${format(published, "h:mm a")}`;
  return format(published, isThisYear(published) ? "MMM d, h:mm a" : "MMM d, yyyy");
}

/**
 * The line under the page title: "Updated today, 10:02 AM · read only". The
 * tabs under it count the opportunities and awards, so it doesn't repeat them.
 */
export function updatedSummary(publishedAt: string): string {
  const published = new Date(publishedAt);
  return Number.isNaN(published.getTime()) ? "Read only" : `Updated ${publishedWhen(published)} · read only`;
}

const exact = new Intl.DateTimeFormat("en-US", { timeZone: DEADLINE_ZONE, month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });

/** "Nov 10, 2026, 9:44 AM" in the source zone, or "Not recorded". */
export function exactWhen(value: string | number | null | undefined): string {
  if (!value) return "Not recorded";
  const at = new Date(value);
  return Number.isNaN(at.getTime()) ? "Not recorded" : exact.format(at);
}
