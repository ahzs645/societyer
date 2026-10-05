/** Only explicit domain/authorization rejections are permanent. Network errors
 * and unknown server failures must leave the authoritative SDK outbox intact. */
export function permanentMeetingFailure(error: unknown): string | null {
  const message = error instanceof Error ? error.message : String(error);
  const codes = ["REVISION_CONFLICT", "REPLAY_MISMATCH", "INVALID_COMMAND", "INVALID_COMMAND_FIELDS",
    "INVALID_MEETING", "INVALID_MINUTES", "INVALID_IDENTITIES", "INVALID_FILE", "UNSUPPORTED_COMMAND_VERSION", "ONLINE_ACTION_REQUIRED"];
  const code = codes.find(value => new RegExp(`\\b${value}\\b`).test(message));
  if (code) return code;
  const structured = typeof error === "object" && error !== null && "data" in error ? (error as { data?: { code?: string } }).data : undefined;
  if (structured?.code === "OFFLINE_ACCESS_DENIED" || /\b(OFFLINE_ACCESS_DENIED|OFFLINE_MEETING_PREPARATION_DISABLED)\b/.test(message)) return "AUTHORIZATION_REJECTED";
  if (/membership not found|membership is not active|User is disabled|External identity is disabled|Permission [a-zA-Z]+:(read|write) required/.test(message)) return "AUTHORIZATION_REJECTED";
  return null;
}
