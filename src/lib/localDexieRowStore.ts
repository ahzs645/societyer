import Dexie, { type Table } from "dexie";

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
};

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

export class LocalDexieRowStore {
  private db: LocalDexieDatabase | null = null;
  private cache: LocalSeed;
  private seed: LocalSeed;
  private listeners = new Set<() => void>();
  private transactionDepth = 0;
  private pendingNotify = false;

  constructor(seed: LocalSeed, options?: { databaseName?: string; logLabel?: string }) {
    this.seed = cloneLocalSeed(seed);
    this.cache = cloneLocalSeed(seed);

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

  exportSnapshot() {
    return {
      exportedAtISO: new Date().toISOString(),
      tables: cloneLocalSeed(this.cache),
    };
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

    const localRecords = await this.db.records.toArray();
    const next = cloneLocalSeed(seed);
    for (const record of localRecords) {
      if (!record?.table || !record?.value?._id || record.deletedAtISO) continue;
      next[record.table] = upsertLocalRow(next[record.table] ?? [], record.value);
    }

    this.cache = next;
    this.notify();
  }

  private async writeSeed(seed: LocalSeed) {
    if (!this.db) return;
    const records = Object.entries(seed).flatMap(([table, rows]) =>
      rows.filter((row) => row?._id).map((row) => localRecord(table, row)),
    );
    if (records.length) await this.db.records.bulkPut(records);
    await Promise.all([
      this.db.meta.put({ key: "schemaVersion", value: 1 }),
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

  private appendChange(table: string, row: any, op: LocalChangeEnvelope["op"]) {
    return this.db?.changes.add({
      table,
      id: row._id,
      societyId: row.societyId,
      op,
      createdAtISO: new Date().toISOString(),
    });
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
  return Object.fromEntries(Object.entries(seed).map(([table, rows]) => [table, cloneLocalRows(rows)]));
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

export function localDeletedRecord(table: string, row: any): LocalRecordEnvelope {
  const deletedAtISO = row.deletedAtISO ?? new Date().toISOString();
  return {
    ...localRecord(table, { ...row, deletedAtISO }),
    deletedAtISO,
  };
}
