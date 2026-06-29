import Dexie, { type Table } from "dexie";
import { DEFAULT_HOME_JURISDICTION_CODE } from "../../shared/jurisdictionWorkspace";
import type { LocalRowStore, RowStoreOp } from "../../shared/portable/localRowStore";

export type LocalSeed = Record<string, any[]>;
export type LocalArgs = Record<string, any> | undefined;

export type LocalRecordEnvelope = {
  key: string;
  table: string;
  id: string;
  societyId?: string;
  updatedAtISO?: string;
  deletedAtISO?: string;
  value: any;
};

export type LocalChangeEnvelope = {
  seq?: number;
  table: string;
  id: string;
  societyId?: string;
  op: "upsert" | "delete" | "seed";
  createdAtISO: string;
  mutationId?: string;
  reason?: string;
  snapshot?: any;
};

export type LocalAttachmentEnvelope = {
  key: string;
  societyId?: string;
  documentId?: string;
  versionId?: string;
  provider: string;
  storageKey: string;
  fileName?: string;
  mimeType?: string;
  fileSizeBytes?: number;
  sha256?: string;
  createdAtISO: string;
  updatedAtISO: string;
};

export type LocalWorkspaceMeta = {
  id: string;
  name: string;
  schemaVersion: number;
  createdAtISO: string;
  updatedAtISO: string;
};

export type LocalWorkspaceSnapshot = {
  kind: "societyer.localWorkspaceSnapshot";
  exportedAtISO: string;
  workspace: LocalWorkspaceMeta;
  tables: LocalSeed;
  attachments: LocalAttachmentEnvelope[];
  changes: LocalChangeEnvelope[];
};

const CURRENT_LOCAL_WORKSPACE_SCHEMA_VERSION = 2;

export class LocalDexieDatabase extends Dexie {
  meta!: Table<any, string>;
  records!: Table<LocalRecordEnvelope, string>;
  changes!: Table<LocalChangeEnvelope, number>;
  attachments!: Table<any, string>;
  meetings!: Table<any, string>;
  minutes!: Table<any, string>;

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
  }
}

export class LocalDexieRowStore implements LocalRowStore {
  private db: LocalDexieDatabase | null = null;
  private cache: LocalSeed;
  private seed: LocalSeed;
  private attachmentsCache: LocalAttachmentEnvelope[] = [];
  private changesCache: LocalChangeEnvelope[] = [];
  private workspaceMeta: LocalWorkspaceMeta;
  private listeners = new Set<() => void>();
  private transactionDepth = 0;
  private pendingNotify = false;

  constructor(seed: LocalSeed, options?: { databaseName?: string; logLabel?: string }) {
    this.seed = cloneLocalSeed(seed);
    this.cache = cloneLocalSeed(seed);
    this.workspaceMeta = {
      id: options?.databaseName ?? "societyer-local-workspace",
      name: "Societyer Local Workspace",
      schemaVersion: CURRENT_LOCAL_WORKSPACE_SCHEMA_VERSION,
      createdAtISO: new Date().toISOString(),
      updatedAtISO: new Date().toISOString(),
    };

    if (typeof window === "undefined" || !("indexedDB" in window)) return;

    this.db = new LocalDexieDatabase(options?.databaseName ?? "societyer-local-workspace");
    void this.hydrate(seed).catch((error) => {
      console.warn(`[${options?.logLabel ?? "societyer-local"}] Dexie hydrate failed; using in-memory data.`, error);
    });
  }

  onUpdate(listener: () => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  rows(table: string) {
    return this.cache[table] ?? [];
  }

  listRows(table: string, args?: LocalArgs) {
    return scopedLocalRows(this.rows(table), args);
  }

  getRow(table: string, id: string | undefined) {
    return byLocalId(this.rows(table), id);
  }

  upsertRow(table: string, row: any) {
    if (!row?._id) return null;
    this.cache[table] = upsertLocalRow(this.rows(table), row);
    this.persistRow(table, row, "upsert");
    this.scheduleNotify();
    return row;
  }

  patchRow(table: string, id: string | undefined, patch: Record<string, any>) {
    if (!id) return null;
    const existing = this.getRow(table, id);
    if (!existing) return null;
    const updated = { ...existing, ...patch, updatedAtISO: new Date().toISOString() };
    this.upsertRow(table, updated);
    return updated;
  }

  removeRow(table: string, id: string | undefined) {
    if (!id) return null;
    const previous = this.getRow(table, id);
    this.cache[table] = this.rows(table).filter((row) => row._id !== id);
    const deletedAtISO = new Date().toISOString();
    void this.db?.records.put(localDeletedRecord(table, {
      _id: id,
      societyId: previous?.societyId,
      ...(previous ?? {}),
      deletedAtISO,
    }));
    if (table === "meetings" || table === "minutes") void this.db?.[table].delete(id);
    void this.appendChange(table, { _id: id, societyId: previous?.societyId }, "delete");
    this.scheduleNotify();
    return previous;
  }

  transaction<T>(mutate: () => T): T {
    this.transactionDepth += 1;
    try {
      return mutate();
    } finally {
      this.transactionDepth -= 1;
      if (this.transactionDepth === 0 && this.pendingNotify) this.notify();
    }
  }

  /** Table names currently held in the cache (LocalRowStore contract). */
  tableNames(): string[] {
    return Object.keys(this.cache);
  }

  /**
   * Apply a batch of writes ATOMICALLY (LocalRowStore contract, used by the
   * portable mutation adapter). Unlike the legacy per-row `upsertRow`/`removeRow`
   * path — which fires un-awaited `void db.records.put(...)` with no isolation —
   * this persists every op in a single Dexie `rw` transaction and rolls the
   * in-memory cache back if the persist fails, so a multi-table mutation never
   * commits partially. This is the fix for the non-atomic-write correctness bug.
   */
  async commitBatch(ops: RowStoreOp[]): Promise<void> {
    if (!ops.length) return;

    const touched = new Set(ops.map((op) => op.table));
    const cacheBackup: LocalSeed = {};
    for (const table of touched) cacheBackup[table] = this.rows(table).map(cloneLocalRow);

    // Apply to the in-memory cache up front (reads see the new state immediately).
    for (const op of ops) {
      if (op.kind === "delete") this.cache[op.table] = this.rows(op.table).filter((row) => row._id !== op.id);
      else this.cache[op.table] = upsertLocalRow(this.rows(op.table), op.row);
    }

    const changes: LocalChangeEnvelope[] = [];
    const now = new Date().toISOString();
    for (const op of ops) {
      const id = op.kind === "delete" ? op.id : op.row._id;
      const societyId = op.kind === "delete" ? cacheBackup[op.table]?.find((r) => r._id === id)?.societyId : op.row.societyId;
      changes.push({
        table: op.table,
        id,
        societyId,
        op: op.kind === "delete" ? "delete" : "upsert",
        createdAtISO: now,
        mutationId: `${op.table}:${id}:${Date.now()}`,
      });
    }

    if (this.db) {
      try {
        await this.db.open();
        await this.db.transaction("rw", [this.db.records, this.db.changes, this.db.meetings, this.db.minutes], async () => {
          for (const op of ops) {
            if (op.kind === "delete") {
              const previous = cacheBackup[op.table]?.find((r) => r._id === op.id);
              await this.db!.records.put(localDeletedRecord(op.table, { _id: op.id, societyId: previous?.societyId, ...(previous ?? {}) }));
              if (op.table === "meetings" || op.table === "minutes") await this.db![op.table].delete(op.id);
            } else {
              await this.db!.records.put(localRecord(op.table, op.row));
              if (op.table === "meetings" || op.table === "minutes") await this.db![op.table].put(cloneLocalRow(op.row));
            }
          }
          await this.db!.changes.bulkAdd(changes);
        });
      } catch (error) {
        // Roll the cache back to its pre-batch state so memory matches storage.
        for (const table of touched) this.cache[table] = cacheBackup[table];
        throw error;
      }
    }

    this.changesCache = [...this.changesCache, ...changes];
    this.scheduleNotify();
  }

  exportSnapshot() {
    return {
      kind: "societyer.localWorkspaceSnapshot" as const,
      exportedAtISO: new Date().toISOString(),
      workspace: { ...this.workspaceMeta, updatedAtISO: new Date().toISOString() },
      tables: cloneLocalSeed(this.cache),
      attachments: cloneLocalRows(this.attachmentsCache),
      changes: cloneLocalRows(this.changesCache),
    };
  }

  async importSnapshot(snapshot: LocalWorkspaceSnapshot | { tables?: LocalSeed; attachments?: LocalAttachmentEnvelope[]; workspace?: Partial<LocalWorkspaceMeta> }) {
    const tables = snapshot?.tables;
    if (!tables || typeof tables !== "object") throw new Error("Local workspace snapshot is missing tables.");
    this.cache = migrateLocalWorkspaceSnapshotTables(cloneLocalSeed(tables));
    this.attachmentsCache = cloneLocalRows(snapshot.attachments ?? []);
    this.workspaceMeta = normalizeWorkspaceMeta(snapshot.workspace, this.workspaceMeta);
    if (!this.db) {
      this.notify();
      return;
    }
    await this.db.open();
    await Promise.all([
      this.db.meta.clear(),
      this.db.records.clear(),
      this.db.changes.clear(),
      this.db.attachments.clear(),
      this.db.meetings.clear(),
      this.db.minutes.clear(),
    ]);
    await this.writeSeed(this.cache);
    if (this.attachmentsCache.length) await this.db.attachments.bulkPut(cloneLocalRows(this.attachmentsCache));
    await this.db.meta.put({ key: "workspace", value: this.workspaceMeta });
    await this.appendChange("__workspace", { _id: this.workspaceMeta.id }, "seed", {
      reason: "import-snapshot",
      snapshot: { tableCount: Object.keys(this.cache).length, attachmentCount: this.attachmentsCache.length },
    });
    this.notify();
  }

  upsertAttachment(attachment: Omit<LocalAttachmentEnvelope, "key" | "createdAtISO" | "updatedAtISO"> & { key?: string; createdAtISO?: string; updatedAtISO?: string }) {
    const now = new Date().toISOString();
    const row: LocalAttachmentEnvelope = {
      ...attachment,
      key: attachment.key ?? localAttachmentKey(attachment.versionId ?? attachment.documentId ?? attachment.storageKey, attachment.storageKey),
      createdAtISO: attachment.createdAtISO ?? now,
      updatedAtISO: now,
    };
    this.attachmentsCache = upsertLocalRow(this.attachmentsCache, { ...row, _id: row.key }).map(({ _id, ...rest }: any) => rest);
    void this.db?.attachments.put(cloneLocalRow(row));
    void this.appendChange("__attachments", { _id: row.key, societyId: row.societyId }, "upsert", {
      reason: "attachment-upsert",
    });
    return row;
  }

  listAttachments(args?: LocalArgs) {
    if (!args?.societyId) return this.attachmentsCache;
    return this.attachmentsCache.filter((row) => !row.societyId || row.societyId === args.societyId);
  }

  async reseed() {
    this.cache = cloneLocalSeed(this.seed);
    if (!this.db) {
      this.notify();
      return;
    }
    await this.db.open();
    await Promise.all([
      this.db.meta.clear(),
      this.db.records.clear(),
      this.db.changes.clear(),
      this.db.attachments.clear(),
      this.db.meetings.clear(),
      this.db.minutes.clear(),
    ]);
    await this.writeSeed(this.seed);
    this.notify();
  }

  private async hydrate(seed: LocalSeed) {
    if (!this.db) return;

    await this.db.open();
    if ((await this.db.records.count()) === 0) {
      const [legacyMeetings, legacyMinutes] = await Promise.all([
        this.db.meetings.toArray(),
        this.db.minutes.toArray(),
      ]);
      await this.writeSeed({
        ...seed,
        meetings: legacyMeetings.length ? legacyMeetings : seed.meetings,
        minutes: legacyMinutes.length ? legacyMinutes : seed.minutes,
      });
    } else {
      await this.putMissingSeedRows(seed);
    }

    const [localRecords, attachments, changes, workspaceMeta] = await Promise.all([
      this.db.records.toArray(),
      this.db.attachments.toArray(),
      this.db.changes.toArray(),
      this.db.meta.get("workspace"),
    ]);
    const next = cloneLocalSeed(seed);
    for (const record of localRecords) {
      if (!record?.table || !record?.value?._id || record.deletedAtISO) continue;
      next[record.table] = upsertLocalRow(next[record.table] ?? [], record.value);
    }

    this.cache = next;
    this.attachmentsCache = cloneLocalRows(attachments);
    this.changesCache = cloneLocalRows(changes);
    this.workspaceMeta = normalizeWorkspaceMeta(workspaceMeta?.value, this.workspaceMeta);
    this.notify();
  }

  private async writeSeed(seed: LocalSeed) {
    if (!this.db) return;
    const records = Object.entries(seed).flatMap(([table, rows]) =>
      Array.isArray(rows) ? rows.filter((row) => row?._id).map((row) => localRecord(table, row)) : [],
    );
    if (records.length) await this.db.records.bulkPut(records);
    await Promise.all([
      this.db.meta.put({ key: "schemaVersion", value: CURRENT_LOCAL_WORKSPACE_SCHEMA_VERSION }),
      this.db.meta.put({ key: "workspace", value: this.workspaceMeta }),
      seed.meetings?.length ? this.db.meetings.bulkPut(cloneLocalRows(seed.meetings)) : Promise.resolve(),
      seed.minutes?.length ? this.db.minutes.bulkPut(cloneLocalRows(seed.minutes)) : Promise.resolve(),
    ]);
  }

  private async putMissingSeedRows(seed: LocalSeed) {
    if (!this.db) return;
    const missing: LocalRecordEnvelope[] = [];
    for (const [table, rows] of Object.entries(seed)) {
      for (const row of rows) {
        if (!row?._id) continue;
        if (!(await this.db.records.get(localRecordKey(table, row._id)))) missing.push(localRecord(table, row));
      }
    }
    if (missing.length) await this.db.records.bulkPut(missing);
  }

  private persistRow(table: string, row: any, op: LocalChangeEnvelope["op"]) {
    void this.db?.records.put(localRecord(table, row));
    if (table === "meetings" || table === "minutes") void this.db?.[table].put(cloneLocalRow(row));
    void this.appendChange(table, row, op);
  }

  private appendChange(table: string, row: any, op: LocalChangeEnvelope["op"], metadata?: Pick<LocalChangeEnvelope, "mutationId" | "reason" | "snapshot">) {
    const change: LocalChangeEnvelope = {
      table,
      id: row._id,
      societyId: row.societyId,
      op,
      createdAtISO: new Date().toISOString(),
      mutationId: metadata?.mutationId ?? `${table}:${row._id}:${Date.now()}`,
      reason: metadata?.reason,
      snapshot: metadata?.snapshot,
    };
    this.changesCache = [...this.changesCache, change];
    return this.db?.changes.add(change);
  }

  private notify() {
    this.pendingNotify = false;
    for (const listener of this.listeners) listener();
  }

  private scheduleNotify() {
    if (this.transactionDepth > 0) {
      this.pendingNotify = true;
      return;
    }
    this.notify();
  }
}

export function scopedLocalRows(rows: any[], args: LocalArgs) {
  if (!args?.societyId) return rows;
  return rows.filter((row) => !row.societyId || row.societyId === args.societyId);
}

export function byLocalId(rows: any[], id: string | undefined) {
  if (!id) return undefined;
  return rows.find((row) => row._id === id);
}

export function upsertLocalRow(rows: any[], row: any) {
  const index = rows.findIndex((candidate) => candidate._id === row._id);
  if (index === -1) return [...rows, row];
  const next = rows.slice();
  next[index] = row;
  return next;
}

export function cloneLocalRow<T>(row: T): T {
  return JSON.parse(JSON.stringify(row));
}

export function cloneLocalRows<T>(rows: T[]): T[] {
  return rows.map((row) => cloneLocalRow(row));
}

export function cloneLocalSeed(seed: LocalSeed): LocalSeed {
  return Object.fromEntries(
    Object.entries(seed)
      .filter((entry): entry is [string, any[]] => Array.isArray(entry[1]))
      .map(([table, rows]) => [table, cloneLocalRows(rows)]),
  );
}

export function migrateLocalWorkspaceSnapshotTables(seed: LocalSeed): LocalSeed {
  const migrated = cloneLocalSeed(seed);
  const now = new Date().toISOString();
  const hasRegistrationTable = Array.isArray(seed.organizationRegistrations);
  migrated.societies = (migrated.societies ?? []).map((row) => migrateSocietyWorkspaceRow(row, now));
  if (!hasRegistrationTable) {
    migrated.organizationRegistrations = migrateHomeRegistrations(
      migrated.societies ?? [],
      [],
      now,
    );
  }
  return migrated;
}

function migrateSocietyWorkspaceRow(row: any, now: string) {
  const jurisdictionCode = cleanSnapshotText(row?.jurisdictionCode) || DEFAULT_HOME_JURISDICTION_CODE;
  const entityType = cleanSnapshotText(row?.entityType) || "society";
  const actFormedUnder =
    cleanSnapshotText(row?.actFormedUnder) ||
    (jurisdictionCode === "CA-BC" && entityType === "society" ? "societies_act" : undefined);
  return {
    ...row,
    jurisdictionCode,
    entityType,
    actFormedUnder,
    updatedAtISO: cleanSnapshotText(row?.updatedAtISO) || now,
  };
}

function migrateHomeRegistrations(societies: any[], registrations: any[], now: string) {
  const next = cloneLocalRows(registrations);
  const hasHomeRegistration = new Set(
    next
      .filter((row) => row.registrationType === "home")
      .map((row) => row.societyId)
      .filter(Boolean),
  );

  for (const society of societies) {
    if (!society?._id || hasHomeRegistration.has(society._id)) continue;
    const jurisdictionCode = cleanSnapshotText(society.jurisdictionCode) || DEFAULT_HOME_JURISDICTION_CODE;
    next.push({
      _id: `local_home_registration_${society._id}`,
      _creationTime: Date.now(),
      societyId: society._id,
      registrationType: "home",
      jurisdiction: jurisdictionCode,
      homeJurisdiction: jurisdictionCode,
      registrationNumber: cleanSnapshotText(society.incorporationNumber),
      registrationDate: cleanSnapshotText(society.incorporationDate),
      registryPortalKey: jurisdictionCode === "CA-BC" ? "bc_registry_societies" : undefined,
      status: cleanSnapshotText(society.status) || "active",
      notes: "Seeded during local snapshot migration from legacy workspace fields.",
      sourceExternalIds: ["societyer:local-snapshot-migration:home-registration"],
      createdAtISO: now,
      updatedAtISO: now,
    });
    hasHomeRegistration.add(society._id);
  }

  return next;
}

function cleanSnapshotText(value: unknown) {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

export function localRecordKey(table: string, id: string) {
  return `${table}:${id}`;
}

export function localRecord(table: string, row: any): LocalRecordEnvelope {
  return {
    key: localRecordKey(table, row._id),
    table,
    id: row._id,
    societyId: row.societyId,
    updatedAtISO: row.updatedAtISO,
    deletedAtISO: row.deletedAtISO,
    value: cloneLocalRow(row),
  };
}

export function localAttachmentKey(ownerId: string | undefined, storageKey: string) {
  return `${ownerId ?? "attachment"}:${storageKey}`;
}

function normalizeWorkspaceMeta(value: Partial<LocalWorkspaceMeta> | undefined, fallback: LocalWorkspaceMeta): LocalWorkspaceMeta {
  const now = new Date().toISOString();
  return {
    id: String(value?.id ?? fallback.id),
    name: String(value?.name ?? fallback.name),
    schemaVersion: Math.max(
      Number(value?.schemaVersion ?? fallback.schemaVersion ?? CURRENT_LOCAL_WORKSPACE_SCHEMA_VERSION),
      CURRENT_LOCAL_WORKSPACE_SCHEMA_VERSION,
    ),
    createdAtISO: String(value?.createdAtISO ?? fallback.createdAtISO ?? now),
    updatedAtISO: String(value?.updatedAtISO ?? now),
  };
}

export function localDeletedRecord(table: string, row: any): LocalRecordEnvelope {
  const deletedAtISO = row.deletedAtISO ?? new Date().toISOString();
  return {
    ...localRecord(table, { ...row, deletedAtISO }),
    deletedAtISO,
  };
}
