import type { LocalDexieDatabase } from "./localDexieDatabase";
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
  /** Row revision, renewed on every write (projection memos). Absent = the data epoch. */
  rev?: string;
};

/** A persisted `collectProjected` result for one row at one revision. */
export type LocalProjectionEnvelope = {
  key: string;
  table: string;
  rev: string;
  value: unknown;
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
      rev: string;
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
  /** recordKey → revision of rows written since the data epoch began. */
  private revisions = new Map<string, string>();
  /**
   * Revision shared by every row not rewritten since the vault's data was
   * (re)loaded wholesale. Persisted in meta and renewed by restore/reseed, so
   * projection memos computed before a restore can never match restored rows.
   */
  private dataEpoch = newRevisionToken();
  private revisionCounter = 0;
  /** Unique per store instance, so revisions written in different sessions never collide. */
  private readonly sessionToken = newRevisionToken();
  /** Namespace for persisted projection memos (a build id); undefined = memory only. */
  private projectionNamespace: string | undefined;
  private projectionWrites = new Set<Promise<void>>();
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
  /** Resolves to the opened vault (null when IndexedDB is unavailable or failed). */
  private dbReady: Promise<LocalDexieDatabase | null> | null = null;
  /** Whether rows are persisted (heavy fields are split out only then). */
  private persistent = false;

  constructor(seed: LocalSeed, options?: { databaseName?: string; logLabel?: string; projectionNamespace?: string }) {
    this.projectionNamespace = options?.projectionNamespace;
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

    this.persistent = true;
    this.preHydrationOps = [];
    // Dexie loads with the vault (SU-11): writes issued before it arrives await `database()`.
    const opening = import("./localDexieDatabase").then(({ LocalDexieDatabase }) => {
      this.db = new LocalDexieDatabase(options?.databaseName ?? "societyer-local-workspace");
      return this.db;
    });
    this.dbReady = opening.catch(() => null);
    this.hydrated = opening.then(() => this.hydrate(seed)).catch((error) => {
      this.db?.close();
      this.db = null;
      this.persistent = false;
      this.dbReady = Promise.resolve(null);
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

  private loadTableMaps(tableMaps: Map<string, Map<string, any>>) {
    this.tables = new Map();
    this.idTables = new Map();
    for (const [table, rows] of tableMaps) {
      this.tables.set(table, { rows, array: null, indexes: new Map() });
      for (const id of rows.keys()) this.idTables.set(id, table);
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

  /**
   * Compound equality index over primitive field values, built on first use
   * and dropped when the table changes. Non-primitive values fall back to a scan.
   */
  rowsWhere(table: string, fields: readonly string[], values: readonly unknown[]) {
    if (!values.every(isIndexableValue)) return undefined;
    const state = this.tableState(table);
    if (!state) return [];
    const indexName = fields.join("\u0000");
    let index = state.indexes.get(indexName);
    if (!index) {
      index = new Map();
      for (const row of state.rows.values()) {
        const key = indexKey(fields.map((field) => row[field]));
        if (key === undefined) continue;
        const bucket = index.get(key);
        if (bucket) bucket.push(row);
        else index.set(key, [row]);
      }
      state.indexes.set(indexName, index);
    }
    return index.get(indexKey(values)) ?? [];
  }

  /** Opaque row version for projection memos (LocalRowStore contract). */
  rowRevision(table: string, id: string) {
    const key = localRecordKey(table, id);
    if (!this.tableState(table)?.rows.has(id)) return undefined;
    return this.revisions.get(key) ?? `e:${this.dataEpoch}`;
  }

  private nextRevision() {
    return `${this.sessionToken}.${(++this.revisionCounter).toString(36)}`;
  }

  async loadProjections(key: string, table: string, ids: string[]) {
    const out = new Map<string, { rev: string; value: unknown }>();
    if (!this.db || !this.projectionNamespace || !ids.length) return out;
    try {
      const rows = await this.db.projections.bulkGet(ids.map((id) => projectionKey(key, table, id)));
      rows.forEach((row, index) => {
        if (row) out.set(ids[index], { rev: row.rev, value: row.value });
      });
    } catch {
      // A memo is only an optimisation; recompute on any storage problem.
    }
    return out;
  }

  saveProjections(key: string, table: string, entries: Array<{ id: string; rev: string; value: unknown }>) {
    if (!this.db || !this.projectionNamespace || !entries.length) return;
    const rows = entries.map((entry) => ({ key: projectionKey(key, table, entry.id), table, rev: entry.rev, value: entry.value }));
    const write = this.db.projections.bulkPut(rows).then(() => undefined, () => undefined);
    this.projectionWrites.add(write);
    void write.finally(() => this.projectionWrites.delete(write));
  }

  /** Resolves once every projection memo handed to `saveProjections` is durable. */
  async flushProjections() {
    while (this.projectionWrites.size) await Promise.all([...this.projectionWrites]);
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
    return this.persistent;
  }

  /** The vault once it is open; null when this session is memory-only. */
  private async database(): Promise<LocalDexieDatabase | null> {
    if (this.db) return this.db;
    if (!this.dbReady) return null;
    return (await this.dbReady) ?? null;
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
        rev: this.nextRevision(),
      };
    });
  }

  private applyPrepared(prepared: PreparedOp[]) {
    for (const op of prepared) {
      if (op.kind === "delete") {
        this.deleteCachedRow(op.table, op.id);
        this.revisions.delete(op.key);
        this.external.delete(op.key);
        this.pendingHeavy.delete(op.key);
        continue;
      }
      this.setCachedRow(op.table, op.light);
      this.revisions.set(op.key, op.rev);
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
    const db = this.db ?? await this.database();
    if (db) {
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
            await db.records.put({ ...localRecord(op.table, op.light, false, op.external), rev: op.rev });
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
    await this.flushProjections();
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

  /**
   * Synchronous snapshot for runtimes whose rows are all in memory (Node
   * scripts, a session without IndexedDB). Throws when heavy fields are lazy:
   * a backup must never silently omit them — use `exportSnapshot()`.
   */
  exportSnapshotSync(): LocalWorkspaceSnapshot {
    if (this.external.size) {
      throw new Error("Some fields of this workspace are stored outside memory; export it with exportSnapshot().");
    }
    const tables: LocalSeed = {};
    for (const table of this.tables.keys()) tables[table] = this.rows(table).map((row) => ({ ...row }));
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
    await this.database();
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
    const nextEpoch = newRevisionToken();
    if (this.db) {
      const db = this.db;
      await db.open();
      await db.transaction(
        "rw",
        [db.meta, db.records, db.recordFields, db.projections, db.changes, db.attachments, db.meetings, db.minutes, db.files],
        async () => {
          await db.meta.clear();
          await db.records.clear();
          await db.recordFields.clear();
          await db.projections.clear();
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
            { key: "dataEpoch", value: nextEpoch },
          ]);
          const seq = await db.changes.add(importChange);
          committedImportChange = { ...importChange, seq };
        },
      );
    }

    this.loadTables(split.light);
    this.external = new Map(split.external);
    this.revisions = new Map();
    this.dataEpoch = nextEpoch;
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
    const stored = cloneLocalRow(row);
    void (this.db ? Promise.resolve(this.db) : this.database()).then((db) => db?.attachments.put(stored));
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
    await this.database();
    this.loadTables(cloneLocalSeed(this.seed));
    this.external = new Map();
    this.pendingHeavy = new Map();
    this.revisions = new Map();
    this.dataEpoch = newRevisionToken();
    if (!this.db) {
      this.notify(null);
      return;
    }
    await this.db.open();
    await Promise.all([
      this.db.meta.clear(),
      this.db.records.clear(),
      this.db.recordFields.clear(),
      this.db.projections.clear(),
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
    const started = now();

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

    const readStarted = now();
    // Boot reads LIGHT rows only: heavy fields stay in `recordFields`.
    const [localRecords, attachments, changes, workspaceMeta] = await Promise.all([
      db.records.toArray(),
      db.attachments.toArray(),
      db.changes.toArray(),
      db.meta.get("workspace"),
    ]);
    // One pass, straight into per-table maps: seed rows first (in seed order;
    // `this.seed` is a private copy and cached rows are never mutated), then each
    // persisted record overrides in place or is appended in key order.
    const tableMaps = new Map<string, Map<string, any>>();
    for (const [table, rows] of Object.entries(this.seed)) {
      const rowsById = new Map<string, any>();
      for (const row of rows) if (row?._id) rowsById.set(row._id, row);
      tableMaps.set(table, rowsById);
    }
    const external = new Map<string, readonly string[]>();
    const revisions = new Map<string, string>();
    for (const record of localRecords) {
      if (!record?.table || !record?.value?._id) continue;
      const id = record.value._id;
      let rowsById = tableMaps.get(record.table);
      if (record.deletedAtISO) {
        rowsById?.delete(id);
        continue;
      }
      if (!rowsById) tableMaps.set(record.table, (rowsById = new Map()));
      rowsById.set(id, record.value);
      if (record.external?.length) external.set(record.key, record.external);
      if (record.rev) revisions.set(record.key, record.rev);
    }

    const persistedWorkspaceMeta = normalizeWorkspaceMeta(workspaceMeta?.value, this.workspaceMeta);
    let hydratedCache: LocalSeed | null = null;
    let hydratedWorkspaceMeta = persistedWorkspaceMeta;
    if (persistedWorkspaceMeta.schemaVersion < CURRENT_LOCAL_WORKSPACE_SCHEMA_VERSION) {
      const merged: LocalSeed = {};
      for (const [table, rowsById] of tableMaps) merged[table] = [...rowsById.values()];
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

    if (hydratedCache) this.loadTables(hydratedCache);
    else this.loadTableMaps(tableMaps);
    this.external = external;
    this.revisions = revisions;
    this.dataEpoch = await this.persistedDataEpoch();
    // Replay anything written while this read was in flight, so a mutation
    // issued during startup survives hydration.
    const replay = this.preHydrationOps ?? [];
    this.preHydrationOps = null;
    if (replay.length) this.applyPrepared(this.prepareOps(replay));

    this.attachmentsCache = cloneLocalRows(attachments);
    this.changesCache = changes;
    this.workspaceMeta = hydratedWorkspaceMeta;
    recordBootTiming({ totalMs: now() - started, readMs: now() - readStarted, records: localRecords.length });
    this.notify(null);
  }

  /**
   * The vault's data epoch (see `dataEpoch`), created on first use. Projection
   * memos from another build are dropped here, since their logic may differ.
   */
  private async persistedDataEpoch() {
    const db = this.db!;
    const [epoch, namespace] = await Promise.all([db.meta.get("dataEpoch"), db.meta.get("projectionNamespace")]);
    const value = typeof epoch?.value === "string" && epoch.value ? epoch.value : newRevisionToken();
    const writes: Array<{ key: string; value: unknown }> = [];
    if (value !== epoch?.value) writes.push({ key: "dataEpoch", value });
    if (this.projectionNamespace && namespace?.value !== this.projectionNamespace) {
      await db.projections.clear();
      writes.push({ key: "projectionNamespace", value: this.projectionNamespace });
    }
    if (writes.length) await db.meta.bulkPut(writes);
    return value;
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
        { key: "dataEpoch", value: this.dataEpoch },
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
    const persist = (db: LocalDexieDatabase) => db.transaction("rw", db.changes, async () => {
      change.seq = await db.changes.add(change);
      await this.prunePersistedChangesIfNeeded();
    });
    if (this.db) return persist(this.db);
    if (!this.dbReady) return undefined;
    return this.database().then((db) => (db ? persist(db) : undefined));
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

function newRevisionToken() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function projectionKey(key: string, table: string, id: string) {
  return `${key}|${table}:${id}`;
}

function now() {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

/**
 * Boot diagnostics for the perf scripts (scripts/perf/): how long the vault
 * took to read and how many light records it held. Read via
 * `globalThis.__SOCIETYER_LOCAL_BOOT__`; nothing else depends on it.
 */
function recordBootTiming(timing: { totalMs: number; readMs: number; records: number }) {
  (globalThis as { __SOCIETYER_LOCAL_BOOT__?: unknown }).__SOCIETYER_LOCAL_BOOT__ = {
    totalMs: Math.round(timing.totalMs),
    readMs: Math.round(timing.readMs),
    records: timing.records,
  };
}

function isIndexableValue(value: unknown) {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

/** Index key for a tuple of primitive values; undefined when a value is not indexable. */
function indexKey(values: readonly unknown[]): unknown {
  if (values.length === 1) return isIndexableValue(values[0]) ? values[0] : undefined;
  let key = "";
  for (const value of values) {
    if (!isIndexableValue(value)) return undefined;
    key += `${typeof value}:${String(value).length}:${String(value)}|`;
  }
  return key;
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
