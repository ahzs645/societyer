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

type QuorumRecord = { quorumMet?: unknown; quorumStatus?: unknown } | null | undefined;

/** Preserve unknown import evidence while retaining the required legacy boolean. */
export function normalizeMeetingQuorum(record: QuorumRecord): { quorumMet: boolean; quorumStatus: MinutesQuorumStatus } {
  const raw = record?.quorumMet;
  const boolean = typeof raw === "boolean" ? raw
    : raw === "true" ? true : raw === "false" ? false : undefined;
  if (raw !== undefined && raw !== null && boolean === undefined) throw new Error("quorumMet must be true, false, or omitted when not recorded");
  const status = record?.quorumStatus;
  if (status !== undefined && !["confirmed", "not_met", "not_recorded"].includes(String(status))) throw new Error("Invalid quorumStatus");
  if ((status === "confirmed" && boolean === false) || (status === "not_met" && boolean === true)
    || (status === "not_recorded" && boolean === true)) throw new Error("quorumStatus contradicts quorumMet");
  const quorumStatus = status as MinutesQuorumStatus | undefined ?? (boolean === true ? "confirmed" : boolean === false ? "not_met" : "not_recorded");
  return { quorumMet: quorumStatus === "confirmed", quorumStatus };
}
