/**
 * Detail-route queries whose "record does not exist" outcome is `null`.
 *
 * The authorization gate rejects a request that references a missing id
 * ("Record not found.") before the handler runs, and ownership helpers throw
 * "<table> not found.". For these detail queries the page needs to render a
 * not-found state rather than wait forever, so both runtimes map that rejection
 * to `null`: the local query cache (src/lib/portableQueryCache.ts) and the
 * hosted `useRecordQuery` hook (src/hooks/useRecordQuery.ts). Background and
 * list queries keep their existing undefined-on-failure behaviour.
 */
export const DETAIL_RECORD_QUERIES: ReadonlySet<string> = new Set([
  "grants:get",
  "assets:get",
  "assets:bundle",
  "documents:get",
  "workflows:get",
  "waveCache:resource",
  "personHistory:profile",
  // FF-2: meeting, committee, goal and election detail routes.
  "meetings:get",
  "committees:detail",
  "goals:get",
  "elections:get",
  // A8: the acting user lookup; a stale stored id means "no current user".
  "users:get",
]);

export function isRecordNotFoundError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (/membership not found/i.test(message)) return false;
  return /\b(Record|[A-Za-z]+) not found\b/.test(message);
}
