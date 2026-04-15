import { format, formatDistanceToNowStrict, parseISO, isValid } from "date-fns";

export function formatDate(iso?: string | null, pattern = "MMM d, yyyy") {
  if (!iso) return "—";
  const d = iso.length === 10 ? parseISO(iso) : new Date(iso);
  if (!isValid(d)) return "—";
  return format(d, pattern);
}

export function formatDateTime(iso?: string | null) {
  return formatDate(iso, "MMM d, yyyy · h:mma");
}

export function relative(iso?: string | null) {
  if (!iso) return "—";
  const d = iso.length === 10 ? parseISO(iso) : new Date(iso);
  if (!isValid(d)) return "—";
  const diff = d.getTime() - Date.now();
  const suffix = diff >= 0 ? "from now" : "ago";
  return `${formatDistanceToNowStrict(d)} ${suffix}`;
}

export function money(cents?: number) {
  if (cents == null) return "—";
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency: "CAD",
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

export function initials(first?: string, last?: string) {
  return `${(first || "?")[0]}${(last || "")[0] || ""}`.toUpperCase();
}
