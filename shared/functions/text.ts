/**
 * Small text-normalization helpers shared by portable handlers. Mirrors the
 * `cleanText`/`cleanList` helpers used throughout the Convex handlers so a ported
 * function normalizes identically on every runtime.
 */

export function cleanText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

export function cleanList(values?: (string | undefined)[]): string[] {
  return Array.from(new Set((values ?? []).map((value) => cleanText(value)).filter(Boolean))) as string[];
}
