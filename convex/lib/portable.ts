/**
 * CONVEX adapter for the portable `ctx.db` contract.
 *
 * Wraps a real Convex `ctx` so a portable handler runs on hosted Convex with no
 * changes. The contract is deliberately the SUBSET of Convex's ctx we allow, so
 * this wrapper is thin: index reads pass straight through to the real index;
 * only the engine-agnostic `filter(predicate)` is implemented as collect-then-
 * filter (Convex's native `.filter` uses a FilterBuilder, not a JS predicate).
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
    return this.apply(await this.inner.collect()).slice(0, n).map((row) => this.project(row));
  }

  async first(): Promise<T | null> {
    if (!this.predicates.length) return this.project(((await this.inner.first()) ?? null) as T | null);
    return this.project(this.apply(await this.inner.collect())[0] ?? null);
  }

  async unique(): Promise<T | null> {
    if (!this.predicates.length) return this.project(((await this.inner.unique()) ?? null) as T | null);
    const rows = this.apply(await this.inner.collect());
    if (rows.length > 1) throw new Error("unique() found more than one matching document");
    return this.project(rows[0] ?? null);
  }

  async paginate(opts: { numItems: number; cursor: string | null }) {
    if (!this.predicates.length) {
      const res = await this.inner.paginate(opts);
      return { page: (res.page as T[]).map((row) => this.project(row)), isDone: res.isDone as boolean, continueCursor: res.continueCursor as string };
    }
    const rows = this.apply(await this.inner.collect());
    const start = opts.cursor ? Number(opts.cursor) : 0;
    const page = rows.slice(start, start + opts.numItems).map((row) => this.project(row));
    const nextStart = start + opts.numItems;
    const isDone = nextStart >= rows.length;
    return { page, isDone, continueCursor: isDone ? "" : String(nextStart) };
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
