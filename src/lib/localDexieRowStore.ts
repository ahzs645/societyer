import Dexie, { type Table } from "dexie";
import { stripImportedAuthBindings } from "../../shared/workspaceIdentity";
import { quarantineImportedPathways } from "../../shared/pathways/imports";
import { DEFAULT_HOME_JURISDICTION_CODE } from "../../shared/jurisdictionWorkspace";
import type { LocalRowStore, RowStoreOp } from "../../shared/portable/localRowStore";
import { createEntityIdFactory } from "../../shared/portable/ids";
import { HEAVY_FIELD_POLICY, splitHeavyFields } from "../../shared/portable/heavyFields";

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
  /**
   * Top-level fields of `value` stored in the `recordFields` object store instead
   * (lazy heavy fields, see shared/portable/heavyFields.ts). Absent = none.
   */
  external?: string[];
};

/** Side record holding a row's externalized heavy field values. */
export type LocalRecordFieldsEnvelope = {
  key: string;
  table: string;
  id: string;
  fields: Record<string, unknown>;
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

export type LocalWorkspaceBinaryFile = { key: string; sha256: string; blob?: Blob };

const CURRENT_LOCAL_WORKSPACE_SCHEMA_VERSION = 3;

/**
 * Physical storage layout, independent of the row schema version above.
 *   1 — every row stored whole in `records`; meetings/minutes mirrored into the
 *       legacy v1 object stores.
 *   2 — heavy fields split into `recordFields` so boot reads only light rows;
 *       legacy mirrors no longer written (still read once to upgrade v1 data).
 */
const CURRENT_LOCAL_STORAGE_LAYOUT = 2;
const LAYOUT_MIGRATION_CHUNK = 100;

// Keep a useful diagnostic window without treating the journal as durable history.
const LOCAL_CHANGE_JOURNAL_CAP = 2_000;
const LOCAL_CHANGE_JOURNAL_PRUNE_SLACK = 100;

export class LocalDexieDatabase extends Dexie {
  meta!: Table<any, string>;
  records!: Table<LocalRecordEnvelope, string>;
  recordFields!: Table<LocalRecordFieldsEnvelope, string>;
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
  }
}

/** One table of the in-memory cache: rows by id, plus derived views built on demand. */
type TableState = {
  rows: Map<string, any>;
  /** Insertion-ordered array view, rebuilt after a write. */
  array: any[] | null;
  /** Equality indexes: field → value → rows. Dropped after a write. */
  indexes: Map<string, Map<unknown, any[]>>;
};

type PreparedOp =
  | { kind: "delete"; table: string; id: string; key: string }
  | {
      kind: "upsert";
      table: string;
      id: string;
      key: string;
      light: any;
      heavy: Record<string, unknown> | null;
      /** Previously external fields the (light) legacy row did not mention: kept as they are. */
      carried: string[];
      external: string[];
    };

type UndoEntry = {
  table: string;
  id: string;
  row: any;
  external: readonly string[] | undefined;
  pending: Record<string, unknown> | undefined;
};

/**
 * Browser-local row store: an in-memory cache of every table over IndexedDB
 * (Dexie). WP-K scale notes:
 *   - rows live in per-table Maps with an id → table map, so lookups are O(1)
 *     and a write no longer copies the whole table array;
 *   - equality indexes (societyId, meetingId, …) are built lazily per field;
 *   - heavy fields (HEAVY_FIELD_POLICY) are kept in `recordFields`, out of both
 *     the cache and the `records` store that boot reads, and are loaded only for
 *     rows a query returns (`loadExternalFields`);
 *   - change notifications carry the set of tables that changed, so the query
 *     cache re-runs only queries that read them.
 */
export class LocalDexieRowStore implements LocalRowStore {
  private db: LocalDexieDatabase | null = null;
  private tables = new Map<string, TableState>();
  private idTables = new Map<string, string>();
  /** recordKey → externalized field names. */
  private external = new Map<string, readonly string[]>();
  /** Heavy values written but not yet durable (read before IndexedDB). */
  private pendingHeavy = new Map<string, Record<string, unknown>>();
  /** Heavy values when there is no IndexedDB (memory-only session never splits). */
  private seed: LocalSeed;
  private attachmentsCache: LocalAttachmentEnvelope[] = [];
  private filesCache: LocalWorkspaceBinaryFile[] = [];
  private changesCache: LocalChangeEnvelope[] = [];
  private workspaceMeta: LocalWorkspaceMeta;
  private listeners = new Set<(changed?: ReadonlySet<string>) => void>();
  private transactionDepth = 0;
  /** undefined = nothing pending; null = everything changed. */
  private pendingChanged: Set<string> | null | undefined = undefined;
  private atomicBatchOps: RowStoreOp[] | null = null;
  private atomicUndo: Map<string, UndoEntry> | null = null;
  /** Ops issued through the legacy row API, whose rows may omit external fields. */
  private legacyOps = new WeakSet<RowStoreOp>();
  private hydrated: Promise<void> = Promise.resolve();
  /**
   * Writes that landed while the first read of IndexedDB was still in flight.
   * `hydrate()` builds its snapshot from rows read BEFORE these were applied, so
   * assigning that snapshot over the cache would silently drop them — which is
   * exactly what happens on the app's busiest moment, the first-run flow that
   * creates a workspace seconds after boot. They are replayed on top instead.
   */
  private preHydrationOps: RowStoreOp[] | null = null;

  constructor(seed: LocalSeed, options?: { databaseName?: string; logLabel?: string }) {
    this.seed = cloneLocalSeed(seed);
    this.loadTables(cloneLocalSeed(seed));
    this.workspaceMeta = {
      id: options?.databaseName ?? "societyer-local-workspace",
      name: "Societyer Local Workspace",
      schemaVersion: CURRENT_LOCAL_WORKSPACE_SCHEMA_VERSION,
      createdAtISO: new Date().toISOString(),
      updatedAtISO: new Date().toISOString(),
    };

    if (typeof window === "undefined" || !("indexedDB" in window)) return;

    this.db = new LocalDexieDatabase(options?.databaseName ?? "societyer-local-workspace");
    this.preHydrationOps = [];
    this.hydrated = this.hydrate(seed).catch((error) => {
      this.db?.close();
      this.db = null;
      console.warn(
        `[${options?.logLabel ?? "societyer-local"}] Dexie hydrate failed; using in-memory data for this session. Changes will not persist.`,
        error,
      );
    });
  }

  /**
   * Resolves once persisted rows have been read back into the cache. Until then
   * queries answer from the seed alone, so anything that *branches* on emptiness
   * — a first-run redirect, an "import your data" prompt — has to wait for this
   * or it will act on a workspace that only looks empty.
   */
  whenHydrated() {
    return this.hydrated;
  }

  /** `changed` lists the tables a write touched; undefined means "anything may have changed". */
  onUpdate(listener: (changed?: ReadonlySet<string>) => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /* ------------------------------ cache access ----------------------------- */

  private tableState(table: string, create: true): TableState;
  private tableState(table: string, create?: false): TableState | undefined;
  private tableState(table: string, create = false) {
    let state = this.tables.get(table);
    if (!state && create) {
      state = { rows: new Map(), array: null, indexes: new Map() };
      this.tables.set(table, state);
    }
    return state;
  }

  private setCachedRow(table: string, row: any) {
    const state = this.tableState(table, true);
    state.rows.set(row._id, row);
    state.array = null;
    if (state.indexes.size) state.indexes.clear();
    this.idTables.set(row._id, table);
  }

  private deleteCachedRow(table: string, id: string) {
    const state = this.tableState(table);
    if (!state?.rows.delete(id)) return;
    state.array = null;
    if (state.indexes.size) state.indexes.clear();
    if (this.idTables.get(id) === table) this.idTables.delete(id);
  }

  private loadTables(seed: LocalSeed) {
    this.tables = new Map();
    this.idTables = new Map();
    for (const [table, rows] of Object.entries(seed)) {
      const state = this.tableState(table, true);
      for (const row of rows) {
        if (!row?._id) continue;
        state.rows.set(row._id, row);
        this.idTables.set(row._id, table);
      }
    }
  }

  rows(table: string) {
    const state = this.tableState(table);
    if (!state) return [];
    state.array ??= [...state.rows.values()];
    return state.array;
  }

  listRows(table: string, args?: LocalArgs) {
    return scopedLocalRows(this.rows(table), args);
  }

  getRow(table: string, id: string | undefined) {
    if (!id) return undefined;
    return this.tableState(table)?.rows.get(id);
  }

  tableOf(id: string) {
    return this.idTables.get(id);
  }

  rowsWhere(table: string, field: string, value: unknown) {
    if (value === null || (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean")) return undefined;
    const state = this.tableState(table);
    if (!state) return [];
    let index = state.indexes.get(field);
    if (!index) {
      index = new Map();
      for (const row of state.rows.values()) {
        const key = row[field];
        if (key === undefined || key === null || typeof key === "object") continue;
        const bucket = index.get(key);
        if (bucket) bucket.push(row);
        else index.set(key, [row]);
      }
      state.indexes.set(field, index);
    }
    return index.get(value) ?? [];
  }

  externalFields(table: string, id: string) {
    return this.external.get(localRecordKey(table, id));
  }

  /** Externalized fields of these rows (LocalRowStore contract); values are fresh copies. */
  async loadExternalFields(table: string, ids: string[]) {
    const out = new Map<string, Record<string, unknown>>();
    const keys = ids.map((id) => localRecordKey(table, id));
    const stored = this.db ? await this.db.recordFields.bulkGet(keys) : [];
    keys.forEach((key, index) => {
      const fields = this.external.get(key);
      if (!fields?.length) return;
      // IndexedDB hands back fresh copies; values still in flight are shared, so copy them.
      const pending = this.pendingHeavy.get(key);
      const merged = { ...(stored[index]?.fields ?? {}), ...(pending ? cloneLocalRow(pending) : {}) };
      const value: Record<string, unknown> = {};
      for (const field of fields) if (field in merged) value[field] = merged[field];
      out.set(ids[index], value);
    });
    return out;
  }

  /* --------------------------------- writes -------------------------------- */

  upsertRow(table: string, row: any) {
    if (!row?._id) return null;
    const op: RowStoreOp = { kind: "upsert", table, row };
    this.legacyOps.add(op);
    this.applyLegacyOp(op);
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
    this.applyLegacyOp({ kind: "delete", table, id });
    return previous;
  }

  /** Legacy row API: apply to the cache now, persist in the background. */
  private applyLegacyOp(op: RowStoreOp) {
    if (this.atomicBatchOps) {
      // Inside transactionAsync: buffer; the batch commits (or rolls back) as one.
      this.recordUndo(op.table, op.kind === "delete" ? op.id : op.row._id);
      const prepared = this.prepareOps([op]);
      this.applyPrepared(prepared);
      this.atomicBatchOps.push(op);
      this.scheduleNotify([op.table]);
      return;
    }
    void this.commitBatch([op]).catch((error) => {
      console.warn("[societyer-local] background write failed", error);
    });
  }

  private recordUndo(table: string, id: string) {
    const key = localRecordKey(table, id);
    if (!this.atomicUndo || this.atomicUndo.has(key)) return;
    this.atomicUndo.set(key, { table, id, row: this.getRow(table, id), external: this.external.get(key), pending: this.pendingHeavy.get(key) });
  }

  private restoreUndo(undo: Map<string, UndoEntry>) {
    for (const [key, entry] of undo) {
      if (entry.row) this.setCachedRow(entry.table, entry.row);
      else this.deleteCachedRow(entry.table, entry.id);
      if (entry.external) this.external.set(key, entry.external);
      else this.external.delete(key);
      if (entry.pending) this.pendingHeavy.set(key, entry.pending);
      else this.pendingHeavy.delete(key);
    }
  }

  transaction<T>(mutate: () => T): T {
    this.transactionDepth += 1;
    try {
      return mutate();
    } finally {
      this.transactionDepth -= 1;
      if (this.transactionDepth === 0 && this.pendingChanged !== undefined) this.notify();
    }
  }

  async transactionAsync<T>(mutate: () => T | Promise<T>): Promise<T> {
    if (this.atomicBatchOps) return await mutate();

    this.atomicBatchOps = [];
    this.atomicUndo = new Map();
    this.transactionDepth += 1;
    try {
      const result = await mutate();
      const ops = this.atomicBatchOps;
      const undo = this.atomicUndo;
      this.atomicBatchOps = null;
      this.atomicUndo = null;
      this.restoreUndo(undo);
      await this.commitBatch(ops);
      return result;
    } catch (error) {
      if (this.atomicUndo) this.restoreUndo(this.atomicUndo);
      this.atomicBatchOps = null;
      this.atomicUndo = null;
      throw error;
    } finally {
      this.transactionDepth -= 1;
      if (this.transactionDepth === 0 && this.pendingChanged !== undefined) this.notify();
    }
  }

  /** Table names currently held in the cache (LocalRowStore contract). */
  tableNames(): string[] {
    return [...this.tables.keys()];
  }

  private get splitsHeavyFields() {
    return this.db !== null;
  }

  private prepareOps(ops: RowStoreOp[]): PreparedOp[] {
    return ops.map((op) => {
      if (op.kind === "delete") return { kind: "delete", table: op.table, id: op.id, key: localRecordKey(op.table, op.id) };
      const key = localRecordKey(op.table, op.row._id);
      const { light, heavy } = this.splitsHeavyFields ? splitHeavyFields(op.table, op.row) : { light: op.row, heavy: null };
      const carried = this.legacyOps.has(op)
        ? (this.external.get(key) ?? []).filter((field) => !Object.prototype.hasOwnProperty.call(op.row, field))
        : [];
      return {
        kind: "upsert",
        table: op.table,
        id: op.row._id,
        key,
        light,
        heavy,
        carried,
        external: [...carried, ...Object.keys(heavy ?? {})],
      };
    });
  }

  private applyPrepared(prepared: PreparedOp[]) {
    for (const op of prepared) {
      if (op.kind === "delete") {
        this.deleteCachedRow(op.table, op.id);
        this.external.delete(op.key);
        this.pendingHeavy.delete(op.key);
        continue;
      }
      this.setCachedRow(op.table, op.light);
      if (op.external.length) this.external.set(op.key, op.external);
      else this.external.delete(op.key);
      if (op.heavy) this.pendingHeavy.set(op.key, op.heavy);
      else this.pendingHeavy.delete(op.key);
    }
  }

  /**
   * Apply a batch of writes ATOMICALLY (LocalRowStore contract, used by the
   * portable mutation adapter). Every op is persisted in a single Dexie `rw`
   * transaction and the in-memory cache rolls back if the persist fails, so a
   * multi-table mutation never commits partially.
   */
  async commitBatch(ops: RowStoreOp[]): Promise<void> {
    if (!ops.length) return;

    const undo = new Map<string, UndoEntry>();
    for (const op of ops) {
      const id = op.kind === "delete" ? op.id : op.row._id;
      const key = localRecordKey(op.table, id);
      if (!undo.has(key)) undo.set(key, { table: op.table, id, row: this.getRow(op.table, id), external: this.external.get(key), pending: this.pendingHeavy.get(key) });
    }
    const prepared = this.prepareOps(ops);

    // Apply to the in-memory cache up front (reads see the new state immediately).
    this.applyPrepared(prepared);
    if (this.preHydrationOps) this.preHydrationOps.push(...ops);

    const changes: LocalChangeEnvelope[] = [];
    const now = new Date().toISOString();
    for (const op of prepared) {
      const societyId = op.kind === "delete" ? undo.get(op.key)?.row?.societyId : op.light.societyId;
      changes.push({
        table: op.table,
        id: op.id,
        societyId,
        op: op.kind === "delete" ? "delete" : "upsert",
        createdAtISO: now,
        mutationId: `${op.table}:${op.id}:${Date.now()}`,
      });
    }

    // Persistence policy: broken at startup => memory-only session; broken mid-session => fail the mutation.
    if (this.db) {
      const db = this.db;
      try {
        await db.open();
        await db.transaction("rw", [db.records, db.recordFields, db.changes], async () => {
          for (const op of prepared) {
            if (op.kind === "delete") {
              const previous = undo.get(op.key)?.row;
              await db.records.put(localDeletedRecord(op.table, { _id: op.id, societyId: previous?.societyId, ...(previous ?? {}) }));
              await db.recordFields.delete(op.key);
              continue;
            }
            await db.records.put(localRecord(op.table, op.light, false, op.external));
            if (op.carried.length) {
              const existing = await db.recordFields.get(op.key);
              const fields: Record<string, unknown> = {};
              for (const field of op.carried) if (existing && field in existing.fields) fields[field] = existing.fields[field];
              Object.assign(fields, op.heavy ?? {});
              if (Object.keys(fields).length) await db.recordFields.put({ key: op.key, table: op.table, id: op.id, fields });
              else await db.recordFields.delete(op.key);
            } else if (op.heavy) {
              await db.recordFields.put({ key: op.key, table: op.table, id: op.id, fields: op.heavy });
            } else {
              await db.recordFields.delete(op.key);
            }
          }
          await db.changes.bulkAdd(changes);
          await this.prunePersistedChangesIfNeeded();
        });
      } catch (error) {
        // Roll the cache back to its pre-batch state so memory matches storage.
        this.restoreUndo(undo);
        throw error;
      }
      for (const op of prepared) if (op.kind === "upsert" && op.heavy && this.pendingHeavy.get(op.key) === op.heavy) this.pendingHeavy.delete(op.key);
    }

    this.changesCache.push(...changes);
    this.pruneChangesCacheIfNeeded();
    this.scheduleNotify(prepared.map((op) => op.table));
  }

  /**
   * Full snapshot including every heavy field (backups, in-place migrations).
   * Rows are fresh top-level objects, so callers may edit them freely.
   */
  async exportSnapshot(): Promise<LocalWorkspaceSnapshot> {
    await this.whenHydrated();
    const tables: LocalSeed = {};
    for (const table of this.tables.keys()) {
      const rows = this.rows(table);
      const heavyIds = rows.filter((row) => this.external.has(localRecordKey(table, row._id))).map((row) => row._id);
      const heavy = heavyIds.length ? await this.loadExternalFields(table, heavyIds) : new Map<string, Record<string, unknown>>();
      tables[table] = rows.map((row) => ({ ...row, ...(heavy.get(row._id) ?? {}) }));
    }
    return {
      kind: "societyer.localWorkspaceSnapshot" as const,
      exportedAtISO: new Date().toISOString(),
      workspace: { ...this.workspaceMeta, updatedAtISO: new Date().toISOString() },
      tables,
      attachments: cloneLocalRows(this.attachmentsCache),
      changes: cloneLocalRows(this.changesCache),
    };
  }

  async readRestoredFile(args: { sha256?: string; provider?: string; storageKey?: string; documentId?: string; versionId?: string }) {
    await this.whenHydrated();
    const key = args.sha256 ? `sha256:${args.sha256}` : args.versionId ? `version:${args.versionId}` : args.documentId ? `document:${args.documentId}` : JSON.stringify([args.provider, args.storageKey]);
    const reference = this.db ? await this.db.files.get(key) : this.filesCache.find(file => file.key === key);
    if (!reference) return undefined;
    const file = reference.blob ? reference : this.db ? await this.db.files.get(`sha256:${reference.sha256}`) : this.filesCache.find(file => file.key === `sha256:${reference.sha256}`);
    return file?.blob;
  }

  exportAttachmentReferences() { return cloneLocalRows(this.attachmentsCache); }

  async importSnapshot(snapshot: LocalWorkspaceSnapshot | { tables?: LocalSeed; attachments?: LocalAttachmentEnvelope[]; workspace?: Partial<LocalWorkspaceMeta> }, files: LocalWorkspaceBinaryFile[] = [], preserveFiles = false) {
    const importedTables = quarantineImportedPathways(stripImportedAuthBindings(validateSnapshotTables(snapshot?.tables)));
    const importedAttachments = validateSnapshotAttachments(snapshot?.attachments);
    if (files.some(file => !file.key || !/^[a-f0-9]{64}$/.test(file.sha256) || (file.blob !== undefined && !(file.blob instanceof Blob)))) throw new Error("Invalid restored file data.");
    const importedChanges = Array.isArray((snapshot as any).changes) ? (snapshot as any).changes : [];
    if (importedChanges.length > 10_000 || importedChanges.some((change: any) => !change || typeof change.table !== "string" || typeof change.id !== "string" || !["upsert", "delete", "seed"].includes(change.op) || typeof change.createdAtISO !== "string")) throw new Error("Invalid backup change history.");
    const history = importedChanges.map((change: any) => { const { seq, ...value } = cloneLocalRow(change); return value; });
    // Startup may still be reading the previous vault or writing its seed. A
    // restore must finish after that work, otherwise hydration can overwrite
    // the restored cache, metadata or attachment references after we report
    // success. Validate first so invalid backups never wait for or write storage.
    await this.whenHydrated();
    const normalizedMeta = normalizeWorkspaceMeta(snapshot?.workspace, this.workspaceMeta);
    // Validation never mutates the input, and migration builds new top-level
    // rows, so no extra JSON copy of large embedded content is needed.
    const importedCache = migrateLocalWorkspaceSnapshotTables(importedTables, false);
    const importedMeta: LocalWorkspaceMeta = {
      ...normalizedMeta,
      schemaVersion: Math.max(normalizedMeta.schemaVersion, CURRENT_LOCAL_WORKSPACE_SCHEMA_VERSION),
      updatedAtISO: new Date().toISOString(),
    };
    const importChange = createLocalChange("__workspace", { _id: importedMeta.id }, "seed", {
      reason: "import-snapshot",
      snapshot: { tableCount: Object.keys(importedCache).length, attachmentCount: importedAttachments.length },
    });
    let committedImportChange = importChange;

    const split = this.db ? splitSeed(importedCache) : { light: importedCache, records: [], fields: [], external: new Map<string, string[]>() };
    if (this.db) {
      const db = this.db;
      await db.open();
      await db.transaction(
        "rw",
        [db.meta, db.records, db.recordFields, db.changes, db.attachments, db.meetings, db.minutes, db.files],
        async () => {
          await db.meta.clear();
          await db.records.clear();
          await db.recordFields.clear();
          await db.changes.clear();
          await db.attachments.clear();
          await db.meetings.clear();
          await db.minutes.clear();
          if (!preserveFiles) await db.files.clear();

          if (split.records.length) await db.records.bulkPut(split.records);
          if (split.fields.length) await db.recordFields.bulkPut(split.fields);
          if (importedAttachments.length) await db.attachments.bulkPut(cloneLocalRows(importedAttachments));
          if (files.length) await db.files.bulkPut(files);
          if (history.length) await db.changes.bulkAdd(history);
          await db.meta.bulkPut([
            { key: "schemaVersion", value: importedMeta.schemaVersion },
            { key: "workspace", value: importedMeta },
            { key: "storageLayout", value: CURRENT_LOCAL_STORAGE_LAYOUT },
          ]);
          const seq = await db.changes.add(importChange);
          committedImportChange = { ...importChange, seq };
        },
      );
    }

    this.loadTables(split.light);
    this.external = new Map(split.external);
    this.pendingHeavy = new Map();
    this.attachmentsCache = importedAttachments;
    if (!preserveFiles) this.filesCache = files;
    this.changesCache = [...history, committedImportChange];
    this.workspaceMeta = importedMeta;
    this.notify(null);
  }

  upsertAttachment(attachment: Omit<LocalAttachmentEnvelope, "key" | "createdAtISO" | "updatedAtISO"> & { key?: string; createdAtISO?: string; updatedAtISO?: string }) {
    const now = new Date().toISOString();
    const row: LocalAttachmentEnvelope = {
      ...attachment,
      key: attachment.key ?? localAttachmentKey(attachment.versionId ?? attachment.documentId ?? attachment.storageKey, attachment.storageKey),
      createdAtISO: attachment.createdAtISO ?? now,
      updatedAtISO: now,
    };
    const index = this.attachmentsCache.findIndex((candidate) => candidate.key === row.key);
    this.attachmentsCache = index === -1 ? [...this.attachmentsCache, row] : this.attachmentsCache.map((candidate, i) => (i === index ? row : candidate));
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
    this.loadTables(cloneLocalSeed(this.seed));
    this.external = new Map();
    this.pendingHeavy = new Map();
    if (!this.db) {
      this.notify(null);
      return;
    }
    await this.db.open();
    await Promise.all([
      this.db.meta.clear(),
      this.db.records.clear(),
      this.db.recordFields.clear(),
      this.db.changes.clear(),
      this.db.attachments.clear(),
      this.db.meetings.clear(),
      this.db.minutes.clear(),
      this.db.files.clear(),
    ]);
    this.filesCache = [];
    await this.writeSeed(this.seed);
    this.notify(null);
  }

  /* --------------------------------- startup ------------------------------- */

  private async hydrate(seed: LocalSeed) {
    if (!this.db) return;
    const db = this.db;

    await db.open();
    if ((await db.records.count()) === 0) {
      const [legacyMeetings, legacyMinutes] = await Promise.all([
        db.meetings.toArray(),
        db.minutes.toArray(),
      ]);
      await this.writeSeed({
        ...seed,
        meetings: legacyMeetings.length ? legacyMeetings : seed.meetings,
        minutes: legacyMinutes.length ? legacyMinutes : seed.minutes,
      });
    } else {
      await this.migrateStorageLayout();
      await this.putMissingSeedRows(seed);
    }

    // Bound journals created before the cap was introduced before hydrating them.
    await db.transaction("rw", db.changes, async () => {
      await this.prunePersistedChangesIfNeeded();
    });

    // Boot reads LIGHT rows only: heavy fields stay in `recordFields`.
    const [localRecords, attachments, changes, workspaceMeta] = await Promise.all([
      db.records.toArray(),
      db.attachments.toArray(),
      db.changes.toArray(),
      db.meta.get("workspace"),
    ]);
    const next = cloneLocalSeed(seed);
    const seedIndex = new Map<string, Map<string, number>>();
    for (const [table, rows] of Object.entries(next)) seedIndex.set(table, new Map(rows.map((row, index) => [row._id, index])));
    const external = new Map<string, readonly string[]>();
    const persisted = new Map<string, Map<string, any>>();
    for (const record of localRecords) {
      if (!record?.table || !record?.value?._id) continue;
      const id = record.value._id;
      if (record.deletedAtISO) {
        persisted.get(record.table)?.delete(id);
        const index = seedIndex.get(record.table)?.get(id);
        if (index !== undefined) next[record.table][index] = undefined;
        continue;
      }
      let table = persisted.get(record.table);
      if (!table) persisted.set(record.table, (table = new Map()));
      table.set(id, record.value);
      if (record.external?.length) external.set(record.key, record.external);
    }
    // Seed rows first (in seed order) unless overridden, then persisted rows in key order.
    const merged: LocalSeed = {};
    for (const [table, rows] of Object.entries(next)) {
      const overrides = persisted.get(table);
      merged[table] = rows
        .filter((row) => row !== undefined)
        .map((row) => {
          const override = overrides?.get(row._id);
          if (override) overrides!.delete(row._id);
          return override ?? row;
        });
    }
    for (const [table, rows] of persisted) {
      (merged[table] ??= []).push(...rows.values());
    }

    const persistedWorkspaceMeta = normalizeWorkspaceMeta(workspaceMeta?.value, this.workspaceMeta);
    let hydratedCache = merged;
    let hydratedWorkspaceMeta = persistedWorkspaceMeta;
    if (persistedWorkspaceMeta.schemaVersion < CURRENT_LOCAL_WORKSPACE_SCHEMA_VERSION) {
      hydratedCache = migrateLocalWorkspaceSnapshotTables(merged);
      hydratedWorkspaceMeta = {
        ...persistedWorkspaceMeta,
        schemaVersion: CURRENT_LOCAL_WORKSPACE_SCHEMA_VERSION,
        updatedAtISO: new Date().toISOString(),
      };
      const migratedRecords = Object.entries(hydratedCache).flatMap(([table, rows]) =>
        rows.filter((row) => row?._id).map((row) => localRecord(table, row, false, external.get(localRecordKey(table, row._id)) as string[] | undefined)),
      );
      await db.transaction("rw", [db.meta, db.records], async () => {
        if (migratedRecords.length) await db.records.bulkPut(migratedRecords);
        await db.meta.bulkPut([
          { key: "schemaVersion", value: CURRENT_LOCAL_WORKSPACE_SCHEMA_VERSION },
          { key: "workspace", value: hydratedWorkspaceMeta },
        ]);
      });
    }

    this.loadTables(hydratedCache);
    this.external = external;
    // Replay anything written while this read was in flight, so a mutation
    // issued during startup survives hydration.
    const replay = this.preHydrationOps ?? [];
    this.preHydrationOps = null;
    if (replay.length) this.applyPrepared(this.prepareOps(replay));

    this.attachmentsCache = cloneLocalRows(attachments);
    this.changesCache = changes;
    this.workspaceMeta = hydratedWorkspaceMeta;
    this.notify(null);
  }

  /**
   * Layout 1 → 2: move heavy field values out of `records` into `recordFields`,
   * a bounded chunk at a time (never the whole table in memory), and stop
   * mirroring rows into the legacy v1 meetings/minutes stores. Idempotent, so an
   * interrupted upgrade simply resumes on the next start.
   */
  private async migrateStorageLayout() {
    const db = this.db!;
    const layout = Number((await db.meta.get("storageLayout"))?.value ?? 1);
    if (layout >= CURRENT_LOCAL_STORAGE_LAYOUT) return;
    for (const table of Object.keys(HEAVY_FIELD_POLICY)) {
      const keys = await db.records.where("table").equals(table).primaryKeys();
      for (let start = 0; start < keys.length; start += LAYOUT_MIGRATION_CHUNK) {
        const chunk = keys.slice(start, start + LAYOUT_MIGRATION_CHUNK);
        await db.transaction("rw", [db.records, db.recordFields], async () => {
          const envelopes = await db.records.bulkGet(chunk);
          const records: LocalRecordEnvelope[] = [];
          const fields: LocalRecordFieldsEnvelope[] = [];
          for (const envelope of envelopes) {
            if (!envelope?.value?._id || envelope.deletedAtISO) continue;
            const { light, heavy } = splitHeavyFields(table, envelope.value);
            if (!heavy) continue;
            const external = [...new Set([...(envelope.external ?? []), ...Object.keys(heavy)])];
            records.push({ ...envelope, value: light, external });
            fields.push({ key: envelope.key, table, id: envelope.id, fields: heavy });
          }
          if (records.length) await db.records.bulkPut(records);
          if (fields.length) await db.recordFields.bulkPut(fields);
        });
      }
    }
    await db.transaction("rw", [db.meta, db.meetings, db.minutes], async () => {
      // `records` is authoritative once it has rows; the v1 mirrors are only
      // read to upgrade a database whose `records` store is still empty.
      await db.meetings.clear();
      await db.minutes.clear();
      await db.meta.put({ key: "storageLayout", value: CURRENT_LOCAL_STORAGE_LAYOUT });
    });
  }

  private async writeSeed(seed: LocalSeed) {
    if (!this.db) return;
    const db = this.db;
    const split = splitSeed(seed);
    await db.transaction("rw", [db.meta, db.records, db.recordFields], async () => {
      if (split.records.length) await db.records.bulkPut(split.records);
      if (split.fields.length) await db.recordFields.bulkPut(split.fields);
      await db.meta.bulkPut([
        { key: "schemaVersion", value: CURRENT_LOCAL_WORKSPACE_SCHEMA_VERSION },
        { key: "workspace", value: this.workspaceMeta },
        { key: "storageLayout", value: CURRENT_LOCAL_STORAGE_LAYOUT },
      ]);
    });
  }

  private async putMissingSeedRows(seed: LocalSeed) {
    if (!this.db) return;
    const candidates: Array<{ table: string; row: any }> = [];
    for (const [table, rows] of Object.entries(seed)) {
      for (const row of rows) if (row?._id) candidates.push({ table, row });
    }
    if (!candidates.length) return;
    const existing = await this.db.records.bulkGet(candidates.map(({ table, row }) => localRecordKey(table, row._id)));
    const missing: LocalSeed = {};
    candidates.forEach(({ table, row }, index) => {
      if (!existing[index]) (missing[table] ??= []).push(row);
    });
    const split = splitSeed(missing);
    if (split.records.length) await this.db.records.bulkPut(split.records);
    if (split.fields.length) await this.db.recordFields.bulkPut(split.fields);
  }

  private appendChange(table: string, row: any, op: LocalChangeEnvelope["op"], metadata?: Pick<LocalChangeEnvelope, "mutationId" | "reason" | "snapshot">) {
    const change = createLocalChange(table, row, op, metadata);
    this.changesCache.push(change);
    this.pruneChangesCacheIfNeeded();
    if (!this.db) return undefined;
    return this.db.transaction("rw", this.db.changes, async () => {
      change.seq = await this.db!.changes.add(change);
      await this.prunePersistedChangesIfNeeded();
    });
  }

  private pruneChangesCacheIfNeeded() {
    if (this.changesCache.length <= LOCAL_CHANGE_JOURNAL_CAP + LOCAL_CHANGE_JOURNAL_PRUNE_SLACK) return;
    this.changesCache.splice(0, this.changesCache.length - LOCAL_CHANGE_JOURNAL_CAP);
  }

  private async prunePersistedChangesIfNeeded() {
    if (!this.db) return;
    const count = await this.db.changes.count();
    if (count <= LOCAL_CHANGE_JOURNAL_CAP + LOCAL_CHANGE_JOURNAL_PRUNE_SLACK) return;
    const oldestKeys = await this.db.changes
      .orderBy(":id")
      .limit(count - LOCAL_CHANGE_JOURNAL_CAP)
      .primaryKeys();
    await this.db.changes.bulkDelete(oldestKeys);
  }

  /* ------------------------------ notification ----------------------------- */

  private notify(changed?: Set<string> | null) {
    const pending = this.pendingChanged;
    this.pendingChanged = undefined;
    let tables: Set<string> | null;
    if (changed === null || pending === null) tables = null;
    else {
      tables = new Set(pending ?? []);
      for (const table of changed ?? []) tables.add(table);
      if (changed === undefined && pending === undefined) tables = null;
    }
    for (const listener of this.listeners) {
      try {
        listener(tables ?? undefined);
      } catch (error) {
        console.error("[societyer-local] local row store listener failed", error);
      }
    }
  }

  private scheduleNotify(tables: Iterable<string>) {
    if (this.transactionDepth > 0) {
      if (this.pendingChanged !== null) {
        this.pendingChanged ??= new Set();
        for (const table of tables) this.pendingChanged.add(table);
      }
      return;
    }
    this.notify(new Set(tables));
  }
}

/** Split seed/snapshot tables into light records, side records and the external map. */
function splitSeed(seed: LocalSeed) {
  const light: LocalSeed = {};
  const records: LocalRecordEnvelope[] = [];
  const fields: LocalRecordFieldsEnvelope[] = [];
  const external = new Map<string, string[]>();
  for (const [table, rows] of Object.entries(seed)) {
    if (!Array.isArray(rows)) continue;
    const out: any[] = [];
    for (const row of rows) {
      if (!row?._id) continue;
      const split = splitHeavyFields(table, row);
      out.push(split.light);
      const key = localRecordKey(table, row._id);
      const externalFields = split.heavy ? Object.keys(split.heavy) : undefined;
      records.push(localRecord(table, split.light, false, externalFields));
      if (split.heavy) {
        fields.push({ key, table, id: row._id, fields: split.heavy });
        external.set(key, externalFields!);
      }
    }
    light[table] = out;
  }
  return { light, records, fields, external };
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

/**
 * Structural validation only. The input is never mutated downstream
 * (sanitizers and migration build new top-level rows), so it is not copied:
 * a deep JSON copy of a 200 MB backup doubled the peak memory of a restore.
 */
function validateSnapshotTables(value: unknown): LocalSeed {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Local workspace snapshot is missing tables.");
  }
  const tables: LocalSeed = {};
  for (const [table, rows] of Object.entries(value)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(table) || ["constructor", "prototype", "__proto__"].includes(table)) {
      throw new Error("Local workspace snapshot contains an invalid table name.");
    }
    if (!Array.isArray(rows)) {
      throw new Error(`Local workspace snapshot table "${table}" is not an array.`);
    }
    const ids = new Set<string>();
    for (const row of rows) {
      if (!row || typeof row !== "object" || Array.isArray(row) || typeof row._id !== "string" || !row._id || row._id.length > 300 || ids.has(row._id)) {
        throw new Error(`Local workspace snapshot table "${table}" contains an invalid or duplicate record.`);
      }
      ids.add(row._id);
    }
    tables[table] = rows;
  }
  return tables;
}

function validateSnapshotAttachments(value: unknown): LocalAttachmentEnvelope[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error("Local workspace snapshot attachments are not an array.");
  const keys = new Set<string>();
  for (const attachment of value) {
    if (
      !attachment ||
      typeof attachment !== "object" ||
      Array.isArray(attachment) ||
      typeof attachment.key !== "string" || !attachment.key || keys.has(attachment.key) ||
      typeof attachment.provider !== "string" || !attachment.provider ||
      typeof attachment.storageKey !== "string" || !attachment.storageKey ||
      (attachment.fileSizeBytes !== undefined && (!Number.isSafeInteger(attachment.fileSizeBytes) || attachment.fileSizeBytes < 0))
    ) {
      throw new Error("Local workspace snapshot contains an invalid attachment.");
    }
    keys.add(attachment.key);
  }
  return cloneLocalRows(value as LocalAttachmentEnvelope[]);
}

function createLocalChange(
  table: string,
  row: { _id: string; societyId?: string },
  op: LocalChangeEnvelope["op"],
  metadata?: Pick<LocalChangeEnvelope, "mutationId" | "reason" | "snapshot">,
): LocalChangeEnvelope {
  return {
    table,
    id: row._id,
    societyId: row.societyId,
    op,
    createdAtISO: new Date().toISOString(),
    mutationId: metadata?.mutationId ?? `${table}:${row._id}:${Date.now()}`,
    reason: metadata?.reason,
    snapshot: metadata?.snapshot,
  };
}

export function migrateLocalWorkspaceSnapshotTables(seed: LocalSeed, copy = true): LocalSeed {
  const migrated = copy ? cloneLocalSeed(seed) : { ...seed };
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
  const entityIdFactory = createEntityIdFactory();
  const semanticSubjectTables = new Set(["activity", "notes", "signatures", "customFieldValues"]);
  for (const [table, rows] of Object.entries(migrated)) {
    if (!Array.isArray(rows)) continue;
    migrated[table] = rows.map((row) => {
      if (!row || typeof row !== "object" || Array.isArray(row)) return row;
      const legacySubjectId = typeof row.entityId === "string" && row.entityId ? row.entityId : undefined;
      const subjectId =
        semanticSubjectTables.has(table) && !(typeof row.subjectId === "string" && row.subjectId)
          ? legacySubjectId
          : row.subjectId;
      return {
        ...row,
        ...(semanticSubjectTables.has(table) ? { subjectId } : {}),
        entityId: legacySubjectId ?? entityIdFactory.mint(table),
      };
    });
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

export function localRecord(table: string, row: any, copy = true, external?: readonly string[]): LocalRecordEnvelope {
  return {
    key: localRecordKey(table, row._id),
    table,
    id: row._id,
    societyId: row.societyId,
    updatedAtISO: row.updatedAtISO,
    deletedAtISO: row.deletedAtISO,
    value: copy ? cloneLocalRow(row) : row,
    ...(external?.length ? { external: [...external] } : {}),
  };
}

export function localAttachmentKey(ownerId: string | undefined, storageKey: string) {
  return `${ownerId ?? "attachment"}:${storageKey}`;
}

function normalizeWorkspaceMeta(value: Partial<LocalWorkspaceMeta> | undefined, fallback: LocalWorkspaceMeta): LocalWorkspaceMeta {
  const now = new Date().toISOString();
  const schemaVersion = Number(value?.schemaVersion ?? fallback.schemaVersion);
  return {
    id: String(value?.id ?? fallback.id),
    name: String(value?.name ?? fallback.name),
    schemaVersion: Number.isFinite(schemaVersion) && schemaVersion >= 1 ? schemaVersion : fallback.schemaVersion,
    createdAtISO: String(value?.createdAtISO ?? fallback.createdAtISO ?? now),
    updatedAtISO: String(value?.updatedAtISO ?? now),
  };
}

export function localDeletedRecord(table: string, row: any): LocalRecordEnvelope {
  const deletedAtISO = row.deletedAtISO ?? new Date().toISOString();
  return {
    ...localRecord(table, { ...row, deletedAtISO }, false),
    deletedAtISO,
  };
}
