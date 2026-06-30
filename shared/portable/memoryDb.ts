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
  SearchFilterBuilder,
  TableName,
} from "./ctx";

type Constraint = { op: "eq" | "gt" | "gte" | "lt" | "lte"; field: string; value: unknown };

/** Captured `withSearchIndex` spec: the searched field/query + any eq filters. */
export type SearchSpec = { field: string; query: string; eqs: { field: string; value: unknown }[] };

export function collectSearch(search: (q: SearchFilterBuilder) => SearchFilterBuilder): SearchSpec {
  const spec: SearchSpec = { field: "", query: "", eqs: [] };
  const builder: SearchFilterBuilder = {
    search: (field, query) => ((spec.field = field), (spec.query = query), builder),
    eq: (field, value) => (spec.eqs.push({ field, value }), builder),
  };
  search(builder);
  return spec;
}

function tokenize(text: unknown): string[] {
  return String(text ?? "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/**
 * Local emulation of Convex full-text search. A row matches when every query
 * token hits a field token (the LAST token prefix-matches, mirroring Convex);
 * results are relevance-ranked by token-hit count, then `_creationTime`/`_id` for
 * a deterministic order. Not BM25-identical, but stable and engine-equal across
 * MemoryDb and LocalStoreDb (the differential harness asserts on membership).
 */
export function evaluateSearch<T extends PortableDoc>(
  rows: T[],
  spec: SearchSpec,
  predicates: ((doc: T) => boolean)[],
): T[] {
  let candidates = rows.filter((doc) => spec.eqs.every((e) => doc[e.field] === e.value));
  for (const p of predicates) candidates = candidates.filter(p);
  const terms = tokenize(spec.query);
  if (terms.length === 0) return [];
  const scored: { row: T; score: number }[] = [];
  for (const row of candidates) {
    const tokens = tokenize(row[spec.field]);
    let matchedAll = true;
    let score = 0;
    for (let i = 0; i < terms.length; i++) {
      const term = terms[i];
      const isLast = i === terms.length - 1;
      let hits = 0;
      for (const tok of tokens) if (tok === term || (isLast && tok.startsWith(term))) hits += 1;
      if (hits === 0) {
        matchedAll = false;
        break;
      }
      score += hits;
    }
    if (matchedAll) scored.push({ row, score });
  }
  scored.sort(
    (a, b) =>
      b.score - a.score ||
      Number(b.row._creationTime ?? 0) - Number(a.row._creationTime ?? 0) ||
      String(a.row._id).localeCompare(String(b.row._id)),
  );
  return scored.map((s) => s.row);
}

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
  private search: SearchSpec | null = null;

  constructor(source: () => T[]) {
    this.source = source;
  }

  withIndex(_indexName: string, range?: (q: IndexRangeBuilder) => IndexRangeBuilder): PortableQuery<T> {
    this.constraints.push(...collectConstraints(range));
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
