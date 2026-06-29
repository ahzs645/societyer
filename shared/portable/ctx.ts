/**
 * PORTABLE `ctx.db` REPOSITORY CONTRACT.
 *
 * This is the bounded subset of Convex's `ctx` that Societyer functions are
 * allowed to depend on. The whole point: a handler written against this
 * contract runs UNCHANGED on three backends —
 *   1. hosted Convex   (the real `ctx.db`, adapted in convex/lib/portable.ts),
 *   2. browser-local   (Dexie row store, adapted in shared/portable/localRowStore.ts),
 *   3. Electron-local  (the same local adapter, different host).
 *
 * Nothing here imports Convex, Dexie, or any Societyer domain code — this file
 * is the seam of a reusable, multi-project SDK. Keep it that way.
 *
 * Fidelity boundary (read this before adding handlers):
 *   - Reads model `query(table).withIndex(name, q => q.eq(...)).order().collect()`,
 *     plus `first / unique / take / paginate` and a predicate `filter`.
 *   - `withIndex` index NAMES are advisory on the local adapters (they scan +
 *     apply the eq/range constraints in JS); on Convex they hit the real index.
 *   - `filter` takes a JS predicate (engine-agnostic), NOT Convex's FilterBuilder.
 *     The Convex adapter implements it as collect-then-filter.
 *   - Capabilities (email, storage, AI, ...) are NOT part of `db`. They are
 *     injected via `ctx.capabilities` so local runtimes can supply demo/native
 *     variants or fail loudly with a structured CAPABILITY_UNAVAILABLE error.
 */

import type { PortableCapabilities } from "./capabilities";

/** A stored document. Every row has a string `_id`; most carry `societyId`. */
export type PortableDoc = Record<string, any> & {
  _id: string;
  _creationTime?: number;
  societyId?: string;
};

export type TableName = string;

/** Range constraint builder passed to `withIndex`. Mirrors Convex's shape. */
export interface IndexRangeBuilder {
  eq(field: string, value: unknown): IndexRangeBuilder;
  gt(field: string, value: unknown): IndexRangeBuilder;
  gte(field: string, value: unknown): IndexRangeBuilder;
  lt(field: string, value: unknown): IndexRangeBuilder;
  lte(field: string, value: unknown): IndexRangeBuilder;
}

export interface PaginationOptions {
  numItems: number;
  cursor: string | null;
}

export interface PaginationResult<T> {
  page: T[];
  isDone: boolean;
  continueCursor: string;
}

/** The read query builder. A subset of Convex's QueryInitializer/Query. */
export interface PortableQuery<T extends PortableDoc = PortableDoc> {
  withIndex(indexName: string, range?: (q: IndexRangeBuilder) => IndexRangeBuilder): PortableQuery<T>;
  filter(predicate: (doc: T) => boolean): PortableQuery<T>;
  order(direction: "asc" | "desc"): PortableQuery<T>;
  collect(): Promise<T[]>;
  take(n: number): Promise<T[]>;
  first(): Promise<T | null>;
  unique(): Promise<T | null>;
  paginate(opts: PaginationOptions): Promise<PaginationResult<T>>;
}

/** Read surface of the database. */
export interface PortableDbReader {
  get<T extends PortableDoc = PortableDoc>(id: string): Promise<T | null>;
  query<T extends PortableDoc = PortableDoc>(table: TableName): PortableQuery<T>;
}

/** Read + write surface. Writes are buffered inside `transaction` (atomic). */
export interface PortableDbWriter extends PortableDbReader {
  insert(table: TableName, doc: Record<string, any>): Promise<string>;
  patch(id: string, patch: Record<string, any>): Promise<void>;
  replace(id: string, doc: Record<string, any>): Promise<void>;
  delete(id: string): Promise<void>;
}

/**
 * A writer that can run a body atomically. Mutations always execute inside one
 * of these so a thrown error rolls every write back. On Convex the whole handler
 * is already one transaction, so its `transaction` just runs the body.
 */
export interface TransactionalDb extends PortableDbWriter {
  transaction<T>(body: () => Promise<T>): Promise<T>;
}

/** Context handed to a portable QUERY handler. Read-only db. */
export interface PortableQueryCtx {
  db: PortableDbReader;
  capabilities: PortableCapabilities;
  runQuery: <Result = unknown>(name: string, args?: Record<string, any>) => Promise<Result>;
}

/** Context handed to a portable MUTATION handler. Read + write db. */
export interface PortableMutationCtx {
  db: PortableDbWriter;
  capabilities: PortableCapabilities;
  runQuery: <Result = unknown>(name: string, args?: Record<string, any>) => Promise<Result>;
  runMutation: <Result = unknown>(name: string, args?: Record<string, any>) => Promise<Result>;
}
