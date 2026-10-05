export type MinutesQuorumStatus = "confirmed" | "not_met" | "not_recorded";

export function recordedMinutesQuorum(minutes: { quorumStatus?: string | null; quorumMet?: boolean | null }): boolean | null {
  if (minutes.quorumStatus === "not_recorded") return null;
  if (minutes.quorumStatus === "confirmed") return true;
  if (minutes.quorumStatus === "not_met") return false;
  return minutes.quorumMet === true;
}

export function minutesQuorumLabel(minutes: { quorumStatus?: string | null; quorumMet?: boolean | null }): string {
  const value = recordedMinutesQuorum(minutes);
  return value === null ? "Not recorded in source" : value ? "Met" : "Not met";
}
