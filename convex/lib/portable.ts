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
import { makeCapabilities, type PortableCapabilities } from "../../shared/portable/capabilities";
import type {
  IndexRangeBuilder,
  PortableDoc,
  PortableMutationCtx,
  PortableQuery,
  PortableQueryCtx,
  TransactionalDb,
} from "../../shared/portable/ctx";

class ConvexPortableQuery<T extends PortableDoc> implements PortableQuery<T> {
  private inner: any;
  private predicates: ((doc: T) => boolean)[] = [];

  constructor(inner: any) {
    this.inner = inner;
  }

  withIndex(indexName: string, range?: (q: IndexRangeBuilder) => IndexRangeBuilder): PortableQuery<T> {
    this.inner = this.inner.withIndex(indexName, range as any);
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

  private apply(rows: T[]): T[] {
    let out = rows;
    for (const p of this.predicates) out = out.filter(p);
    return out;
  }

  async collect(): Promise<T[]> {
    return this.apply(await this.inner.collect());
  }

  async take(n: number): Promise<T[]> {
    if (!this.predicates.length) return this.inner.take(n);
    return this.apply(await this.inner.collect()).slice(0, n);
  }

  async first(): Promise<T | null> {
    if (!this.predicates.length) return (await this.inner.first()) ?? null;
    return this.apply(await this.inner.collect())[0] ?? null;
  }

  async unique(): Promise<T | null> {
    if (!this.predicates.length) return (await this.inner.unique()) ?? null;
    const rows = this.apply(await this.inner.collect());
    if (rows.length > 1) throw new Error("unique() found more than one matching document");
    return rows[0] ?? null;
  }

  async paginate(opts: { numItems: number; cursor: string | null }) {
    if (!this.predicates.length) {
      const res = await this.inner.paginate(opts);
      return { page: res.page as T[], isDone: res.isDone as boolean, continueCursor: res.continueCursor as string };
    }
    const rows = this.apply(await this.inner.collect());
    const start = opts.cursor ? Number(opts.cursor) : 0;
    const page = rows.slice(start, start + opts.numItems);
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

  async get<T extends PortableDoc = PortableDoc>(id: string): Promise<T | null> {
    return (await this.db.get(id as any)) ?? null;
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
export function toPortableQueryCtx(ctx: any, capabilities: PortableCapabilities = NO_CAPABILITIES): PortableQueryCtx {
  return {
    db: new ConvexPortableDb(ctx.db),
    capabilities,
    runQuery: (name, args) => ctx.runQuery(makeFunctionReference<"query">(name) as any, args ?? {}),
  };
}

/** Wrap a real Convex mutation ctx as a portable mutation ctx. */
export function toPortableMutationCtx(ctx: any, capabilities: PortableCapabilities = NO_CAPABILITIES): PortableMutationCtx {
  return {
    db: new ConvexPortableDb(ctx.db),
    capabilities,
    runQuery: (name, args) => ctx.runQuery(makeFunctionReference<"query">(name) as any, args ?? {}),
    runMutation: (name, args) => ctx.runMutation(makeFunctionReference<"mutation">(name) as any, args ?? {}),
  };
}
