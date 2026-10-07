/**
 * LOCAL-STORE ADAPTER for the portable `ctx.db` contract.
 *
 * Implements PortableDbWriter over a minimal row-store interface (`LocalRowStore`)
 * that Societyer's `LocalDexieRowStore` satisfies. This is the browser-local AND
 * Electron-local `ctx.db` — one engine, two hosts.
 *
 * What this adds over the raw row store:
 *   1. Real query semantics (index eq/range constraints, predicate filters,
 *      ordering, cursor pagination) via the SAME evaluator the oracle uses, so
 *      the local engine interprets the contract identically to Convex.
 *   2. ATOMIC transactions with read-your-writes: writes buffer in an overlay and
 *      flush in one batch (`commitBatch`); a throw discards the overlay so nothing
 *      partially commits.
 *   3. Scale (WP-K): when the store offers them, it uses the store's id → table
 *      map, per-row lookup and equality indexes instead of scanning, and it
 *      loads LAZY HEAVY FIELDS (shared/portable/heavyFields.ts) only for the rows
 *      a handler actually returns — never for a field it projected away with
 *      `omitFields(...)`. Results are identical to a store that keeps every row
 *      fully in memory; the conformance matrix runs both.
 *   4. Read tracking: `readView()` records which tables a query read, so the
 *      browser query cache re-runs only queries whose tables changed.
 *
 * Depends on nothing heavy (no Dexie, no Convex), so the Node test harness runs
 * it directly. The real Dexie store is plugged in by satisfying `LocalRowStore`.
 */

import type {
  PortableDbReader,
  PortableDbWriter,
  PortableDoc,
  PortableGetOptions,
  PortableQuery,
  SearchFilterBuilder,
  TableName,
} from "./ctx";
import { collectSearch, evaluateQuery, evaluateSearch, matchesConstraints, sortByCreation, type MemoryDbOptions, type SearchSpec } from "./memoryDb";
import { createEntityIdFactory } from "./ids";
import {
  DEFAULT_HEAVY_FIELD_POLICY,
  guardedLightRow,
  HeavyFieldNotLoaded,
  omitRowFields,
  splitHeavyFields,
  type HeavyFieldPolicy,
} from "./heavyFields";

/** Atomic write operation flushed by `commitBatch`. */
export type RowStoreOp =
  | { kind: "upsert"; table: string; row: PortableDoc }
  | { kind: "delete"; table: string; id: string };

/**
 * The surface the adapter needs from a row store. The three required members
 * are enough for correctness; the optional ones make the adapter scale and are
 * used whenever present.
 */
export interface LocalRowStore {
  /** Every row of a table, in insertion order. Rows may be "light" (see externalFields). */
  rows(table: string): PortableDoc[];
  tableNames(): string[];
  /** Apply all ops atomically (single backing transaction) and update cache. Rows are complete. */
  commitBatch(ops: RowStoreOp[]): Promise<void> | void;
  /** O(1) row lookup. */
  getRow?(table: string, id: string): PortableDoc | undefined;
  /** The table holding an id, if any. */
  tableOf?(id: string): string | undefined;
  /**
   * Candidate rows whose top-level `fields` equal `values` (a compound equality
   * index). May return a superset; `undefined` means "no index, scan instead".
   */
  rowsWhere?(table: string, fields: readonly string[], values: readonly unknown[]): PortableDoc[] | undefined;
  /** Top-level fields of this row that live outside the cached row (lazy heavy fields). */
  externalFields?(table: string, id: string): readonly string[] | undefined;
  /** Load the externalized fields of these rows: id → { field: value }. */
  loadExternalFields?(table: string, ids: string[]): Promise<Map<string, Record<string, unknown>>>;
  /**
   * Opaque version of a stored row: changes whenever the row is written. Lets
   * the adapter memoize `collectProjected` results; undefined disables memos.
   */
  rowRevision?(table: string, id: string): string | undefined;
  /** Persisted projection memos (survive reloads): id → { rev, value }. */
  loadProjections?(key: string, table: string, ids: string[]): Promise<Map<string, { rev: string; value: unknown }>>;
  saveProjections?(key: string, table: string, entries: Array<{ id: string; rev: string; value: unknown }>): void;
  /**
   * Deferred tables: rows of these tables are read from storage on first use instead of at boot, so a
   * workspace's archive-scale staging (AI intake runs, field provenance) costs nothing on pages that never
   * read it. Until `ensureTables` resolves for a table, `rows`/`getRow`/`rowsWhere`/`tableOf` do not see
   * its stored rows; the adapter awaits `ensureTables` before every read of one, and before resolving an id
   * it cannot place. `commitBatch` loads a deferred table before writing to it.
   */
  isDeferred?(table: string): boolean;
  hasDeferredTables?(): boolean;
  ensureTables?(tables?: readonly string[]): Promise<void>;
}

/** Tables a local store may hydrate on first use (see `LocalRowStore.isDeferred`). */
export const DEFERRED_HYDRATION_TABLES: readonly string[] = Object.freeze([
  "intakeRuns", "intakeFiles", "intakeClusters", "intakeExtracts", "intakeExtractions", "intakeFieldReviews", "intakeProcessingLog", "fieldProvenance",
]);

/** Rows loaded and projected per step of a `collectProjected` miss. */
const PROJECTION_CHUNK = 250;

/** Short stable hash of a projection's source, so edited logic never reuses old memos. */
function sourceHash(fn: (...args: any[]) => unknown) {
  const text = fn.toString();
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

type Overlay = Map<TableName, Map<string, PortableDoc | null>>;
type Constraint = { op: "eq" | "gt" | "gte" | "lt" | "lte"; field: string; value: unknown };

/** Receives every table a tracked read touched; "*" means "could be any table". */
export type ReadRecorder = (table: string | "*") => void;

class LocalQueryBuilder<T extends PortableDoc> implements PortableQuery<T> {
  private constraints: Constraint[] = [];
  private predicates: ((doc: T) => boolean)[] = [];
  private direction: "asc" | "desc" = "asc";
  private search: SearchSpec | null = null;
  private omitted: string[] = [];

  constructor(
    private readonly db: LocalStoreDb,
    private readonly table: TableName,
  ) {}

  withIndex(_indexName: string, range?: (q: any) => any): PortableQuery<T> {
    if (range) {
      const self = this;
      const builder: any = {
        eq: (field: string, value: unknown) => (self.constraints.push({ op: "eq", field, value }), builder),
        gt: (field: string, value: unknown) => (self.constraints.push({ op: "gt", field, value }), builder),
        gte: (field: string, value: unknown) => (self.constraints.push({ op: "gte", field, value }), builder),
        lt: (field: string, value: unknown) => (self.constraints.push({ op: "lt", field, value }), builder),
        lte: (field: string, value: unknown) => (self.constraints.push({ op: "lte", field, value }), builder),
      };
      range(builder);
    }
    return this;
  }

  withSearchIndex(_indexName: string, search: (q: SearchFilterBuilder) => SearchFilterBuilder): PortableQuery<T> {
    this.search = collectSearch(search);
    return this;
  }

  filter(predicate: (doc: T) => boolean): PortableQuery<T> {
    this.predicates.push(predicate);
    return this;
  }

  order(direction: "asc" | "desc"): PortableQuery<T> {
    this.direction = direction;
    return this;
  }

  omitFields(...fields: string[]): PortableQuery<T> {
    this.omitted.push(...fields);
    return this;
  }

  private run(): Promise<T[]> {
    return this.db.evaluate<T>(this.table, {
      constraints: this.constraints,
      predicates: this.predicates,
      direction: this.direction,
      search: this.search,
    });
  }

  private output(rows: T[]): Promise<T[]> {
    return this.db.materialize(this.table, rows, this.omitted);
  }

  async collectProjected<R>(key: string, project: (doc: T) => R): Promise<R[]> {
    return this.db.projectRows(this.table, await this.run(), this.omitted, key, project);
  }

  async collect(): Promise<T[]> {
    return this.output(await this.run());
  }
  async take(n: number): Promise<T[]> {
    return this.output((await this.run()).slice(0, n));
  }
  async first(): Promise<T | null> {
    const row = (await this.run())[0];
    return row ? (await this.output([row]))[0] : null;
  }
  async unique(): Promise<T | null> {
    const rows = await this.run();
    if (rows.length > 1) throw new Error("unique() found more than one matching document");
    return rows[0] ? (await this.output([rows[0]]))[0] : null;
  }
  async paginate(opts: { numItems: number; cursor: string | null }) {
    const rows = await this.run();
    const start = opts.cursor ? Number(opts.cursor) : 0;
    const page = await this.output(rows.slice(start, start + opts.numItems));
    const nextStart = start + opts.numItems;
    const isDone = nextStart >= rows.length;
    return { page, isDone, continueCursor: isDone ? "" : String(nextStart) };
  }
}

/**
 * Detach a row from the store with the exact semantics of
 * `JSON.parse(JSON.stringify(value))` for JSON data (undefined object keys
 * dropped, undefined/functions in arrays become null, non-finite numbers become
 * null, `toJSON` honoured), without re-serialising strings. Strings are
 * immutable, so sharing them is safe; the JSON round trip used to re-scan every
 * string, which dominated large workspaces (a 10k-document table with long OCR
 * text took seconds per query).
 */
export function jsonClone<T>(value: T): T {
  return cloneJsonValue(value, true) as T;
}

function cloneJsonValue(value: any, topLevel = false): any {
  if (value === null) return null;
  switch (typeof value) {
    case "string":
    case "boolean":
      return value;
    case "number":
      return Number.isFinite(value) ? (Object.is(value, -0) ? 0 : value) : null;
    case "bigint":
      throw new TypeError("Do not know how to serialize a BigInt");
    case "undefined":
    case "function":
    case "symbol":
      return topLevel ? undefined : SKIP;
    default:
      break;
  }
  if (typeof value.toJSON === "function") return cloneJsonValue(value.toJSON(), topLevel);
  if (Array.isArray(value)) {
    const out = new Array(value.length);
    for (let i = 0; i < value.length; i++) {
      const item = cloneJsonValue(value[i]);
      out[i] = item === SKIP ? null : item;
    }
    return out;
  }
  if (value instanceof Number || value instanceof String || value instanceof Boolean) return cloneJsonValue(value.valueOf(), topLevel);
  const out: Record<string, any> = {};
  for (const key of Object.keys(value)) {
    const item = cloneJsonValue(value[key]);
    if (item !== SKIP) out[key] = item;
  }
  return out;
}

const SKIP = Symbol("skip");

function clone<T>(value: T): T {
  return jsonClone(value);
}

export interface LocalStoreDbOptions {
  mintId?: (table: string) => string;
  now?: () => number;
}

export class LocalStoreDb implements PortableDbWriter {
  private readonly store: LocalRowStore;
  private readonly mintId: (table: string) => string;
  private readonly mintEntityId: (table: string) => string;
  private readonly now: () => number;
  private overlay: Overlay | null = null;
  /** Set only on a read view (see `readView`). */
  private recorder: ReadRecorder | null = null;
  private base: LocalStoreDb | null = null;

  constructor(store: LocalRowStore, options: LocalStoreDbOptions = {}) {
    this.store = store;
    this.now = options.now ?? (() => Date.now());
    const factory = createEntityIdFactory({ now: this.now });
    this.mintId = options.mintId ?? ((table) => factory.mint(table));
    this.mintEntityId = (table) => factory.mint(table);
  }

  /**
   * A read-only view that reports every table it reads. Used by the browser
   * query cache to learn a query's dependencies. Reads see the same overlay as
   * this db (queries never run inside a mutation transaction in practice).
   */
  readView(recorder: ReadRecorder): PortableDbReader {
    const view = Object.create(this) as LocalStoreDb;
    view.recorder = recorder;
    view.base = this;
    return {
      get: (id, expectedTable, options) => view.get(id, expectedTable, options),
      query: (table) => view.query(table),
    };
  }

  private get activeOverlay(): Overlay | null {
    return this.base ? this.base.overlay : this.overlay;
  }

  private record(table: string | "*") {
    this.recorder?.(table);
  }

  /** Light rows that may satisfy the constraints (overlay-merged). */
  private candidateRows(table: TableName, constraints: Constraint[]): PortableDoc[] {
    const over = this.activeOverlay?.get(table);
    let base: PortableDoc[] | undefined;
    if (this.store.rowsWhere) {
      const fields: string[] = [];
      const values: unknown[] = [];
      for (const constraint of constraints) {
        if (constraint.op !== "eq" || fields.includes(constraint.field)) continue;
        fields.push(constraint.field);
        values.push(constraint.value);
      }
      if (fields.length) base = this.store.rowsWhere(table, fields, values);
    }
    base ??= this.store.rows(table);
    if (!over || over.size === 0) return base;
    const byId = new Map<string, PortableDoc>();
    for (const row of base) byId.set(row._id, row);
    for (const [id, doc] of over) {
      if (doc === null) byId.delete(id);
      else byId.set(id, doc);
    }
    return [...byId.values()];
  }

  /** Lazy fields of a row that is not (yet) overlaid by this transaction. */
  private externalOf(table: TableName, row: PortableDoc): readonly string[] | undefined {
    if (!this.store.externalFields) return undefined;
    const over = this.activeOverlay?.get(table);
    if (over?.has(row._id)) return undefined;
    const fields = this.store.externalFields(table, row._id);
    return fields && fields.length ? fields : undefined;
  }

  /**
   * Evaluate a query over light rows. A row whose lazy fields are touched by a
   * constraint, predicate or search is loaded first and evaluated again, so the
   * outcome equals evaluation over complete rows.
   */
  // Deferred tables are loaded inline (`if (…) await …`), never through an extra async hop: a read that needs
  // no load keeps exactly the microtask timing it had, so concurrent reads settle in the same order.

  async evaluate<T extends PortableDoc>(
    table: TableName,
    query: {
      constraints: Constraint[];
      predicates: ((doc: T) => boolean)[];
      direction: "asc" | "desc";
      search: SearchSpec | null;
    },
  ): Promise<T[]> {
    this.record(table);
    if (this.store.isDeferred?.(table)) await this.store.ensureTables!([table]);
    const candidates = this.candidateRows(table, query.constraints) as T[];
    if (!query.search && this.store.externalFields) {
      // Index/predicate query over rows that may be light: evaluate each row
      // once (constraints, then predicates, as evaluateQuery does), on a guard
      // when it has lazy fields; rows whose evaluation touched a lazy field are
      // loaded and evaluated again in full. Survivors get the standard order.
      const matches = (doc: T) =>
        matchesConstraints(doc, query.constraints) && query.predicates.every((predicate) => predicate(doc));
      const passed: T[] = [];
      const toLoad: T[] = [];
      for (const row of candidates) {
        const external = this.externalOf(table, row);
        if (!external) {
          if (matches(row)) passed.push(row);
          continue;
        }
        try {
          if (matches(guardedLightRow(row, external))) passed.push(row);
        } catch (error) {
          if (!(error instanceof HeavyFieldNotLoaded)) throw error;
          toLoad.push(row);
        }
      }
      if (toLoad.length) {
        for (const row of await this.withExternalFields(table, toLoad)) if (matches(row)) passed.push(row);
      }
      return sortByCreation(passed, query.direction);
    }
    const needsGuard =
      Boolean(this.store.externalFields) &&
      (query.predicates.length > 0 || query.search !== null || query.constraints.length > 0);

    let rows: T[] = candidates;
    const unwrap = new Map<T, T>();
    if (needsGuard) {
      const toLoad: T[] = [];
      const guarded: T[] = [];
      for (const row of candidates) {
        const external = this.externalOf(table, row);
        if (!external) {
          guarded.push(row);
          continue;
        }
        const proxy = guardedLightRow(row, external);
        try {
          // Probe exactly what the evaluator will read.
          if (query.search) {
            for (const eq of query.search.eqs) void (proxy as any)[eq.field];
            void (proxy as any)[query.search.field];
          } else if (!matchesConstraints(proxy, query.constraints)) {
            guarded.push(proxy);
            unwrap.set(proxy, row);
            continue;
          }
          for (const predicate of query.predicates) if (!predicate(proxy)) break;
          guarded.push(proxy);
          unwrap.set(proxy, row);
        } catch (error) {
          if (!(error instanceof HeavyFieldNotLoaded)) throw error;
          toLoad.push(row);
        }
      }
      if (toLoad.length) {
        const loaded = await this.withExternalFields(table, toLoad);
        // Loaded rows are complete; they no longer need a guard.
        for (const row of loaded) guarded.push(row);
      }
      rows = guarded;
    }

    const evaluated = query.search
      ? evaluateSearch(rows, query.search, query.predicates)
      : evaluateQuery(rows, query.constraints, query.predicates, query.direction);
    return unwrap.size ? evaluated.map((row) => unwrap.get(row) ?? row) : evaluated;
  }

  /** Rows with every lazy field filled in (rows without lazy fields pass through). */
  /**
   * Load the lazy fields these rows still lack (and the handler did not project
   * away). Returns id → fields; values are owned by the caller (fresh copies).
   */
  private async loadMissingFields(table: TableName, rows: PortableDoc[], omitted: readonly string[] = []) {
    if (!this.store.externalFields || !this.store.loadExternalFields) return null;
    const ids: string[] = [];
    for (const row of rows) {
      const external = this.externalOf(table, row);
      if (external?.some((field) => !omitted.includes(field) && !Object.prototype.hasOwnProperty.call(row, field))) ids.push(row._id);
    }
    if (!ids.length) return null;
    return this.store.loadExternalFields(table, ids);
  }

  /** Rows with every lazy field filled in (rows without lazy fields pass through). */
  private async withExternalFields<T extends PortableDoc>(table: TableName, rows: T[]): Promise<T[]> {
    const loaded = await this.loadMissingFields(table, rows);
    if (!loaded) return rows;
    return rows.map((row) => {
      const fields = loaded.get(row._id);
      return fields ? ({ ...row, ...fields } as T) : row;
    });
  }

  /**
   * Copies of rows for the handler, with the lazy fields it did not project
   * away. Freshly loaded heavy values are not copied a second time.
   */
  /** Memoized projections: projection key → record key → { rev, value }. Shared by read views. */
  private projectionMemo = new Map<string, Map<string, { rev: string; value: unknown }>>();
  /** Tail of the in-flight projection runs per key: concurrent runs reuse each other's work. */
  private projectionQueue = new Map<string, Promise<void>>();

  /** Revision of a stored row as seen by this db, or undefined when it cannot be memoized. */
  private revisionOf(table: TableName, row: PortableDoc): string | undefined {
    if (!this.store.rowRevision) return undefined;
    if (this.activeOverlay?.get(table)?.has(row._id)) return undefined;
    return this.store.rowRevision(table, row._id);
  }

  /**
   * `collectProjected`: reuse a memoized projection while the row's revision is
   * unchanged (in memory, then from the store's persisted memos), and load +
   * project only the rows that changed. The heavy fields of a hit are never read.
   */
  async projectRows<T extends PortableDoc, R>(
    table: TableName,
    rows: T[],
    omitted: readonly string[],
    key: string,
    project: (doc: T) => R,
  ): Promise<R[]> {
    const fullKey = `${key}#${sourceHash(project)}${omitted.length ? `#-${[...omitted].sort().join(",")}` : ""}`;
    const root = this.base ?? this;
    // Serialize runs of the same projection (two components mounting the same
    // list at once): the second finds the first one's results in the memo.
    const previous = root.projectionQueue.get(fullKey) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => (release = resolve));
    const tail = previous.then(() => current);
    root.projectionQueue.set(fullKey, tail);
    await previous;
    try {
      return await this.projectRowsNow(root, fullKey, table, rows, omitted, project);
    } finally {
      release();
      if (root.projectionQueue.get(fullKey) === tail) root.projectionQueue.delete(fullKey);
    }
  }

  private async projectRowsNow<T extends PortableDoc, R>(
    root: LocalStoreDb,
    fullKey: string,
    table: TableName,
    rows: T[],
    omitted: readonly string[],
    project: (doc: T) => R,
  ): Promise<R[]> {
    let memo = root.projectionMemo.get(fullKey);
    if (!memo) root.projectionMemo.set(fullKey, (memo = new Map()));
    const out = new Array<R>(rows.length);
    const revisions = rows.map((row) => this.revisionOf(table, row));
    let misses: number[] = [];
    rows.forEach((row, index) => {
      const rev = revisions[index];
      const hit = rev === undefined ? undefined : memo!.get(row._id);
      if (hit && hit.rev === rev) out[index] = hit.value as R;
      else misses.push(index);
    });
    const persistable = misses.filter((index) => revisions[index] !== undefined);
    if (persistable.length && this.store.loadProjections) {
      const stored = await this.store.loadProjections(fullKey, table, persistable.map((index) => rows[index]._id));
      misses = misses.filter((index) => {
        const entry = stored.get(rows[index]._id);
        if (!entry || entry.rev !== revisions[index]) return true;
        out[index] = entry.value as R;
        memo!.set(rows[index]._id, entry);
        return false;
      });
    }
    // Load and project the misses a chunk at a time: only one chunk of heavy
    // values is alive at once, which bounds peak memory on a first visit.
    for (let start = 0; start < misses.length; start += PROJECTION_CHUNK) {
      const chunk = misses.slice(start, start + PROJECTION_CHUNK);
      const complete = await this.materialize(table, chunk.map((index) => rows[index]), omitted);
      const toSave: Array<{ id: string; rev: string; value: unknown }> = [];
      chunk.forEach((index, position) => {
        const value = project(complete[position]);
        out[index] = value;
        const rev = revisions[index];
        if (rev === undefined) return;
        memo!.set(rows[index]._id, { rev, value });
        toSave.push({ id: rows[index]._id, rev, value });
      });
      if (toSave.length) this.store.saveProjections?.(fullKey, table, toSave);
    }
    // Memoized values are shared; hand the handler its own copy.
    return out.map((value) => jsonClone(value));
  }

  async materialize<T extends PortableDoc>(table: TableName, rows: T[], omitted: readonly string[]): Promise<T[]> {
    const loaded = await this.loadMissingFields(table, rows, omitted);
    return rows.map((row) => {
      const copy = clone(row);
      const fields = loaded?.get(row._id);
      if (fields) for (const field of Object.keys(fields)) if (!omitted.includes(field)) copy[field as keyof T] = fields[field] as any;
      return omitRowFields(copy, omitted);
    });
  }

  private findTableOf(id: string): TableName | undefined {
    const overlay = this.activeOverlay;
    if (overlay) {
      for (const [table, over] of overlay) if (over.has(id)) return over.get(id) === null ? undefined : table;
    }
    if (this.store.tableOf) return this.store.tableOf(id);
    // Stores without an id map: minted ids carry their table as a prefix
    // ("documents_01M…"), so try that table before scanning the others.
    const tables = this.store.tableNames();
    const separator = typeof id === "string" ? id.indexOf("_") : -1;
    const guess = separator > 0 ? id.slice(0, separator) : undefined;
    if (guess && tables.includes(guess) && this.store.rows(guess).some((row) => row._id === id)) return guess;
    for (const table of tables) {
      if (table !== guess && this.store.rows(table).some((row) => row._id === id)) return table;
    }
    return undefined;
  }

  private baseRow(table: TableName, id: string): PortableDoc | undefined {
    const over = this.activeOverlay?.get(table);
    if (over?.has(id)) return over.get(id) ?? undefined;
    if (this.store.getRow) return this.store.getRow(table, id);
    return this.store.rows(table).find((r) => r._id === id);
  }

  async get<T extends PortableDoc = PortableDoc>(id: string, expectedTable?: TableName, options?: PortableGetOptions): Promise<T | null> {
    if (expectedTable && this.store.isDeferred?.(expectedTable)) await this.store.ensureTables!([expectedTable]);
    let table = this.findTableOf(id);
    // An id the store cannot place may belong to a deferred table: load those, then look again (unless a
    // minted id names a table that is not deferred: "documents_01M...").
    if (!table && !expectedTable && this.store.hasDeferredTables?.() && this.mayBeDeferredId(id)) {
      await this.store.ensureTables!();
      table = this.findTableOf(id);
    }
    if (!table) {
      this.record(expectedTable ?? "*");
      return null;
    }
    this.record(table);
    if (expectedTable && table !== expectedTable) {
      this.record(expectedTable);
      return null;
    }
    const row = this.baseRow(table, id);
    if (!row) return null;
    const [complete] = await this.materialize(table, [row], options?.omitFields ?? []);
    return complete as T;
  }

  query<T extends PortableDoc = PortableDoc>(table: TableName): PortableQuery<T> {
    return new LocalQueryBuilder<T>(this, table);
  }

  private requireOverlay(): Map<TableName, Map<string, PortableDoc | null>> {
    if (this.base) throw new Error("A read view cannot write");
    if (!this.overlay) throw new Error("Mutations must run inside db.transaction()");
    return this.overlay;
  }

  private overlayFor(table: TableName): Map<string, PortableDoc | null> {
    const overlay = this.requireOverlay();
    let map = overlay.get(table);
    if (!map) {
      map = new Map();
      overlay.set(table, map);
    }
    return map;
  }

  async insert(table: TableName, doc: Record<string, any>): Promise<string> {
    const _id = typeof doc._id === "string" && doc._id ? doc._id : this.mintId(table);
    const entityId = typeof doc.entityId === "string" && doc.entityId ? doc.entityId : this.mintEntityId(table);
    const row: PortableDoc = { _creationTime: this.now(), ...doc, _id, entityId };
    this.overlayFor(table).set(_id, clone(row));
    return _id;
  }

  async patch(id: string, patch: Record<string, any>): Promise<void> {
    const existing = await this.get(id);
    if (!existing) throw new Error(`patch: document ${id} not found`);
    const table = this.findTableOf(id)!;
    this.overlayFor(table).set(id, { ...existing, ...patch, _id: id });
  }

  /** False when a minted id's prefix names a table that is loaded (not deferred). */
  private mayBeDeferredId(id: string) {
    const separator = typeof id === "string" ? id.indexOf("_") : -1;
    if (separator <= 0) return true;
    const prefix = id.slice(0, separator);
    return !this.store.tableNames().includes(prefix) || Boolean(this.store.isDeferred?.(prefix));
  }

  async replace(id: string, doc: Record<string, any>): Promise<void> {
    let table = this.findTableOf(id);
    if (!table && this.store.hasDeferredTables?.()) {
      await this.store.ensureTables!();
      table = this.findTableOf(id);
    }
    if (!table) throw new Error(`replace: document ${id} not found`);
    this.overlayFor(table).set(id, { ...doc, _id: id });
  }

  async delete(id: string): Promise<void> {
    let table = this.findTableOf(id);
    if (!table && this.store.hasDeferredTables?.()) {
      await this.store.ensureTables!();
      table = this.findTableOf(id);
    }
    if (!table) return;
    this.overlayFor(table).set(id, null);
  }

  /** Tail of the transaction queue — see transaction() below. */
  private txQueue: Promise<unknown> = Promise.resolve();

  /**
   * Atomic transaction. Writes accumulate in an overlay; on success they flush
   * as one batch; on throw the overlay is discarded — nothing partially commits.
   *
   * Transactions are SERIALIZED. Concurrent independent mutations used to be
   * mistaken for "nested" ones (detected via overlay presence) and joined the
   * in-flight transaction's overlay: their writes then committed, rolled back,
   * or were silently dropped with the OUTER mutation while their own promise
   * resolved successfully — real user saves racing background backfill
   * mutations lost data. Genuinely nested calls (ctx.runMutation inside a
   * handler) no longer come through here; PortableRuntime runs them directly
   * inside the current transaction.
   */
  async transaction<T>(body: () => Promise<T>): Promise<T> {
    const run = async (): Promise<T> => {
      this.overlay = new Map();
      try {
        const result = await body();
        const ops = this.drainOverlay();
        await this.store.commitBatch(ops);
        return result;
      } finally {
        this.overlay = null;
      }
    };
    const result = this.txQueue.then(run, run);
    // Keep the queue alive regardless of this transaction's outcome.
    this.txQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private drainOverlay(): RowStoreOp[] {
    const ops: RowStoreOp[] = [];
    for (const [table, over] of this.overlay ?? []) {
      for (const [id, doc] of over) {
        if (doc === null) ops.push({ kind: "delete", table, id });
        else ops.push({ kind: "upsert", table, row: doc });
      }
    }
    return ops;
  }
}

export interface MemoryRowStoreOptions {
  /**
   * Keep heavy fields out of the row cache, exactly like the browser store, so
   * the Node harness can prove lazy loading never changes a result. Pass
   * `{ ...DEFAULT_HEAVY_FIELD_POLICY, minLength: 0 }` to externalize aggressively.
   */
  heavyFields?: HeavyFieldPolicy | boolean;
  /** Offer the optional fast-path members (lookup, id → table, equality index). */
  indexed?: boolean;
  /** Hold these tables' seeded rows back until `ensureTables` (deferred hydration, as the browser store). */
  deferredTables?: readonly string[];
}

/**
 * Reference `LocalRowStore` for tests — plain in-memory maps with an atomic
 * `commitBatch`. Lets the Node harness exercise the LocalStoreDb code path
 * (overlay, batch flush, rollback, and optionally lazy heavy fields + indexes)
 * without Dexie/IndexedDB.
 */
export class MemoryRowStore implements LocalRowStore {
  private tables = new Map<string, Map<string, PortableDoc>>();
  private heavy = new Map<string, Map<string, Record<string, unknown>>>();
  private readonly policy: HeavyFieldPolicy | null;
  getRow?: (table: string, id: string) => PortableDoc | undefined;
  tableOf?: (id: string) => string | undefined;
  rowsWhere?: (table: string, fields: readonly string[], values: readonly unknown[]) => PortableDoc[] | undefined;
  externalFields?: (table: string, id: string) => readonly string[] | undefined;
  loadExternalFields?: (table: string, ids: string[]) => Promise<Map<string, Record<string, unknown>>>;
  /** Number of rows whose heavy fields were loaded (test observability). */
  externalLoads = 0;
  private revisions = new Map<string, number>();
  private revisionCounter = 0;
  rowRevision?: (table: string, id: string) => string | undefined;

  /** Deferred tables not loaded yet: their seeded rows. */
  private stash = new Map<string, PortableDoc[]>();
  /** Number of deferred-table loads (test observability). */
  deferredLoads = 0;
  isDeferred?: (table: string) => boolean;
  hasDeferredTables?: () => boolean;
  ensureTables?: (tables?: readonly string[]) => Promise<void>;

  constructor(seed: Record<string, PortableDoc[]> = {}, options: MemoryRowStoreOptions = {}) {
    this.policy = options.heavyFields === true ? DEFAULT_HEAVY_FIELD_POLICY : options.heavyFields || null;
    const deferred = new Set(options.deferredTables ?? []);
    for (const [table, rows] of Object.entries(seed)) {
      if (deferred.has(table)) { this.stash.set(table, rows.map(clone)); continue; }
      for (const row of rows) this.put(table, clone(row));
    }
    if (deferred.size) {
      for (const table of deferred) if (!this.stash.has(table)) this.stash.set(table, []);
      this.isDeferred = (table) => this.stash.has(table);
      this.hasDeferredTables = () => this.stash.size > 0;
      this.ensureTables = async (tables) => {
        for (const table of tables ?? [...this.stash.keys()]) {
          const rows = this.stash.get(table);
          if (!rows) continue;
          this.stash.delete(table);
          this.deferredLoads += 1;
          // Rows written before the load win over stored ones.
          for (const row of rows) if (!this.tables.get(table)?.has(row._id)) this.put(table, row);
        }
      };
    }
    if (options.indexed || this.policy) {
      this.getRow = (table, id) => {
        const row = this.tables.get(table)?.get(id);
        return row ? clone(row) : undefined;
      };
      this.tableOf = (id) => {
        for (const [table, rows] of this.tables) if (rows.has(id)) return table;
        return undefined;
      };
      this.rowsWhere = (table, fields, values) => {
        const out: PortableDoc[] = [];
        for (const row of this.tables.get(table)?.values() ?? []) {
          if (fields.every((field, index) => row[field] === values[index])) out.push(clone(row));
        }
        return out;
      };
    }
    if (options.indexed || this.policy) {
      this.rowRevision = (table, id) => {
        const rev = this.revisions.get(`${table}:${id}`);
        return rev === undefined ? undefined : String(rev);
      };
    }
    if (this.policy) {
      this.externalFields = (table, id) => {
        const fields = this.heavy.get(table)?.get(id);
        return fields ? Object.keys(fields) : undefined;
      };
      this.loadExternalFields = async (table, ids) => {
        const out = new Map<string, Record<string, unknown>>();
        for (const id of ids) {
          const fields = this.heavy.get(table)?.get(id);
          if (!fields) continue;
          this.externalLoads += 1;
          out.set(id, clone(fields));
        }
        return out;
      };
    }
  }

  private put(table: string, row: PortableDoc) {
    let map = this.tables.get(table);
    if (!map) {
      map = new Map();
      this.tables.set(table, map);
    }
    const { light, heavy } = this.policy ? splitHeavyFields(table, row, this.policy) : { light: row, heavy: null };
    map.set(row._id, light);
    this.revisions.set(`${table}:${row._id}`, ++this.revisionCounter);
    if (heavy) {
      let fields = this.heavy.get(table);
      if (!fields) this.heavy.set(table, (fields = new Map()));
      fields.set(row._id, heavy);
    } else {
      this.heavy.get(table)?.delete(row._id);
    }
  }

  rows(table: string): PortableDoc[] {
    return [...(this.tables.get(table)?.values() ?? [])].map(clone);
  }

  /** Complete rows, externalized heavy fields included (test/debug helper; deferred tables included). */
  fullRows(table: string): PortableDoc[] {
    if (this.stash.has(table)) return this.stash.get(table)!.map(clone);
    return [...(this.tables.get(table)?.values() ?? [])].map((row) => clone({ ...row, ...(this.heavy.get(table)?.get(row._id) ?? {}) }));
  }

  tableNames(): string[] {
    return [...new Set([...this.tables.keys(), ...this.stash.keys()])];
  }

  commitBatch(ops: RowStoreOp[]): void {
    // A write to a deferred table loads it first (synchronously here: the stash is in memory).
    for (const op of ops) {
      const rows = this.stash.get(op.table);
      if (!rows) continue;
      this.stash.delete(op.table);
      this.deferredLoads += 1;
      for (const row of rows) if (!this.tables.get(op.table)?.has(row._id)) this.put(op.table, row);
    }
    for (const op of ops) {
      if (op.kind === "delete") {
        this.tables.get(op.table)?.delete(op.id);
        this.heavy.get(op.table)?.delete(op.id);
        this.revisions.delete(`${op.table}:${op.id}`);
      } else {
        this.put(op.table, clone(op.row));
      }
    }
  }
}

export type { MemoryDbOptions };
