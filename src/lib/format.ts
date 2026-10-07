import { format, formatDistanceToNowStrict, parseISO, isValid } from "date-fns";
import { isDateOnly, relativeDateOnly } from "../../shared/dateOnly";

export { isPastDue, todayDateOnly, daysUntilDate, relativeDateOnly, toDateOnly } from "../../shared/dateOnly";

type DateInput = string | number | Date | null | undefined;

function parseDateInput(value: DateInput) {
  if (value == null || value === "") return null;
  if (value instanceof Date) return value;
  if (typeof value === "number") return new Date(value);
  return value.length === 10 ? parseISO(value) : new Date(value);
}

export function formatDate(value?: DateInput, pattern = "MMM d, yyyy") {
  const d = parseDateInput(value);
  if (!d) return "—";
  if (!isValid(d)) return "—";
  return format(d, pattern);
}

/**
 * Action/task due dates are free text: an ISO calendar day ("2026-10-20") is
 * shown with the app's date format, anything else ("next meeting", "ASAP",
 * "end of June") is kept exactly as written (MA-7).
 */
export function formatDueDate(value?: string | null, pattern = "MMM d, yyyy") {
  const text = String(value ?? "").trim();
  if (!text) return "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const d = parseISO(text);
  return isValid(d) ? format(d, pattern) : text;
}

export function formatDateTime(value?: DateInput) {
  return formatDate(value, "MMM d, yyyy · h:mma");
}

export function relative(value?: DateInput) {
  // A date-only value is a calendar day: "today"/"in 2 days", never "19 hours ago".
  if (isDateOnly(value)) return relativeDateOnly(value);
  const d = parseDateInput(value);
  if (!d) return "—";
  if (!isValid(d)) return "—";
  const diff = d.getTime() - Date.now();
  if (Math.abs(diff) < 45_000) return "just now";
  const suffix = diff >= 0 ? "from now" : "ago";
  return `${formatDistanceToNowStrict(d)} ${suffix}`;
}

export function money(cents?: number) {
  if (cents == null) return "—";
  const hasCents = Math.abs(cents) % 100 !== 0;
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency: "CAD",
    minimumFractionDigits: hasCents ? 2 : 0,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

export function centsToDollarInput(cents?: number | null) {
  if (cents == null) return "";
  return (cents / 100).toFixed(2);
}

export function dollarInputToCents(value: string | number | undefined | null) {
  if (value == null || value === "") return undefined;
  const amount = typeof value === "number" ? value : Number(String(value).replace(/[$,\s]/g, ""));
  if (!Number.isFinite(amount)) return undefined;
  return Math.round(amount * 100);
}

/** "1 record", "3 records", "1 policy" → `pluralize(n, "policy", "policies")`. Numbers use the en-CA grouping. */
export function pluralize(count: number, singular: string, plural = `${singular}s`) {
  return `${new Intl.NumberFormat("en-CA").format(count)} ${Math.abs(count) === 1 ? singular : plural}`;
}

export function initials(first?: string, last?: string) {
  return `${(first || "?")[0]}${(last || "")[0] || ""}`.toUpperCase();
}

/** Format a Date as a `<input type="datetime-local">` value (local time). */
export function toDateTimeLocalValue(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}
