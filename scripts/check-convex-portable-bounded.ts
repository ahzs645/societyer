import assert from "node:assert/strict";
import { convexTest } from "convex-test";
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { convexPortableDb } from "../convex/lib/portable";

// A large result stream makes eager reads fail, including scans hidden behind
// take()/first()/unique(). The records after the necessary matches are never
// requested from the underlying query.
const rows = Array.from({ length: 10_000 }, (_, n) => ({ _id: `row-${n}`, n, allowed: n % 2 === 0, heavy: `body-${n}` }));
function instrumentedQuery() {
  const observed = { reads: 0, closed: false, paginateOptions: null as any };
  const underlying = {
    async collect(): Promise<never> { throw new Error("Unexpected full collection"); },
    async *[Symbol.asyncIterator]() {
      try {
        for (const row of rows) {
          observed.reads += 1;
          yield row;
        }
      } finally { observed.closed = true; }
    },
    async paginate(options: any) {
      observed.paginateOptions = options;
      const start = options.cursor ? Number(options.cursor.slice("cursor:".length)) : 0;
      const page = rows.slice(start, start + options.numItems);
      observed.reads += page.length;
      return { page, isDone: start + page.length === rows.length, continueCursor: `cursor:${start + page.length}`, pageStatus: "SplitRecommended", splitCursor: `cursor:${start + 1}` };
    },
  };
  return { observed, query: convexPortableDb({ query: () => underlying }).query("rows") as any };
}

{
  const { observed, query } = instrumentedQuery();
  const result = await query.filter((row: any) => row.allowed).filter((row: any) => row.n > 0).omitFields("heavy").take(2);
  assert.deepEqual(result.map((row: any) => row.n), [2, 4]);
  assert.equal(observed.reads, 5, "two eligible results stop the database iterator at the fifth row, not row 10,000");
  assert.equal(observed.closed, true, "early stop closes the iterator");
  assert.ok(result.every((row: any) => !Object.hasOwn(row, "heavy")));
}
{
  const { observed, query } = instrumentedQuery();
  const result = await query.omitFields("heavy").filter((row: any) => row.heavy === "body-3").first();
  assert.equal(result.n, 3, "predicates still see fields omitted from the result");
  assert.equal(observed.reads, 4);
}
{
  const { observed, query } = instrumentedQuery();
  await assert.rejects(() => query.filter((row: any) => row.allowed).unique(), /more than one/);
  assert.equal(observed.reads, 3, "uniqueness fails immediately at the second match");
}
{
  const { observed, query } = instrumentedQuery();
  assert.deepEqual(await query.filter(() => true).take(0), []);
  assert.equal(observed.reads, 0);
  await assert.rejects(() => query.take(-1), /non-negative safe integer/);
  await assert.rejects(() => query.take(1.5), /non-negative safe integer/);
}
{
  const { observed, query } = instrumentedQuery();
  const options = { numItems: 4, cursor: null, maximumBytesRead: 1024 };
  const page = await query.filter((row: any) => row.n > 3).paginate(options);
  assert.deepEqual(page.page, []);
  assert.equal(page.isDone, false, "an empty filtered page does not exhaust the native index range");
  assert.equal(page.continueCursor, "cursor:4");
  assert.equal(page.pageStatus, "SplitRecommended");
  assert.equal(page.splitCursor, "cursor:1");
  assert.equal(observed.reads, 4);
  assert.deepEqual(observed.paginateOptions, options, "read bounds and real cursors reach native pagination unchanged");
  const next = await query.paginate({ ...options, cursor: page.continueCursor });
  assert.deepEqual(next.page.map((row: any) => row.n), [4, 5, 6, 7]);
  assert.equal(observed.reads, 8);
}

// Verify the same iterator and cursor path against Convex's actual query
// implementation. A stub alone would miss unsupported AsyncIterable behavior.
const schema = defineSchema({ rows: defineTable({ order: v.number(), allowed: v.boolean(), heavy: v.string() }).index("by_order", ["order"]) });
const test = convexTest(schema, {
  "./_generated/server.js": () => import("../convex/_generated/server.js"),
} as any);
await test.run(async ctx => {
  for (let n = 0; n < 10; n += 1) await ctx.db.insert("rows", { order: n, allowed: n % 2 === 0, heavy: `body-${n}` });
});
await test.run(async ctx => {
  const query = () => convexPortableDb(ctx.db).query("rows").withIndex("by_order").order("desc").filter(row => row.allowed).omitFields("heavy");
  assert.deepEqual((await query().take(3)).map(row => row.order), [8, 6, 4]);
  assert.equal((await query().first())?.order, 8);
  await assert.rejects(() => query().unique(), /more than one/);
  const missing = await convexPortableDb(ctx.db).query("rows").filter(row => row.order > 10).first();
  assert.equal(missing, null);
  const only = await convexPortableDb(ctx.db).query("rows").filter(row => row.order === 3).unique();
  assert.equal(only?.order, 3);
});
let cursor: string | null = null;
const paged: number[] = [];
for (;;) {
  const page = await test.run(async ctx => convexPortableDb(ctx.db).query("rows").withIndex("by_order").order("desc").filter(row => row.allowed).paginate({ numItems: 3, cursor }));
  paged.push(...page.page.map(row => row.order));
  if (page.isDone) break;
  assert.notEqual(page.continueCursor, cursor);
  cursor = page.continueCursor;
}
assert.deepEqual(paged, [8, 6, 4, 2, 0], "native cursors retain index order without missing or duplicated matches");
console.log("Convex portable bounded reads passed: lazy early stop, predicate/projection order, uniqueness, zero/invalid limits, native read-bound/cursor/page metadata, and real Convex iterator pagination.");
