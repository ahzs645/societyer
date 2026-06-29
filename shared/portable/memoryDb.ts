/**
 * In-memory reference implementation of the portable `ctx.db` contract.
 *
 * Two jobs:
 *   1. The ORACLE in differential tests — the simplest possible correct engine,
 *      so any divergence between it and the Dexie/Convex adapters is a real bug.
 *   2. A zero-dependency engine the Node test harness can run without Convex or
 *      IndexedDB. (This is also what convex-test would give you once adopted;
 *      see docs/portable-functions-architecture.md — convex-test is the heavier,
 *      higher-fidelity oracle, this is the dependency-free baseline.)
 *
 * Transactions are genuinely atomic: a snapshot is taken on entry and restored
 * if the body throws — the contract every adapter must honor.
 */

import type {
  IndexRangeBuilder,
  PaginationOptions,
  PaginationResult,
  PortableDbWriter,
  PortableDoc,
  PortableQuery,
  TableName,
} from "./ctx";

type Constraint = { op: "eq" | "gt" | "gte" | "lt" | "lte"; field: string; value: unknown };

function collectConstraints(range?: (q: IndexRangeBuilder) => IndexRangeBuilder): Constraint[] {
  if (!range) return [];
  const constraints: Constraint[] = [];
  const builder: IndexRangeBuilder = {
    eq: (field, value) => (constraints.push({ op: "eq", field, value }), builder),
    gt: (field, value) => (constraints.push({ op: "gt", field, value }), builder),
    gte: (field, value) => (constraints.push({ op: "gte", field, value }), builder),
    lt: (field, value) => (constraints.push({ op: "lt", field, value }), builder),
    lte: (field, value) => (constraints.push({ op: "lte", field, value }), builder),
  };
  range(builder);
  return constraints;
}

function compare(a: unknown, b: unknown): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b));
}

export function matchesConstraints(doc: PortableDoc, constraints: Constraint[]): boolean {
  for (const c of constraints) {
    const v = doc[c.field];
    if (c.op === "eq" && v !== c.value) return false;
    if (c.op === "gt" && !(compare(v, c.value) > 0)) return false;
    if (c.op === "gte" && !(compare(v, c.value) >= 0)) return false;
    if (c.op === "lt" && !(compare(v, c.value) < 0)) return false;
    if (c.op === "lte" && !(compare(v, c.value) <= 0)) return false;
  }
  return true;
}

/** Shared query evaluator used by both MemoryDb and the row-store adapter. */
export function evaluateQuery<T extends PortableDoc>(
  rows: T[],
  constraints: Constraint[],
  predicates: ((doc: T) => boolean)[],
  direction: "asc" | "desc",
): T[] {
  let out = rows.filter((doc) => matchesConstraints(doc, constraints));
  for (const p of predicates) out = out.filter(p);
  out = out.slice().sort((a, b) => {
    const at = Number(a._creationTime ?? 0);
    const bt = Number(b._creationTime ?? 0);
    const byTime = at - bt || String(a._id).localeCompare(String(b._id));
    return direction === "desc" ? -byTime : byTime;
  });
  return out;
}

class QueryBuilder<T extends PortableDoc> implements PortableQuery<T> {
  private readonly source: () => T[];
  private constraints: Constraint[] = [];
  private predicates: ((doc: T) => boolean)[] = [];
  private direction: "asc" | "desc" = "asc";

  constructor(source: () => T[]) {
    this.source = source;
  }

  withIndex(_indexName: string, range?: (q: IndexRangeBuilder) => IndexRangeBuilder): PortableQuery<T> {
    this.constraints.push(...collectConstraints(range));
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
    return evaluateQuery(this.source(), this.constraints, this.predicates, this.direction);
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

  async paginate(opts: PaginationOptions): Promise<PaginationResult<T>> {
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

export interface MemoryDbOptions {
  seed?: Record<string, PortableDoc[]>;
  /** Id minter for inserts. Inject for deterministic tests. */
  mintId?: (table: string) => string;
  /** Clock for `_creationTime`. Inject for deterministic tests. */
  now?: () => number;
}

export class MemoryDb implements PortableDbWriter {
  private tables = new Map<TableName, Map<string, PortableDoc>>();
  private idIndex = new Map<string, TableName>();
  private readonly mintId: (table: string) => string;
  private readonly now: () => number;
  private autoId = 0;

  constructor(options: MemoryDbOptions = {}) {
    this.mintId = options.mintId ?? ((table) => `${table}_${(++this.autoId).toString(36).padStart(6, "0")}`);
    this.now = options.now ?? (() => Date.now());
    for (const [table, rows] of Object.entries(options.seed ?? {})) {
      for (const row of rows) this.put(table, clone(row));
    }
  }

  private tableMap(table: TableName): Map<string, PortableDoc> {
    let map = this.tables.get(table);
    if (!map) {
      map = new Map();
      this.tables.set(table, map);
    }
    return map;
  }

  private put(table: TableName, doc: PortableDoc): void {
    this.tableMap(table).set(doc._id, doc);
    this.idIndex.set(doc._id, table);
  }

  async get<T extends PortableDoc = PortableDoc>(id: string): Promise<T | null> {
    const table = this.idIndex.get(id);
    if (!table) return null;
    const doc = this.tables.get(table)?.get(id);
    return doc ? (clone(doc) as T) : null;
  }

  query<T extends PortableDoc = PortableDoc>(table: TableName): PortableQuery<T> {
    return new QueryBuilder<T>(() => [...(this.tables.get(table)?.values() ?? [])] as T[]);
  }

  async insert(table: TableName, doc: Record<string, any>): Promise<string> {
    const _id = typeof doc._id === "string" && doc._id ? doc._id : this.mintId(table);
    const row: PortableDoc = { _creationTime: this.now(), ...doc, _id };
    this.put(table, clone(row));
    return _id;
  }

  async patch(id: string, patch: Record<string, any>): Promise<void> {
    const table = this.idIndex.get(id);
    const existing = table ? this.tables.get(table)?.get(id) : undefined;
    if (!table || !existing) throw new Error(`patch: document ${id} not found`);
    this.put(table, { ...existing, ...patch, _id: id });
  }

  async replace(id: string, doc: Record<string, any>): Promise<void> {
    const table = this.idIndex.get(id);
    if (!table) throw new Error(`replace: document ${id} not found`);
    this.put(table, { ...doc, _id: id });
  }

  async delete(id: string): Promise<void> {
    const table = this.idIndex.get(id);
    if (!table) return;
    this.tables.get(table)?.delete(id);
    this.idIndex.delete(id);
  }

  /** Snapshot/restore transaction — atomic: the body's writes roll back on throw. */
  async transaction<T>(body: () => Promise<T>): Promise<T> {
    const snapshot = this.snapshot();
    try {
      return await body();
    } catch (error) {
      this.restore(snapshot);
      throw error;
    }
  }

  private snapshot(): string {
    const dump: Record<string, PortableDoc[]> = {};
    for (const [table, map] of this.tables) dump[table] = [...map.values()].map(clone);
    return JSON.stringify(dump);
  }

  private restore(snapshot: string): void {
    this.tables = new Map();
    this.idIndex = new Map();
    const dump = JSON.parse(snapshot) as Record<string, PortableDoc[]>;
    for (const [table, rows] of Object.entries(dump)) for (const row of rows) this.put(table, row);
  }

  /** Test/debug helper: full table contents. */
  dump(table: TableName): PortableDoc[] {
    return [...(this.tables.get(table)?.values() ?? [])].map(clone);
  }
}
