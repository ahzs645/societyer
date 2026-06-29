/**
 * PORTABLE FUNCTION DEFINITIONS + LOCAL RUNTIME.
 *
 * `definePortableQuery` / `definePortableMutation` capture a handler written
 * against the portable `ctx` contract. The SAME definition is then:
 *   - wrapped as a real Convex query/mutation (convex/lib/portable.ts), and
 *   - registered in a `PortableRuntime` that the browser/Electron local runtimes
 *     use to execute it against the Dexie-backed `ctx.db`.
 *
 * One handler, three runtimes — no hand-written mirror.
 */

import type {
  PortableCapabilities,
} from "./capabilities";
import type {
  PortableMutationCtx,
  PortableQueryCtx,
  TransactionalDb,
} from "./ctx";

export interface PortableQueryDef<Args = any, Result = any> {
  kind: "query";
  name: string;
  handler: (ctx: PortableQueryCtx, args: Args) => Promise<Result>;
}

export interface PortableMutationDef<Args = any, Result = any> {
  kind: "mutation";
  name: string;
  handler: (ctx: PortableMutationCtx, args: Args) => Promise<Result>;
}

export type PortableFunctionDef = PortableQueryDef | PortableMutationDef;

export function definePortableQuery<Args = any, Result = any>(
  def: Omit<PortableQueryDef<Args, Result>, "kind">,
): PortableQueryDef<Args, Result> {
  return { kind: "query", ...def };
}

export function definePortableMutation<Args = any, Result = any>(
  def: Omit<PortableMutationDef<Args, Result>, "kind">,
): PortableMutationDef<Args, Result> {
  return { kind: "mutation", ...def };
}

export interface PortableRuntimeOptions {
  db: TransactionalDb;
  capabilities: PortableCapabilities;
}

/**
 * Executes portable functions locally against one `ctx.db` and capability bag.
 * `runQuery`/`runMutation` resolve nested calls through the same registry, so a
 * handler that calls `ctx.runQuery("other:fn", ...)` works offline too.
 *
 * Mutations run inside `db.transaction(...)`, giving every mutation atomic,
 * all-or-nothing semantics on the local store.
 */
export class PortableRuntime {
  private readonly registry = new Map<string, PortableFunctionDef>();
  private readonly db: TransactionalDb;
  private readonly capabilities: PortableCapabilities;

  constructor(options: PortableRuntimeOptions) {
    this.db = options.db;
    this.capabilities = options.capabilities;
  }

  register(def: PortableFunctionDef): this {
    this.registry.set(def.name, def);
    return this;
  }

  registerAll(defs: PortableFunctionDef[]): this {
    for (const def of defs) this.register(def);
    return this;
  }

  has(name: string): boolean {
    return this.registry.has(name);
  }

  private queryCtx(): PortableQueryCtx {
    return {
      db: this.db,
      capabilities: this.capabilities,
      runQuery: (name, args) => this.runQuery(name, args),
    };
  }

  private mutationCtx(): PortableMutationCtx {
    return {
      db: this.db,
      capabilities: this.capabilities,
      runQuery: (name, args) => this.runQuery(name, args),
      runMutation: (name, args) => this.runMutation(name, args),
    };
  }

  async runQuery<Result = unknown>(name: string, args: Record<string, any> = {}): Promise<Result> {
    const def = this.registry.get(name);
    if (!def) throw new Error(`Portable function not registered locally: ${name}`);
    if (def.kind !== "query") throw new Error(`${name} is a ${def.kind}, not a query`);
    return def.handler(this.queryCtx(), args) as Promise<Result>;
  }

  async runMutation<Result = unknown>(name: string, args: Record<string, any> = {}): Promise<Result> {
    const def = this.registry.get(name);
    if (!def) throw new Error(`Portable function not registered locally: ${name}`);
    if (def.kind !== "mutation") throw new Error(`${name} is a ${def.kind}, not a mutation`);
    return this.db.transaction(() => def.handler(this.mutationCtx(), args)) as Promise<Result>;
  }
}
