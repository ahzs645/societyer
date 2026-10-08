const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * "2026-04-10" (or an ISO timestamp) → "Apr 10, 2026" for server-written
 * sentences shown to people. Reads the calendar date as written, so it never
 * shifts by time zone; anything unparseable is returned unchanged.
 */
export function humanDate(value: string | null | undefined): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value ?? ""));
  if (!match) return String(value ?? "");
  const month = MONTHS[Number(match[2]) - 1];
  return month ? `${month} ${Number(match[3])}, ${match[1]}` : String(value);
}

/** 1 → "1 report", 3 → "3 reports". */
export function countLabel(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}
