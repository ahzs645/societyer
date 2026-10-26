/**
 * CONVEX adapter for the portable `ctx.db` contract.
 *
 * Wraps a real Convex `ctx` so a portable handler runs on hosted Convex with no
 * changes. The contract is deliberately the SUBSET of Convex's ctx we allow, so
 * this wrapper is thin: index reads pass straight through to the real index;
 * the engine-agnostic `filter(predicate)` runs over the real query iterator
 * (Convex's native `.filter` uses a FilterBuilder, not a JS predicate). Bounded
 * reads stop once enough matches are found; pages filter the native page so
 * its read bounds and stable continuation cursor remain intact.
 *
 * Convex mutations are already one atomic transaction, so `transaction(body)`
 * just runs the body.
 */

import { makeFunctionReference } from "convex/server";
import { hostedPrincipal } from "./authIdentity";
import { makeCapabilities, type PortableCapabilities } from "../../shared/portable/capabilities";
import { omitRowFields } from "../../shared/portable/heavyFields";
import type {
  IndexRangeBuilder,
  PortableDoc,
  PortableGetOptions,
  PortableMutationCtx,
  PortableQuery,
  PortableQueryCtx,
  PaginationOptions,
  SearchFilterBuilder,
  TransactionalDb,
} from "../../shared/portable/ctx";

class ConvexPortableQuery<T extends PortableDoc> implements PortableQuery<T> {
  private inner: any;
  private predicates: ((doc: T) => boolean)[] = [];
  private omitted: string[] = [];

  constructor(inner: any) {
    this.inner = inner;
  }

  withIndex(indexName: string, range?: (q: IndexRangeBuilder) => IndexRangeBuilder): PortableQuery<T> {
    this.inner = this.inner.withIndex(indexName, range as any);
    return this;
  }

  withSearchIndex(indexName: string, search: (q: SearchFilterBuilder) => SearchFilterBuilder): PortableQuery<T> {
    // Convex's real search builder is shape-compatible with SearchFilterBuilder
    // (`search(field, query)` + `eq(field, value)`), so pass the callback straight
    // through to the live full-text index.
    this.inner = this.inner.withSearchIndex(indexName, search as any);
    return this;
  }

  filter(predicate: (doc: T) => boolean): PortableQuery<T> {
    this.predicates.push(predicate);
    return this;
  }

  order(direction: "asc" | "desc"): PortableQuery<T> {
    this.inner = this.inner.order(direction);
    return this;
  }

  omitFields(...fields: string[]): PortableQuery<T> {
    this.omitted.push(...fields);
    return this;
  }

  private apply(rows: T[]): T[] {
    let out = rows;
    for (const p of this.predicates) out = out.filter(p);
    return out;
  }

  /** Projection runs last, so predicates above always saw the whole row. */
  private project<R extends T | null>(row: R): R {
    return row && this.omitted.length ? omitRowFields(row, this.omitted) : row;
  }

  async collect(): Promise<T[]> {
    return this.apply(await this.inner.collect()).map((row) => this.project(row));
  }

  async collectProjected<R>(_key: string, project: (doc: T) => R): Promise<R[]> {
    return (await this.collect()).map(project);
  }

  async take(n: number): Promise<T[]> {
    if (!this.predicates.length) return ((await this.inner.take(n)) as T[]).map((row) => this.project(row));
    if (!Number.isSafeInteger(n) || n < 0) throw new Error("take() requires a non-negative safe integer");
    const rows: T[] = [];
    if (n === 0) return rows;
    // A sparse predicate may still scan many documents. Prefer an index for
    // common filters; do not read the rest once the requested matches exist.
    for await (const row of this.inner as AsyncIterable<T>) {
      if (!this.predicates.every((predicate) => predicate(row))) continue;
      rows.push(this.project(row));
      if (rows.length === n) break;
    }
    return rows;
  }

  async first(): Promise<T | null> {
    if (!this.predicates.length) return this.project(((await this.inner.first()) ?? null) as T | null);
    return (await this.take(1))[0] ?? null;
  }

  async unique(): Promise<T | null> {
    if (!this.predicates.length) return this.project(((await this.inner.unique()) ?? null) as T | null);
    const rows = await this.take(2);
    if (rows.length > 1) throw new Error("unique() found more than one matching document");
    return rows[0] ?? null;
  }

  async paginate(opts: PaginationOptions) {
    const res = await this.inner.paginate(opts);
    // A filtered page may be short or empty. isDone and continueCursor describe
    // the underlying range, so callers must continue until isDone, not until
    // an empty page. Preserve Convex's page-splitting metadata as well.
    return { ...res, page: this.apply(res.page as T[]).map((row) => this.project(row)), isDone: res.isDone as boolean, continueCursor: res.continueCursor as string };
  }
}

class ConvexPortableDb implements TransactionalDb {
  private readonly db: any;

  constructor(db: any) {
    this.db = db;
  }

  async get<T extends PortableDoc = PortableDoc>(id: string, expectedTable?: string, options?: PortableGetOptions): Promise<T | null> {
    const normalizedId = expectedTable ? this.db.normalizeId(expectedTable, id) : id;
    if (!normalizedId) return null;
    const row = (await this.db.get(normalizedId as any)) ?? null;
    return row && options?.omitFields?.length ? omitRowFields(row, options.omitFields) : row;
  }

  query<T extends PortableDoc = PortableDoc>(table: string): PortableQuery<T> {
    return new ConvexPortableQuery<T>(this.db.query(table as any));
  }

  async insert(table: string, doc: Record<string, any>): Promise<string> {
    return this.db.insert(table as any, doc);
  }

  async patch(id: string, patch: Record<string, any>): Promise<void> {
    await this.db.patch(id as any, patch);
  }

  async replace(id: string, doc: Record<string, any>): Promise<void> {
    await this.db.replace(id as any, doc);
  }

  async delete(id: string): Promise<void> {
    await this.db.delete(id as any);
  }

  async transaction<T>(body: () => Promise<T>): Promise<T> {
    // A Convex mutation is already a single atomic transaction.
    return body();
  }
}

/** The portable `ctx.db` over a real Convex `ctx.db`, for server code that builds its own principal. */
export function convexPortableDb(db: object): TransactionalDb {
  return new ConvexPortableDb(db);
}

const NO_CAPABILITIES = makeCapabilities({});

/** Wrap a real Convex query ctx as a portable query ctx. */
export async function toPortableQueryCtx(
  ctx: any,
  capabilities: PortableCapabilities = NO_CAPABILITIES,
): Promise<PortableQueryCtx> {
  const principal = hostedPrincipal(await ctx.auth.getUserIdentity());
  return {
    db: new ConvexPortableDb(ctx.db),
    capabilities,
    principal,
    runQuery: (name, args) => ctx.runQuery(makeFunctionReference<"query">(name) as any, args ?? {}),
  };
}

/** Wrap a real Convex mutation ctx as a portable mutation ctx. */
export async function toPortableMutationCtx(
  ctx: any,
  capabilities: PortableCapabilities = NO_CAPABILITIES,
): Promise<PortableMutationCtx> {
  const principal = hostedPrincipal(await ctx.auth.getUserIdentity());
  return {
    db: new ConvexPortableDb(ctx.db),
    capabilities,
    principal,
    runQuery: (name, args) => ctx.runQuery(makeFunctionReference<"query">(name) as any, args ?? {}),
    runMutation: (name, args) => ctx.runMutation(makeFunctionReference<"mutation">(name) as any, args ?? {}),
  };
}
