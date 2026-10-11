import Dexie, { type Table } from "dexie";
import type {
  LocalChangeEnvelope,
  LocalProjectionEnvelope,
  LocalRecordEnvelope,
  LocalRecordFieldsEnvelope,
  LocalWorkspaceBinaryFile,
} from "./localDexieRowStore";

/**
 * The IndexedDB schema of the local workspace vault. Kept in its own module so
 * Dexie is fetched when the row store opens the vault, not in the boot chunk of
 * the local data client (SU-11). `LocalDexieRowStore` imports it dynamically.
 */
export class LocalDexieDatabase extends Dexie {
  meta!: Table<any, string>;
  records!: Table<LocalRecordEnvelope, string>;
  recordFields!: Table<LocalRecordFieldsEnvelope, string>;
  projections!: Table<LocalProjectionEnvelope, string>;
  changes!: Table<LocalChangeEnvelope, number>;
  attachments!: Table<any, string>;
  meetings!: Table<any, string>;
  minutes!: Table<any, string>;
  files!: Table<LocalWorkspaceBinaryFile, string>;

  constructor(databaseName: string) {
    super(databaseName);
    this.version(1).stores({
      meetings: "_id, societyId, scheduledAt, status",
      minutes: "_id, meetingId, societyId, heldAt, status",
    });
    this.version(2).stores({
      meetings: "_id, societyId, scheduledAt, status",
      minutes: "_id, meetingId, societyId, heldAt, status",
      records: "&key, table, id, societyId",
    });
    this.version(3).stores({
      meta: "&key",
      records: "&key, table, id, societyId, updatedAtISO, deletedAtISO",
      changes: "++seq, table, id, societyId, op, createdAtISO",
      attachments: "&key, societyId, documentId, versionId, sha256",
      meetings: "_id, societyId, scheduledAt, status",
      minutes: "_id, meetingId, societyId, heldAt, status",
    });
    this.version(4).stores({ files: "&key, sha256" });
    this.version(5).stores({ recordFields: "&key, table" });
    this.version(6).stores({ projections: "&key, table" });
  }
}
