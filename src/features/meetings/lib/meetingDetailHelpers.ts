import { formatDateTime } from "../../../lib/format";

export type MeetingAgendaItemEntry = { title: string; depth: 0 | 1 };

export function slugifyFilePart(value: string) {
  return (value || "item").replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase() || "item";
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
  motionBacklogId?: any;
  motionText?: string;
}> | null {
  if (!record?.items?.length) return null;
  const entries: Array<MeetingAgendaItemEntry & {
    type?: string;
    presenter?: string;
    details?: string;
    timeAllottedMinutes?: number;
    motionTemplateId?: any;
    motionBacklogId?: any;
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
      motionBacklogId: item.motionBacklogId,
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
