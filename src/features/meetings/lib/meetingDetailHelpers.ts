import { formatDateTime } from "../../../lib/format";
import { minutesMotionsForDisplay } from "../../../../shared/minutesMotions";
import { motionCompletionGaps } from "../../../lib/motionGovernance";

export type MeetingAgendaItemEntry = { title: string; depth: 0 | 1 };

export function normalizedMeetingTitle(value: unknown): string {
  return String(value ?? "").trim();
}

export function quorumPresentCount(minutes: any): number {
  const detailed = Array.isArray(minutes?.detailedAttendance) ? minutes.detailedAttendance : [];
  if (detailed.length) {
    return detailed.filter(
      (row: any) => row?.status === "present" && row?.quorumCounted !== false,
    ).length;
  }
  return Array.isArray(minutes?.attendees) ? minutes.attendees.length : 0;
}

export function computedQuorumMet({
  presentCount,
  activeProxyCount = 0,
  required,
}: {
  presentCount: number;
  activeProxyCount?: number;
  required?: number | null;
}): boolean | null {
  if (required == null || !Number.isFinite(required)) return null;
  return presentCount + activeProxyCount >= required;
}

export function slugifyFilePart(value: string) {
  return (value || "item").replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase() || "item";
}

/**
 * A minutes record exists for every meeting (auto-created on `meetings.create`),
 * so its mere presence doesn't mean the user has drafted anything. This returns
 * true only when the record has user-authored content — discussion text, real
 * decisions/action items, section content, or an approval timestamp. Used by
 * the Draft Minutes picker (hide started drafts) and the picker's auto-draft
 * handoff (don't clobber existing work).
 *
 * Top-level `motions` presence alone is intentionally not checked: meeting
 * templates can pre-populate motions, so a non-empty `motions` array doesn't
 * always mean the user has started drafting. But a motion carrying recorded
 * state — an outcome, a vote tally, or a mover/seconder — is user work and
 * must count, or a re-draft could silently wipe recorded votes.
 */
export function hasStartedMinutesDraft(record: any): boolean {
  if (!record) return false;
  if (record.approvedAt) return true;
  if (String(record.discussion ?? "").trim().length > 0) return true;
  if ((record.decisions?.length ?? 0) > 0) return true;
  if ((record.actionItems?.length ?? 0) > 0) return true;
  for (const section of record.sections ?? []) {
    if (String(section.discussion ?? "").trim().length > 0) return true;
    if ((section.decisions?.length ?? 0) > 0) return true;
    if ((section.actionItems?.length ?? 0) > 0) return true;
    if (String(section.motionText ?? "").trim().length > 0) return true;
  }
  for (const motion of minutesMotionsForDisplay(record) as any[]) {
    const outcome = String(motion?.outcome ?? "").trim().toLowerCase();
    if (outcome && outcome !== "pending") return true;
    if (motion?.votesFor != null || motion?.votesAgainst != null || motion?.abstentions != null) return true;
    if (motion?.movedBy || motion?.secondedBy) return true;
    if (motion?.movedByMemberId || motion?.movedByDirectorId) return true;
    if (motion?.secondedByMemberId || motion?.secondedByDirectorId) return true;
  }
  return false;
}

/** A scaffolded minutes row is not a recorded set of minutes. The checklist
 * becomes complete only after the meeting is held and the record has actual
 * authored content (or has been approved). */
export function hasRecordedMeetingMinutes(meeting: any, record: any, motions?: any[]): boolean {
  const resolvedRecord = record && motions ? { ...record, displayMotions: motions } : record;
  return meeting?.status === "Held" && hasStartedMinutesDraft(resolvedRecord);
}

/** Hard blockers for final Word/PDF/print output. Preview stays available so a
 * recorder can inspect layout while resolving these governance gaps. */
export function formalMinutesExportBlockers({
  meeting,
  minutes,
  agendaItemCount,
  motions,
}: {
  meeting: any;
  minutes: any;
  agendaItemCount: number;
  motions: any[];
}): string[] {
  const blockers: string[] = [];
  if (meeting?.status !== "Held") blockers.push("Mark the meeting held.");
  if (!minutes) return [...blockers, "Create or record the minutes."];
  if ((minutes.attendees?.length ?? 0) === 0) blockers.push("Record at least one attendee present.");
  if (agendaItemCount === 0 && (minutes.sections?.length ?? 0) === 0) {
    blockers.push("Record an agenda or minutes section.");
  }
  if (![minutes.chairName, minutes.secretaryName, minutes.recorderName].some((value) => String(value ?? "").trim())) {
    blockers.push("Record a chair, secretary, or minute-taker.");
  }
  motions.forEach((motion, index) => {
    const gaps = motionCompletionGaps(motion);
    if (!gaps.length) return;
    const label = String(motion.name || motion.text || `Motion ${index + 1}`).trim();
    blockers.push(`Complete ${label}: ${gaps.join(", ")}.`);
  });
  return blockers;
}

export function isCurrentDirector(director: any) {
  const status = String(director?.status ?? "").toLowerCase();
  if (status && !["active", "current", "verified"].includes(status)) return false;
  const end = director?.termEnd || director?.resignedAt;
  return !end || String(end).slice(0, 10) >= new Date().toISOString().slice(0, 10);
}

export function attendanceRowsForDirectors(directors: any[]) {
  return directors
    .map((director) => ({
      name: `${director.firstName ?? ""} ${director.lastName ?? ""}`.trim(),
      status: "present" as const,
    }))
    .filter((person) => person.name);
}

export function buildMeetingOutboxEmail({
  societyName,
  meeting,
  joinDetails,
  materials,
  packageReviewStatus,
  packageReviewBlockers,
}: {
  societyName: string;
  meeting: any;
  joinDetails: any;
  materials: Array<{ label: string; agendaLabel: string; fileName: string | null; paperlessUrl: string | null }>;
  packageReviewStatus: string;
  packageReviewBlockers: string[];
}) {
  const lines = [
    `Hello,`,
    ``,
    `Please find the meeting package for ${meeting.title}.`,
    ``,
    `Society: ${societyName}`,
    `When: ${formatDateTime(meeting.scheduledAt)}`,
    `Location: ${meeting.location ?? "Not recorded"}`,
    joinDetails.url ? `Join link: ${joinDetails.url}` : "",
    joinDetails.meetingId ? `Meeting ID: ${joinDetails.meetingId}` : "",
    joinDetails.passcode ? `Passcode: ${joinDetails.passcode}` : "",
    joinDetails.instructions ? `Instructions: ${joinDetails.instructions}` : "",
    ``,
    `Package status: ${packageReviewStatus}`,
    packageReviewBlockers.length ? `Review blockers: ${packageReviewBlockers.join("; ")}` : "",
    ``,
    `Attachments / references:`,
    ...(materials.length
      ? materials.map((material, index) =>
          `${index + 1}. ${material.label} (${material.agendaLabel})${material.fileName ? ` - ${material.fileName}` : ""}${material.paperlessUrl ? ` - ${material.paperlessUrl}` : ""}`,
        )
      : ["No linked materials are recorded."]),
    ``,
    `The ZIP also includes a meeting-pack HTML file, agenda text, and an attachment manifest for manual upload/send workflows.`,
    ``,
    `Regards,`,
  ];
  return lines.filter((line, index, array) => line || array[index - 1] !== "").join("\n");
}

export function sanitizeAttachmentFileName(value: string, fallback: string) {
  const clean = value.replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ").trim();
  return clean || fallback;
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.slice(i, i + chunkSize));
  }
  return btoa(binary).replace(/.{1,76}/g, "$&\r\n").trim();
}

export function agendaEntriesFromRecord(record: any): MeetingAgendaItemEntry[] | null {
  const items = agendaItemsFromRecord(record);
  return items?.map((item) => ({ title: item.title, depth: item.depth })) ?? null;
}

export function agendaItemsFromRecord(record: any): Array<MeetingAgendaItemEntry & {
  type?: string;
  presenter?: string;
  details?: string;
  timeAllottedMinutes?: number;
  motionTemplateId?: any;
  motionId?: any;
  motionText?: string;
}> | null {
  if (!record?.items?.length) return null;
  const entries: Array<MeetingAgendaItemEntry & {
    type?: string;
    presenter?: string;
    details?: string;
    timeAllottedMinutes?: number;
    motionTemplateId?: any;
    motionId?: any;
    motionText?: string;
  }> = [];
  let hasRoot = false;
  for (const item of record.items) {
    const title = String(item?.title ?? "").trim();
    if (!title) continue;
    const depth: 0 | 1 = item?.depth === 1 && hasRoot ? 1 : 0;
    entries.push({
      title,
      depth,
      type: item.type,
      presenter: item.presenter,
      details: item.details,
      timeAllottedMinutes: item.timeAllottedMinutes,
      motionTemplateId: item.motionTemplateId,
      motionId: item.motionId,
      motionText: item.motionText,
    });
    if (depth === 0) hasRoot = true;
  }
  return entries.length ? entries : null;
}

export function buildEmlMessage({
  subject,
  body,
  attachments,
}: {
  subject: string;
  body: string;
  attachments: Array<{ fileName: string; mimeType: string; bytes: Uint8Array }>;
}) {
  const boundary = `societyer-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const safeSubject = subject.replace(/\r?\n/g, " ");
  const parts = [
    `Subject: ${safeSubject}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    body,
    "",
    ...attachments.flatMap((attachment) => [
      `--${boundary}`,
      `Content-Type: ${attachment.mimeType || "application/octet-stream"}; name="${attachment.fileName.replace(/"/g, "'")}"`,
      "Content-Transfer-Encoding: base64",
      `Content-Disposition: attachment; filename="${attachment.fileName.replace(/"/g, "'")}"`,
      "",
      bytesToBase64(attachment.bytes),
      "",
    ]),
    `--${boundary}--`,
    "",
  ];
  return parts.join("\r\n");
}
