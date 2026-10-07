import { useMemo } from "react";
import { useQueries } from "convex/react";
import { isRecordNotFoundError } from "../lib/detailRecordQueries";

/**
 * `useQuery` for record detail pages.
 *
 * Returns `undefined` while loading, `null` when the record does not exist (or
 * is not visible in this workspace), and the record otherwise. Hosted Convex
 * reports a missing id as a query error ("Record not found." from the
 * authorization gate); `useQueries` hands that back as an Error value instead
 * of throwing, and this hook turns it into `null`. Any other error is rethrown
 * so the route error boundary still sees real failures. The local runtime
 * already resolves these queries to `null` (src/lib/portableQueryCache.ts).
 */
export function useRecordQuery<T = any>(query: any, args: Record<string, unknown> | "skip"): T | null | undefined {
  const argsKey = args === "skip" ? "skip" : JSON.stringify(args);
  const queries = useMemo(
    () => (args === "skip" ? {} : { record: { query, args } }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [query, argsKey],
  );
  const results = useQueries(queries as any);
  if (args === "skip") return undefined;
  const value = (results as Record<string, unknown>).record;
  if (value instanceof Error) {
    if (isRecordNotFoundError(value)) return null;
    throw value;
  }
  return value as T | null | undefined;
}
