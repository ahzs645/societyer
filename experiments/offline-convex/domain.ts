import type { PortableMutationCtx } from "../../shared/portable/ctx";
import { requirePermissionPortable } from "../../shared/functions/permissions";
import { createPortable, updatePortable } from "../../shared/functions/meetings";
import { updatePortable as updateMinutes } from "../../shared/functions/minutes";
import { createPortable as createDocument } from "../../shared/functions/documents";
import { attachPortable } from "../../shared/functions/meetingMaterials";
import { validateCommand, type Mapping, type MeetingCommand } from "./src/meetingProtocol";

/** Same existing handlers on SQLite and Convex; server independently reruns them. */
export async function runMeetingCommand(ctx: PortableMutationCtx, societyId: string, command: MeetingCommand, mappings: Mapping[] = []) {
  validateCommand(command);
  await requirePermissionPortable(ctx, societyId, "meetings:write");
  await requirePermissionPortable(ctx, societyId, "minutes:write");
  if (command.kind === "create-meeting") {
    await requirePermissionPortable(ctx, societyId, "agendas:write");
    const meeting = await createPortable(ctx, { societyId, title: command.title.trim(), type: "Board", scheduledAt: command.scheduledAt,
      electronic: false, status: "Draft", attendeeIds: [], notes: command.notes,
      agendaJson: JSON.stringify([{ title: command.agendaTitle, depth: 0 }]) });
    const meetingRow = await ctx.db.get(meeting);
    const agenda = await ctx.db.query("agendas").withIndex("by_meeting", q => q.eq("meetingId", meeting)).unique();
    const item = await ctx.db.query("agendaItems").withIndex("by_agenda", q => q.eq("agendaId", agenda!._id)).unique();
    const result: Mapping[] = [
      { table: "meetings", uuid: command.keys.meeting, nativeId: meeting },
      { table: "minutes", uuid: command.keys.minutes, nativeId: String(meetingRow!.minutesId) },
      { table: "agendas", uuid: command.keys.agenda, nativeId: agenda!._id },
      { table: "agendaItems", uuid: command.keys.item, nativeId: item!._id },
    ];
    if (command.file) {
      await requirePermissionPortable(ctx, societyId, "documents:write");
      const document = await createDocument(ctx, { societyId, meetingId: meeting, title: command.file.name, category: "MeetingMaterial",
        fileName: command.file.name, mimeType: command.file.mime, tags: [], librarySection: "meeting_material" });
      const material = await attachPortable(ctx, { societyId, meetingId: meeting, documentId: document, label: command.file.name,
        accessLevel: "board", availabilityStatus: "available", syncStatus: "unavailable", requiredForMeeting: true, order: 0 });
      result.push({ table: "documents", uuid: command.keys.document, nativeId: document }, { table: "meetingMaterials", uuid: command.keys.material, nativeId: material });
    }
    return result;
  }
  const meetingId = mappings.find(row => row.table === "meetings")?.nativeId;
  const minutesId = mappings.find(row => row.table === "minutes")?.nativeId;
  if (!meetingId || !minutesId) throw new Error("PARENT_NOT_ACCEPTED: dependent work remains queued.");
  const minutes = await ctx.db.get(minutesId, "minutes");
  if (minutes?.approvedAt) throw new Error("ONLINE_ACTION_REQUIRED: adopted minutes cannot be changed by an offline command.");
  if (command.kind === "edit-meeting") await updatePortable(ctx, { id: meetingId, patch: { title: command.title.trim(), notes: command.notes } });
  else await updateMinutes(ctx, { id: minutesId, patch: { discussion: command.discussion } });
  return mappings;
}
