/**
 * Light per-meeting minutes summaries for list pages (ui-meetings F26).
 *
 * `minutes:list` returns every minutes row with its full source record (the
 * PGAIR workspace carries ~38 MB of minutes, mostly embedded source text) and
 * resolves each row's motions. List rows only need counts and review state,
 * so this query returns a few scalars per minutes record instead.
 */
import type { PortableQueryCtx } from "../portable/ctx";
import { requireSocietyMembership } from "./access";
import { actionItemStatus } from "../actionItemStatus";
import { minutesPresentCount } from "../meetingAttendanceGrid";

export type MinutesSummary = {
  _id: string;
  meetingId: string;
  heldAt?: string;
  approvedAt?: string;
  approvedInMeetingId?: string;
  sourceReviewStatus?: string;
  started: boolean;
  attendeeCount: number;
  presentCount: number;
  absentCount: number;
  motionCount: number;
  sectionCount: number;
  actionItemCount: number;
  openActionItemCount: number;
  quorumStatus?: string;
  chairName?: string;
  hasSourceRecord: boolean;
  sourceVersionCount: number;
  sourceExternalIdCount: number;
  /** Names in attendance and officer fields, for list search (F24). */
  peopleText: string;
  /** Action observations (small; needed by the carry-forward picker). */
  actionObservations?: any[];
};

function actionItemsOf(minutes: any): any[] {
  return [
    ...(Array.isArray(minutes?.actionItems) ? minutes.actionItems : []),
    ...((Array.isArray(minutes?.sections) ? minutes.sections : []) as any[]).flatMap((section) => (Array.isArray(section?.actionItems) ? section.actionItems : [])),
  ].filter((item) => String(item?.text ?? "").trim());
}

export function summarizeMinutes(minutes: any): MinutesSummary {
  const sections: any[] = Array.isArray(minutes?.sections) ? minutes.sections : [];
  const motionCount = Array.isArray(minutes?.motionSnapshots)
    ? minutes.motionSnapshots.length
    : Array.isArray(minutes?.motionIds)
      ? minutes.motionIds.length
      : Array.isArray(minutes?.motions) ? minutes.motions.length : 0;
  const actions = actionItemsOf(minutes);
  const open = actions.filter((item) => !["completed", "cancelled"].includes(actionItemStatus(item))).length;
  const started = Boolean(
    minutes?.approvedAt
    || String(minutes?.discussion ?? "").trim()
    || (minutes?.decisions?.length ?? 0) > 0
    || actions.length > 0
    || motionCount > 0
    || sections.some((section) => String(section?.discussion ?? "").trim() || (section?.decisions?.length ?? 0) > 0 || String(section?.motionText ?? "").trim()),
  );
  return {
    _id: String(minutes._id),
    meetingId: String(minutes.meetingId),
    heldAt: minutes.heldAt,
    approvedAt: minutes.approvedAt,
    approvedInMeetingId: minutes.approvedInMeetingId ? String(minutes.approvedInMeetingId) : undefined,
    sourceReviewStatus: minutes.sourceReviewStatus,
    started,
    attendeeCount: Array.isArray(minutes.attendees) ? minutes.attendees.length : 0,
    presentCount: minutesPresentCount(minutes),
    absentCount: Array.isArray(minutes.absent) ? minutes.absent.length : 0,
    motionCount,
    sectionCount: sections.length,
    actionItemCount: actions.length,
    openActionItemCount: open,
    quorumStatus: minutes.quorumStatus,
    chairName: minutes.chairName,
    hasSourceRecord: !!minutes.sourceMeetingRecord,
    sourceVersionCount: Array.isArray(minutes.importedSourceVersions) ? minutes.importedSourceVersions.length : 0,
    sourceExternalIdCount: Array.isArray(minutes.sourceExternalIds) ? minutes.sourceExternalIds.length : 0,
    peopleText: [
      ...(Array.isArray(minutes.attendees) ? minutes.attendees : []),
      ...(Array.isArray(minutes.absent) ? minutes.absent : []),
      minutes.chairName,
      minutes.secretaryName,
      minutes.recorderName,
    ].filter(Boolean).join(" · ").slice(0, 4000),
    ...(Array.isArray(minutes.actionObservations) && minutes.actionObservations.length ? { actionObservations: minutes.actionObservations } : {}),
  };
}

export async function listSummariesPortable(ctx: PortableQueryCtx, { societyId }: { societyId: string }): Promise<MinutesSummary[]> {
  await requireSocietyMembership(ctx, societyId);
  const rows = await ctx.db
    .query("minutes")
    .withIndex("by_society", (q) => q.eq("societyId", societyId))
    .collect();
  return rows.map(summarizeMinutes);
}
