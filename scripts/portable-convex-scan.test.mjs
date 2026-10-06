import assert from "node:assert/strict";
import { test } from "node:test";
import { scanModule } from "./portable-convex-scan.mjs";

const imports = `
  import { query as q, mutation, action, internalMutation } from './_generated/server';
  import { authorizedQuery as authorized, authorizedMutation } from './lib/authorizedServer';
  import { listPortable as list, createPortable } from '../shared/functions/example';
  import { toPortableQueryCtx, toPortableMutationCtx } from './lib/portable';
`;

test("wrapped/cast builders, aliases and internal boundaries", () => {
  const functions = scanModule(imports + `
    // export const fake = query({ handler: () => createPortable() });
    export const first = authorized('example:first', q)({handler: async ctx => list(await toPortableQueryCtx(ctx))});
    export const native = authorized('example:native', q)({handler: ctx => ctx.db.query('rows').collect()});
    export const worker = internalMutation({handler: ctx => createPortable(toPortableMutationCtx(ctx))});
    export const cast = (q as unknown)({handler: async ctx => list(await toPortableQueryCtx(ctx))});
    export const remote = action({handler: async ctx => list(await toPortableQueryCtx(ctx))});
  `, "example");
  assert.deepEqual(functions.map(({ export: name, kind, classification }) => [name, kind, classification]), [
    ["first", "query", "portable"], ["native", "query", "static-fallback"],
    ["worker", "internalMutation", "server-only"], ["cast", "query", "portable"],
    ["remote", "action", "server-only"],
  ]);
  assert.deepEqual(functions[0].delegates, [{ fn: "listPortable", sharedModule: "example" }]);
});

test("namespace/dynamic imports, adapted variables, capability calls and pure catalogs", () => {
  const functions = scanModule(imports + `
    import * as handlers from '../shared/functions/example';
    import { catalogPortable } from '../shared/functions/example';
    export const local = q({handler: async ctx => {
      const adapted = await toPortableQueryCtx(ctx);
      return handlers.list(adapted);
    }});
    export const dynamic = mutation({handler: async ctx => (await import('../shared/functions/example')).create(await toPortableMutationCtx(ctx))});
    export const caps = q({handler: async ctx => list(await toPortableQueryCtx(ctx, buildConvexCapabilities(ctx)))});
    export const storage = q({handler: ctx => list(withStorageCaps(ctx))});
    export const catalog = q({handler: () => catalogPortable()});
    export const enriched = q({handler: async ctx => ({...await handlers.list(await toPortableQueryCtx(ctx)), extra: true})});
  `, "example");
  assert.deepEqual(functions.map((fn) => fn.classification), ["portable", "portable", "capability-backed", "capability-backed", "portable", "portable"]);
  assert.deepEqual(functions[1].delegates, [{ fn: "create", sharedModule: "example" }]);
});

test("native handlers using portable auth or a shared seeding helper stay native", () => {
  const functions = scanModule(imports + `
    import { getOwned } from '../shared/functions/access';
    export const native = q({handler: async ctx => {
      const adapted = await toPortableQueryCtx(ctx);
      await Promise.all(['id'].map(id => getOwned(adapted, 'rows', id, 'society')));
      return ctx.db.query('rows').collect();
    }});
    export const partial = mutation({handler: async ctx => {
      const ownerId = await createPortable(await toPortableMutationCtx(ctx));
      const id = await ctx.db.insert('rows', {ownerId});
      return {id};
    }});
  `, "example");
  assert.deepEqual(functions.map((fn) => fn.classification), ["static-fallback", "static-fallback"]);
});

test("operator-only delegations and local demo variants retain hosted classifications", () => {
  const operator = scanModule(imports + `export const migrateUserToClerk = mutation({handler: ctx => createPortable(toPortableMutationCtx(ctx))});`, "apiPlatform")[0];
  assert.equal(operator.classification, "server-only");
  const demo = scanModule(imports + `export const recordConnectionTest = internalMutation({handler: ctx => createPortable(toPortableMutationCtx(ctx))});`, "paperless")[0];
  assert.equal(demo.classification, "server-only");
  assert.equal(demo.localRuntimeVariant.handler, "paperlessFns.recordConnectionTestPortable");
});

test("unknown exported builders and mismatched authorization wrappers fail closed", () => {
  assert.throws(() => scanModule(`export const unknown = newBuilder({});`, "example"), /unrecognized exported function builder/);
  assert.throws(() => scanModule(imports + `export const mismatch = authorized('example:mismatch', mutation)({});`, "example"), /wrapper\/builder mismatch/);
});
