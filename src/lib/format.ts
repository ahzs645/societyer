import { format, formatDistanceToNowStrict, parseISO, isValid } from "date-fns";

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

export function formatDateTime(value?: DateInput) {
  return formatDate(value, "MMM d, yyyy · h:mma");
}

export function relative(value?: DateInput) {
  const d = parseDateInput(value);
  if (!d) return "—";
  if (!isValid(d)) return "—";
  const diff = d.getTime() - Date.now();
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

export function initials(first?: string, last?: string) {
  return `${(first || "?")[0]}${(last || "")[0] || ""}`.toUpperCase();
}
