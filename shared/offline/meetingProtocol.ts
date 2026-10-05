/** Versioned domain commands, never arbitrary portable-row patches. */
export type MeetingKeys = { meeting: string; minutes: string; agenda: string; item: string; document: string; material: string };
export type FileDescriptor = { name: string; mime: string; size: number; sha256: string };
export type MeetingCommand = {
  version: number; operationId: string; meetingUuid: string; baseRevision: number;
} & (
  | { kind: "create-meeting"; keys: MeetingKeys; title: string; scheduledAt: string; notes: string; agendaTitle: string; file?: FileDescriptor }
  | { kind: "edit-meeting"; title: string; notes: string }
  | { kind: "edit-minutes"; discussion: string }
);
export type Mapping = { table: string; uuid: string; nativeId: string };
export type MeetingResult = { accepted: true; revision: number; mappings: Mapping[]; replay: boolean };
export type Download = { uuid: string; society_id: string; actor_key: string; meeting_uuid: string; revision: number; payload: string };
export type Snapshot = {
  meetingUuid: string; revision: number; title: string; scheduledAt: string; notes: string;
  ids: { minutes: string; agenda: string; items: string[] }; editable: boolean;
  discussion: string; agenda: string[];
  files: { uuid: string; name: string; sha256: string; size: number; available: boolean }[];
};
export const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function validateCommand(command: MeetingCommand) {
  if (command.version !== 1) throw new Error("UNSUPPORTED_COMMAND_VERSION: export pending work for recovery.");
  if (!uuidPattern.test(command.operationId) || !uuidPattern.test(command.meetingUuid) || !Number.isSafeInteger(command.baseRevision) || command.baseRevision < 0) throw new Error("INVALID_COMMAND");
  const common = ["version", "operationId", "meetingUuid", "baseRevision", "kind"];
  const allowed = command.kind === "create-meeting" ? [...common, "keys", "title", "scheduledAt", "notes", "agendaTitle", "file"] : command.kind === "edit-meeting" ? [...common, "title", "notes"] : command.kind === "edit-minutes" ? [...common, "discussion"] : [];
  if (!allowed.length || Object.keys(command).some(key => !allowed.includes(key))) throw new Error("INVALID_COMMAND_FIELDS");
  if (command.kind !== "edit-minutes" && (!command.title.trim() || command.title.length > 200 || command.notes.length > 20_000)) throw new Error("INVALID_MEETING");
  if (command.kind === "edit-minutes" && command.discussion.length > 20_000) throw new Error("INVALID_MINUTES");
  if (command.kind === "create-meeting") {
    const values = Object.values(command.keys);
    if (Object.keys(command.keys).sort().join(",") !== "agenda,document,item,material,meeting,minutes" || values.some(id => !uuidPattern.test(id)) || new Set(values).size !== 6 || command.keys.meeting !== command.meetingUuid || command.baseRevision !== 0) throw new Error("INVALID_IDENTITIES");
    if (!Number.isFinite(Date.parse(command.scheduledAt)) || !command.agendaTitle.trim() || command.agendaTitle.length > 200) throw new Error("INVALID_MEETING");
    const file = command.file;
    if (file && (Object.keys(file).sort().join(",") !== "mime,name,sha256,size" || !file.name.trim() || file.name.length > 200 || file.mime.length > 200 || !/^[a-f0-9]{64}$/.test(file.sha256) || !Number.isInteger(file.size) || file.size < 1 || file.size > 1_000_000)) throw new Error("INVALID_FILE");
  }
}
