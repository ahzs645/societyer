import { column, PowerSyncDatabase, Schema, Table, WASQLiteVFS } from "@powersync/web";

export type Scope = { deployment: string; issuer: string; subject: string; societyId: string };
export type Draft = { id: string; society_id: string; title: string; content: string; revision: number };
export const schema = new Schema({
  offlineDrafts: new Table({ society_id: column.text, title: column.text, content: column.text, revision: column.integer }, { trackMetadata: true }),
  offlineMeetingCommands: new Table({ society_id: column.text, body: column.text }, { trackMetadata: true }),
  offlineMeetingDownloads: new Table({ society_id: column.text, actor_key: column.text, meeting_uuid: column.text, revision: column.integer, payload: column.text }),
  portableMeetingRows: new Table({ table_name: column.text, body: column.text }, { localOnly: true }),
  meetingLocalState: new Table({ revision: column.integer, mappings: column.text, origin: column.text }, { localOnly: true }),
  meetingCommandHistory: new Table({ meeting_uuid: column.text, body: column.text, state: column.text, result: column.text }, { localOnly: true }),
  meetingFiles: new Table({ meeting_uuid: column.text, descriptor: column.text, content: column.text, state: column.text }, { localOnly: true }),
  fixtureMeetingSnapshots: new Table({ payload: column.text }, { localOnly: true }),
});
export async function openDatabase(scope: Scope) {
  const bytes = new TextEncoder().encode(JSON.stringify([scope.deployment, scope.issuer, scope.subject, scope.societyId]));
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), b => b.toString(16).padStart(2, "0")).join("");
  const db = new PowerSyncDatabase({
    schema,
    database: { dbFilename: `societyer-offline-evaluation-${hash}.sqlite`, vfs: WASQLiteVFS.IDBBatchAtomicVFS },
  });
  await db.init();
  return db;
}

export async function saveDraft(db: PowerSyncDatabase, scope: Scope, title: string, content: string, id: string = crypto.randomUUID()) {
  if (!title.trim()) throw new Error("A draft title is required.");
  await db.writeTransaction(async tx => {
    const current = await tx.getOptional<Draft>("SELECT * FROM offlineDrafts WHERE id = ?", [id]);
    if (current && current.society_id !== scope.societyId) throw new Error("Draft workspace mismatch.");
    const baseRevision = current?.revision ?? 0;
    const metadata = JSON.stringify({ operationId: crypto.randomUUID(), scope, baseRevision, title, content });
    // PowerSync exposes synced tables as SQLite views; UPSERT cannot target a view.
    if (current) await tx.execute("UPDATE offlineDrafts SET title = ?, content = ?, revision = ?, _metadata = ? WHERE id = ?",
      [title, content, baseRevision + 1, metadata, id]);
    else await tx.execute("INSERT INTO offlineDrafts (id, society_id, title, content, revision, _metadata) VALUES (?, ?, ?, ?, ?, ?)",
      [id, scope.societyId, title, content, baseRevision + 1, metadata]);
  });
  return id;
}
