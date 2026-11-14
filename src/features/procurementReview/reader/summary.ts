import { format, isThisYear, isToday, isYesterday } from "date-fns";
import { DEADLINE_ZONE } from "../lib/notice";

/** "today, 10:02 AM", "yesterday, 10:02 AM", "Oct 18, 10:02 AM", or "Oct 18, 2025" in another year. */
function publishedWhen(published: Date): string {
  if (isToday(published)) return `today, ${format(published, "h:mm a")}`;
  if (isYesterday(published)) return `yesterday, ${format(published, "h:mm a")}`;
  return format(published, isThisYear(published) ? "MMM d, h:mm a" : "MMM d, yyyy");
}

/**
 * The line under the page title: "Updated today, 10:02 AM". The tabs under it
 * count the opportunities and awards, so it doesn't repeat them. It adds
 * "read only" only for someone who can't record a triage here; where the
 * triage is editable (hosted readers with the permission, the demo's
 * browser-kept one) the page isn't read only, so it doesn't say so.
 */
export function updatedSummary(publishedAt: string, { readOnly = false }: { readOnly?: boolean } = {}): string {
  const published = new Date(publishedAt);
  const updated = Number.isNaN(published.getTime()) ? "" : `Updated ${publishedWhen(published)}`;
  return [updated, readOnly ? (updated ? "read only" : "Read only") : ""].filter(Boolean).join(" · ");
}

/** "2 hours ago", "yesterday", "Nov 12": how long ago the catalog in service was put there, for the status line. */
export function sinceWhen(value: string | number | null | undefined, now = Date.now()): string {
  if (!value) return "";
  const at = new Date(value);
  if (Number.isNaN(at.getTime())) return "";
  const minutes = Math.round((now - at.getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 24 * 60) return `${Math.round(minutes / 60)} h ago`;
  if (isYesterday(at)) return "yesterday";
  return format(at, isThisYear(at) ? "MMM d" : "MMM d, yyyy");
}

const exact = new Intl.DateTimeFormat("en-US", { timeZone: DEADLINE_ZONE, month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });

/** "Nov 10, 2026, 9:44 AM" in the source zone, or "Not recorded". */
export function exactWhen(value: string | number | null | undefined): string {
  if (!value) return "Not recorded";
  const at = new Date(value);
  return Number.isNaN(at.getTime()) ? "Not recorded" : exact.format(at);
}
