import { format, isThisYear, isYesterday } from "date-fns";
import { DEADLINE_ZONE } from "../lib/notice";

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
