/** Native datetime-local inputs use the browser timezone. Preserve an unchanged
 * stored instant, including seconds and the later side of a DST overlap. */
export function payrollLocalTimestamp(value?: string): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? new Date(date.getTime() - date.getTimezoneOffset() * 60000)
        .toISOString()
        .slice(0, 23)
    : undefined;
}
export function payrollTimestampFromLocal(
  value: string,
  original?: string,
): string {
  const parts =
    /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/.exec(
      value,
    );
  if (!parts)
    throw new Error("Enter a valid local date and time for final pay.");
  const normalized = `${parts[1]}:${parts[2] ?? "00"}.${(parts[3] ?? "").padEnd(3, "0")}`;
  if (original && payrollLocalTimestamp(original) === normalized)
    return original;
  const date = new Date(value);
  if (
    !Number.isFinite(date.getTime()) ||
    payrollLocalTimestamp(date.toISOString()) !== normalized
  )
    throw new Error(
      "This local time does not exist in the browser timezone. Choose an actual time and review its timezone.",
    );
  return date.toISOString();
}
