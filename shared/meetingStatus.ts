import { todayDateOnly } from "./dateOnly";

/**
 * Meeting status vocabulary. `meetings.status` is a free string in the schema;
 * these are the values the app writes. Additive: "HeldMinutesMissing" marks a
 * meeting that is evidenced (agenda, notice, attendance, a later "adopt the
 * minutes of …" reference) but whose minutes are not on file, and "Cancelled"
 * a meeting that did not take place. "Draft" is used by imports for meetings
 * known only from draft source records.
 */
export const MEETING_STATUSES = ["Scheduled", "Held", "HeldMinutesMissing", "Cancelled"] as const;
export type MeetingStatus = (typeof MEETING_STATUSES)[number];

export const MEETING_STATUS_LABELS: Record<string, string> = {
  Scheduled: "Scheduled",
  Held: "Held",
  HeldMinutesMissing: "Held — minutes missing",
  Cancelled: "Cancelled",
  Draft: "Draft (source)",
};

export const MEETING_STATUS_OPTIONS = MEETING_STATUSES.map((value) => ({ value, label: MEETING_STATUS_LABELS[value] }));

export function meetingStatusLabel(status: string | undefined | null): string {
  if (!status) return "Unknown";
  return MEETING_STATUS_LABELS[status] ?? status;
}

/**
 * A meeting evidenced only by its agenda, package or script: the agenda shows
 * the meeting was called, not that it was held or what was decided. Once its
 * date has passed it is "Held — minutes missing"; until then it is Scheduled.
 */
export function agendaOnlyMeetingStatus(meetingDate: string | undefined | null, today: string = todayDateOnly()): "HeldMinutesMissing" | "Scheduled" {
  const day = String(meetingDate ?? "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(day) && day < today ? "HeldMinutesMissing" : "Scheduled";
}

/** A meeting that took place (whether or not its minutes are on file). */
export function isMeetingHeld(status: string | undefined | null): boolean {
  return status === "Held" || status === "HeldMinutesMissing";
}

export function meetingStatusTone(status: string | undefined | null): "success" | "warn" | "danger" | "neutral" | "info" {
  if (status === "Held") return "success";
  if (status === "HeldMinutesMissing") return "warn";
  if (status === "Cancelled") return "danger";
  if (status === "Scheduled") return "info";
  return "neutral";
}
