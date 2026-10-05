import type { PowerSyncDatabase } from "@powersync/web";
import { LocalStoreDb, type LocalRowStore, type RowStoreOp } from "../../shared/portable/localRowStore";
import type { PortableDoc, PortableMutationCtx } from "../../shared/portable/ctx";
import { makeCapabilities } from "../../shared/portable/capabilities";
import { runMeetingCommand } from "../../shared/offline/meetingDomain";
import type { Scope } from "./database";
import { validateCommand, type FileDescriptor, type Mapping, type MeetingCommand, type MeetingKeys, type Snapshot, uuidPattern } from "../../shared/offline/meetingProtocol";

const tables = ["meetings", "minutes", "agendas", "agendaItems", "documents", "meetingMaterials"];
const keyForTable: Record<string, keyof MeetingKeys> = { meetings: "meeting", minutes: "minutes", agendas: "agenda", agendaItems: "item", documents: "document", meetingMaterials: "material" };
export type LocalFile = { descriptor: FileDescriptor; content: string };
export async function prepareFile(file: File): Promise<LocalFile> {
  if (file.size < 1 || file.size > 1_000_000) throw new Error("Pilot attachments must be between 1 byte and 1 MB.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const sha256 = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), n => n.toString(16).padStart(2, "0")).join("");
  let binary = ""; for (const byte of bytes) binary += String.fromCharCode(byte);
  return { descriptor: { name: file.name, mime: file.type || "application/octet-stream", size: file.size, sha256 }, content: btoa(binary) };
}
export function newKeys(): MeetingKeys {
  return { meeting: crypto.randomUUID(), minutes: crypto.randomUUID(), agenda: crypto.randomUUID(), item: crypto.randomUUID(), document: crypto.randomUUID(), material: crypto.randomUUID() };
}

/** Selected portable rows only. PowerSync owns all durability and the upload queue. */
export async function saveMeetingCommand(db: PowerSyncDatabase, scope: Scope, role: string, command: MeetingCommand, file?: LocalFile) {
  validateCommand(command);
  if (command.kind === "create-meeting" && ((Boolean(command.file) !== Boolean(file)) || (file && JSON.stringify(file.descriptor) !== JSON.stringify(command.file)))) throw new Error("Attachment bytes and command descriptor must match.");
  const saved = await db.getAll<{ table_name: string; body: string }>("SELECT table_name, body FROM portableMeetingRows");
  const cache = new Map<string, PortableDoc[]>();
  for (const row of saved) cache.set(row.table_name, [...(cache.get(row.table_name) ?? []), JSON.parse(row.body)]);
  cache.set("societies", [{ _id: scope.societyId, name: "Pilot workspace", isCharity: false, isMemberFunded: false }]);
  cache.set("users", [{ _id: `pilot:${scope.subject}`, societyId: scope.societyId, role, status: "Active", authSubject: scope.subject }]);
  const current = await db.getOptional<{ revision: number; mappings: string }>("SELECT * FROM meetingLocalState WHERE id = ?", [command.meetingUuid]);
  if ((current?.revision ?? 0) !== command.baseRevision) throw new Error("Local revision changed; reopen the draft before saving.");
  const store: LocalRowStore = {
    rows: table => cache.get(table) ?? [], tableNames: () => [...cache.keys()],
    async commitBatch(ops: RowStoreOp[]) {
      // Portable writes, immutable command, history and attachment bytes share ONE
      // real SQLite transaction. A failed durable commit never reports a save.
      await db.writeTransaction(async tx => {
        const latest = await tx.getOptional<{ revision: number }>("SELECT revision FROM meetingLocalState WHERE id = ?", [command.meetingUuid]);
        if ((latest?.revision ?? 0) !== command.baseRevision) throw new Error("Local revision changed; reopen the draft before saving.");
        for (const op of ops) {
          if (!tables.includes(op.table) || (op.kind === "upsert" && op.row.societyId !== scope.societyId)) throw new Error("Unsupported pilot row.");
          if (op.kind === "delete") await tx.execute("DELETE FROM portableMeetingRows WHERE id = ?", [op.id]);
          else {
            const found = await tx.getOptional("SELECT id FROM portableMeetingRows WHERE id = ?", [op.row._id]);
            if (found) await tx.execute("UPDATE portableMeetingRows SET body = ? WHERE id = ?", [JSON.stringify(op.row), op.row._id]);
            else await tx.execute("INSERT INTO portableMeetingRows (id, table_name, body) VALUES (?, ?, ?)", [op.row._id, op.table, JSON.stringify(op.row)]);
          }
        }
        const body = JSON.stringify(command);
        await tx.execute("INSERT INTO offlineMeetingCommands (id, society_id, body, _metadata) VALUES (?, ?, ?, ?)", [command.operationId, scope.societyId, body, JSON.stringify({ scope, command })]);
        await tx.execute("INSERT INTO meetingCommandHistory (id, meeting_uuid, body, state) VALUES (?, ?, ?, 'waiting')", [command.operationId, command.meetingUuid, body]);
        if (current) await tx.execute("UPDATE meetingLocalState SET revision = ?, mappings = ? WHERE id = ?", [command.baseRevision + 1, JSON.stringify(mappings), command.meetingUuid]);
        else await tx.execute("INSERT INTO meetingLocalState (id, revision, mappings, origin) VALUES (?, ?, ?, 'authored')", [command.meetingUuid, command.baseRevision + 1, JSON.stringify(mappings)]);
        if (file && command.kind === "create-meeting") await tx.execute("INSERT INTO meetingFiles (id, meeting_uuid, descriptor, content, state, origin) VALUES (?, ?, ?, ?, 'waiting', 'authored')", [command.keys.document, command.meetingUuid, JSON.stringify(file.descriptor), file.content]);
      });
    },
  };
  const localDb = new LocalStoreDb(store, { mintId: table => {
    if (command.kind !== "create-meeting" || !keyForTable[table]) throw new Error("Unsupported pilot insert.");
    return command.keys[keyForTable[table]];
  } });
  const unavailable = async (): Promise<never> => { throw new Error("Unsupported pilot domain call."); };
  const context: PortableMutationCtx = { db: localDb, capabilities: makeCapabilities({}),
    // Local preparation only. This principal is NEVER serialized into a hosted command.
    principal: { kind: "user", runtime: "browser-local", assurance: "trusted-workspace", subject: scope.subject, societyId: scope.societyId, userId: `pilot:${scope.subject}` },
    runQuery: unavailable, runMutation: unavailable };
  let mappings: Mapping[] = current ? JSON.parse(current.mappings) : [];
  await localDb.transaction(async () => { mappings = await runMeetingCommand(context, scope.societyId, command, mappings); });
}

export async function exportMeetingRecovery(db: PowerSyncDatabase, scope: Scope) {
  return { format: "societyer-meeting-pilot-recovery", version: 1, scope, exportedAt: new Date().toISOString(),
    rows: await db.getAll("SELECT * FROM portableMeetingRows"),
    history: await db.getAll("SELECT * FROM meetingCommandHistory"),
    files: await db.getAll("SELECT * FROM meetingFiles"),
    // PowerSync queue is authoritative. This is an export, not a second outbox.
    pending: await db.getAll("SELECT * FROM ps_crud") };
}

/** Selected projection -> portable preparation rows. Pending work is preserved
 * separately; SDK replication owns the server view, not this domain conversion.
 */
export async function hydrateMeetingSnapshots(db: PowerSyncDatabase, scope: Scope, snapshots: Snapshot[], protectedMeetingIds: ReadonlySet<string> = new Set(), isCurrent: () => boolean = () => true) {
  await db.writeTransaction(async tx => {
    if (!isCurrent()) return;
    // A complete authorized projection controls cached downloads even when a
    // local draft, pending upload or currently edited form must be preserved.
    const allowedFiles = new Set(snapshots.flatMap(snapshot => snapshot.files.map(file => file.uuid)));
    const downloadedFiles = await tx.getAll<{ id: string }>("SELECT id FROM meetingFiles WHERE origin = 'downloaded'");
    for (const file of downloadedFiles) if (!allowedFiles.has(file.id)) await tx.execute("DELETE FROM meetingFiles WHERE id = ?", [file.id]);
    const received = new Set(snapshots.map(row => row.meetingUuid));
    const downloaded = await tx.getAll<{ id: string; mappings: string }>("SELECT id, mappings FROM meetingLocalState WHERE origin = 'downloaded'");
    for (const row of downloaded) {
      const pending = await tx.getOptional("SELECT id FROM meetingCommandHistory WHERE meeting_uuid = ? AND state IN ('waiting', 'review') LIMIT 1", [row.id]);
      if (received.has(row.id) || pending || protectedMeetingIds.has(row.id)) continue;
      for (const mapping of JSON.parse(row.mappings) as Mapping[]) await tx.execute("DELETE FROM portableMeetingRows WHERE id = ?", [mapping.nativeId]);
      await tx.execute("DELETE FROM meetingLocalState WHERE id = ?", [row.id]);
      await tx.execute("DELETE FROM meetingFiles WHERE meeting_uuid = ? AND origin = 'downloaded'", [row.id]);
    }
    for (const snapshot of snapshots) {
      const permittedFiles = snapshot.files.map(file => file.uuid);
      await tx.execute(`DELETE FROM meetingFiles WHERE meeting_uuid = ? AND origin = 'downloaded'${permittedFiles.length ? ` AND id NOT IN (${permittedFiles.map(() => "?").join(",")})` : ""}`, [snapshot.meetingUuid, ...permittedFiles]);
      if (!uuidPattern.test(snapshot.meetingUuid) || !uuidPattern.test(snapshot.ids.minutes) || !uuidPattern.test(snapshot.ids.agenda) || snapshot.ids.items.some(id => !uuidPattern.test(id)) || snapshot.ids.items.length !== snapshot.agenda.length) throw new Error("Invalid downloaded identities.");
      const pending = await tx.getOptional("SELECT id FROM meetingCommandHistory WHERE meeting_uuid = ? AND state IN ('waiting', 'review') LIMIT 1", [snapshot.meetingUuid]);
      // Quarantined edits live in immutable recovery history. They must not
      // prevent the current authorized server meeting from being restored.
      if (pending || protectedMeetingIds.has(snapshot.meetingUuid)) continue;
      const mappings: Mapping[] = [
        { table: "meetings", uuid: snapshot.meetingUuid, nativeId: snapshot.meetingUuid },
        { table: "minutes", uuid: snapshot.ids.minutes, nativeId: snapshot.ids.minutes },
        { table: "agendas", uuid: snapshot.ids.agenda, nativeId: snapshot.ids.agenda },
        ...snapshot.ids.items.map(uuid => ({ table: "agendaItems", uuid, nativeId: uuid })),
      ];
      const rows: Record<string, any>[] = [
        { table: "meetings", row: { _id: snapshot.meetingUuid, societyId: scope.societyId, title: snapshot.title, scheduledAt: snapshot.scheduledAt, notes: snapshot.notes, minutesId: snapshot.ids.minutes } },
        { table: "minutes", row: { _id: snapshot.ids.minutes, societyId: scope.societyId, meetingId: snapshot.meetingUuid, discussion: snapshot.discussion, ...(snapshot.editable ? {} : { approvedAt: "server-adopted" }) } },
        { table: "agendas", row: { _id: snapshot.ids.agenda, societyId: scope.societyId, meetingId: snapshot.meetingUuid } },
        ...snapshot.ids.items.map((id, i) => ({ table: "agendaItems", row: { _id: id, societyId: scope.societyId, agendaId: snapshot.ids.agenda, order: i, title: snapshot.agenda[i] } })),
      ];
      const previous = await tx.getOptional<{ mappings: string }>("SELECT mappings FROM meetingLocalState WHERE id = ?", [snapshot.meetingUuid]);
      const currentIds = new Set(mappings.map(mapping => mapping.nativeId));
      // Parent replacement/item deletion must remove its old mirrored body too.
      // Otherwise revocation purges only current mappings and leaks old content
      // through the complete recovery export. Immutable authored history stays.
      for (const old of previous ? JSON.parse(previous.mappings) as Mapping[] : []) {
        if (!currentIds.has(old.nativeId)) await tx.execute("DELETE FROM portableMeetingRows WHERE id = ?", [old.nativeId]);
      }
      for (const { table, row } of rows) {
        const exists = await tx.getOptional("SELECT id FROM portableMeetingRows WHERE id = ?", [row._id]);
        if (exists) await tx.execute("UPDATE portableMeetingRows SET body = ? WHERE id = ?", [JSON.stringify(row), row._id]);
        else await tx.execute("INSERT INTO portableMeetingRows (id, table_name, body) VALUES (?, ?, ?)", [row._id, table, JSON.stringify(row)]);
      }
      const exists = await tx.getOptional("SELECT id FROM meetingLocalState WHERE id = ?", [snapshot.meetingUuid]);
      if (exists) await tx.execute("UPDATE meetingLocalState SET revision = ?, mappings = ?, origin = 'downloaded' WHERE id = ?", [snapshot.revision, JSON.stringify(mappings), snapshot.meetingUuid]);
      else await tx.execute("INSERT INTO meetingLocalState (id, revision, mappings, origin) VALUES (?, ?, ?, 'downloaded')", [snapshot.meetingUuid, snapshot.revision, JSON.stringify(mappings)]);
    }
  });
}
