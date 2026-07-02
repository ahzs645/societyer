/**
 * LOCAL-STORE ADAPTER for the portable `ctx.db` contract.
 *
 * Implements PortableDbWriter over a minimal row-store interface (`LocalRowStore`)
 * that Societyer's existing `LocalDexieRowStore` already satisfies structurally.
 * This is the browser-local AND Electron-local `ctx.db` — one engine, two hosts.
 *
 * Two things this adds over the raw row store, both called out by the audit:
 *   1. Real query semantics (index eq/range constraints, predicate filters,
 *      ordering, cursor pagination) via the SAME evaluator the oracle uses, so
 *      the local engine interprets the contract identically to Convex.
 *   2. ATOMIC transactions with read-your-writes: writes buffer in an overlay and
 *      flush in one batch (`commitBatch`); a throw discards the overlay so nothing
 *      partially commits. This fixes the non-atomic, fire-and-forget write bug in
 *      the current LocalDexieRowStore.transaction().
 *
 * Depends on nothing heavy (no Dexie, no Convex), so the Node test harness runs
 * it directly. The real Dexie store is plugged in by satisfying `LocalRowStore`.
 */

import type {
  PortableDbWriter,
  PortableDoc,
  PortableQuery,
  SearchFilterBuilder,
  TableName,
} from "./ctx";
import { collectSearch, evaluateQuery, evaluateSearch, type MemoryDbOptions, type SearchSpec } from "./memoryDb";
import { createEntityIdFactory } from "./ids";

/** Atomic write operation flushed by `commitBatch`. */
export type RowStoreOp =
  | { kind: "upsert"; table: string; row: PortableDoc }
  | { kind: "delete"; table: string; id: string };

/**
 * The minimal surface the adapter needs from a row store. `LocalDexieRowStore`
 * already implements `rows/upsertRow/removeRow`; `tableNames` and `commitBatch`
 * are the two methods this migration adds to it.
 */
export interface LocalRowStore {
  rows(table: string): PortableDoc[];
  tableNames(): string[];
  /** Apply all ops atomically (single backing transaction) and update cache. */
  commitBatch(ops: RowStoreOp[]): Promise<void> | void;
}

type Overlay = Map<TableName, Map<string, PortableDoc | null>>;

const reusableEvaluator = evaluateQuery; // re-exported reference for clarity

class LocalQueryBuilder<T extends PortableDoc> implements PortableQuery<T> {
  private readonly source: () => T[];
  private constraints: { op: "eq" | "gt" | "gte" | "lt" | "lte"; field: string; value: unknown }[] = [];
  private predicates: ((doc: T) => boolean)[] = [];
  private direction: "asc" | "desc" = "asc";
  private search: SearchSpec | null = null;

  constructor(source: () => T[]) {
    this.source = source;
  }

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

  private run(): T[] {
    if (this.search) return evaluateSearch(this.source(), this.search, this.predicates);
    return reusableEvaluator(this.source(), this.constraints, this.predicates, this.direction);
  }

  async collect(): Promise<T[]> {
    return this.run().map(clone);
  }
  async take(n: number): Promise<T[]> {
    return this.run().slice(0, n).map(clone);
  }
  async first(): Promise<T | null> {
    return this.run().map(clone)[0] ?? null;
  }
  async unique(): Promise<T | null> {
    const rows = this.run();
    if (rows.length > 1) throw new Error("unique() found more than one matching document");
    return rows[0] ? clone(rows[0]) : null;
  }
  async paginate(opts: { numItems: number; cursor: string | null }) {
    const rows = this.run();
    const start = opts.cursor ? Number(opts.cursor) : 0;
    const page = rows.slice(start, start + opts.numItems).map(clone);
    const nextStart = start + opts.numItems;
    const isDone = nextStart >= rows.length;
    return { page, isDone, continueCursor: isDone ? "" : String(nextStart) };
  }
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

export interface LocalStoreDbOptions {
  mintId?: (table: string) => string;
  now?: () => number;
}

export class LocalStoreDb implements PortableDbWriter {
  private readonly store: LocalRowStore;
  private readonly mintId: (table: string) => string;
  private readonly now: () => number;
  private overlay: Overlay | null = null;

  constructor(store: LocalRowStore, options: LocalStoreDbOptions = {}) {
    this.store = store;
    const factory = createEntityIdFactory();
    this.mintId = options.mintId ?? ((table) => factory.mint(table));
    this.now = options.now ?? (() => Date.now());
  }

  /** Overlay-merged view of a table (read-your-writes inside a transaction). */
  private currentRows(table: TableName): PortableDoc[] {
    const base = this.store.rows(table);
    const over = this.overlay?.get(table);
    if (!over || over.size === 0) return base;
    const byId = new Map<string, PortableDoc>();
    for (const row of base) byId.set(row._id, row);
    for (const [id, doc] of over) {
      if (doc === null) byId.delete(id);
      else byId.set(id, doc);
    }
    return [...byId.values()];
  }

  private findTableOf(id: string): TableName | undefined {
    if (this.overlay) {
      for (const [table, over] of this.overlay) if (over.has(id)) return over.get(id) === null ? undefined : table;
    }
    for (const table of this.store.tableNames()) {
      if (this.store.rows(table).some((row) => row._id === id)) return table;
    }
    return undefined;
  }

  async get<T extends PortableDoc = PortableDoc>(id: string): Promise<T | null> {
    const table = this.findTableOf(id);
    if (!table) return null;
    const row = this.currentRows(table).find((r) => r._id === id);
    return row ? (clone(row) as T) : null;
  }

  query<T extends PortableDoc = PortableDoc>(table: TableName): PortableQuery<T> {
    return new LocalQueryBuilder<T>(() => this.currentRows(table) as T[]);
  }

  private requireOverlay(): Map<TableName, Map<string, PortableDoc | null>> {
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
    const row: PortableDoc = { _creationTime: this.now(), ...doc, _id };
    this.overlayFor(table).set(_id, clone(row));
    return _id;
  }

  async patch(id: string, patch: Record<string, any>): Promise<void> {
    const existing = await this.get(id);
    if (!existing) throw new Error(`patch: document ${id} not found`);
    const table = this.findTableOf(id)!;
    this.overlayFor(table).set(id, { ...existing, ...patch, _id: id });
  }

  async replace(id: string, doc: Record<string, any>): Promise<void> {
    const table = this.findTableOf(id);
    if (!table) throw new Error(`replace: document ${id} not found`);
    this.overlayFor(table).set(id, { ...doc, _id: id });
  }

  async delete(id: string): Promise<void> {
    const table = this.findTableOf(id);
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

/**
 * Reference `LocalRowStore` for tests — plain in-memory arrays with an atomic
 * `commitBatch`. Lets the Node harness exercise the LocalStoreDb code path
 * (overlay, batch flush, rollback) without Dexie/IndexedDB.
 */
export class MemoryRowStore implements LocalRowStore {
  private tables = new Map<string, Map<string, PortableDoc>>();

  constructor(seed: Record<string, PortableDoc[]> = {}) {
    for (const [table, rows] of Object.entries(seed)) {
      const map = new Map<string, PortableDoc>();
      for (const row of rows) map.set(row._id, clone(row));
      this.tables.set(table, map);
    }
  }

  rows(table: string): PortableDoc[] {
    return [...(this.tables.get(table)?.values() ?? [])].map(clone);
  }

  tableNames(): string[] {
    return [...this.tables.keys()];
  }

  commitBatch(ops: RowStoreOp[]): void {
    for (const op of ops) {
      if (op.kind === "delete") {
        this.tables.get(op.table)?.delete(op.id);
      } else {
        let map = this.tables.get(op.table);
        if (!map) {
          map = new Map();
          this.tables.set(op.table, map);
        }
        map.set(op.row._id, clone(op.row));
      }
    }
  }
}

export type { MemoryDbOptions };
