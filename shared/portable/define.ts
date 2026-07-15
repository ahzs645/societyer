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
  PortablePrincipal,
  PortableQueryCtx,
  TransactionalDb,
} from "./ctx";

export type PortableAccess =
  | { audience: "public" }
  | { audience: "authenticated" }
  | { audience: "service"; scopes: readonly string[] };

const DEFAULT_PORTABLE_ACCESS: PortableAccess = { audience: "authenticated" };

/**
 * Stage 1 records access intent but intentionally does not enforce it. Stage 2
 * of docs/trusted-principal-proposal.md turns this seam on after a hosted JWT
 * provider and service-token path have been selected and wired.
 */
export const PORTABLE_ACCESS_ENFORCEMENT = false;

export interface PortableQueryDef<Args = any, Result = any> {
  kind: "query";
  name: string;
  access?: PortableAccess;
  handler: (ctx: PortableQueryCtx, args: Args) => Promise<Result>;
}

export interface PortableMutationDef<Args = any, Result = any> {
  kind: "mutation";
  name: string;
  access?: PortableAccess;
  handler: (ctx: PortableMutationCtx, args: Args) => Promise<Result>;
}

export type PortableFunctionDef = PortableQueryDef | PortableMutationDef;

export function definePortableQuery<Args = any, Result = any>(
  def: Omit<PortableQueryDef<Args, Result>, "kind">,
): PortableQueryDef<Args, Result> {
  return { kind: "query", access: DEFAULT_PORTABLE_ACCESS, ...def };
}

export function definePortableMutation<Args = any, Result = any>(
  def: Omit<PortableMutationDef<Args, Result>, "kind">,
): PortableMutationDef<Args, Result> {
  return { kind: "mutation", access: DEFAULT_PORTABLE_ACCESS, ...def };
}

export interface PortableRuntimeOptions {
  db: TransactionalDb;
  capabilities: PortableCapabilities;
  principalProvider?: () => PortablePrincipal | Promise<PortablePrincipal>;
}

const DEFAULT_ANONYMOUS_PRINCIPAL: PortablePrincipal = {
  kind: "anonymous",
  runtime: "test",
  assurance: "none",
};

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
  private readonly principalProvider: () => PortablePrincipal | Promise<PortablePrincipal>;

  constructor(options: PortableRuntimeOptions) {
    this.db = options.db;
    this.capabilities = options.capabilities;
    this.principalProvider = options.principalProvider ?? (() => DEFAULT_ANONYMOUS_PRINCIPAL);
  }

  register(def: PortableFunctionDef): this {
    this.registry.set(def.name, { ...def, access: def.access ?? DEFAULT_PORTABLE_ACCESS });
    return this;
  }

  registerAll(defs: PortableFunctionDef[]): this {
    for (const def of defs) this.register(def);
    return this;
  }

  has(name: string): boolean {
    return this.registry.has(name);
  }

  /** The kind of a registered function, or undefined if not registered. */
  kind(name: string): "query" | "mutation" | undefined {
    return this.registry.get(name)?.kind;
  }

  /** Access intent for a registered function, or undefined if unregistered. */
  access(name: string): PortableAccess | undefined {
    return this.registry.get(name)?.access;
  }

  private queryCtx(principal: PortablePrincipal): PortableQueryCtx {
    return {
      db: this.db,
      capabilities: this.capabilities,
      principal,
      runQuery: (name, args) => this.runQueryNested(name, args, principal),
    };
  }

  private mutationCtx(principal: PortablePrincipal): PortableMutationCtx {
    return {
      db: this.db,
      capabilities: this.capabilities,
      principal,
      runQuery: (name, args) => this.runQueryNested(name, args, principal),
      // Nested mutations (ctx.runMutation inside a handler) run the child
      // handler directly inside the CURRENT transaction rather than opening a
      // new db.transaction(). Nesting must be a property of the call chain,
      // not guessed from shared mutable state — the old overlay-presence check
      // in LocalStoreDb let an unrelated concurrent mutation silently join
      // (and possibly lose its writes with) whatever transaction happened to
      // be in flight.
      runMutation: (name, args) => this.runMutationNested(name, args, principal),
    };
  }

  private accessHook(_def: PortableFunctionDef, _principal: PortablePrincipal): void {
    if (!PORTABLE_ACCESS_ENFORCEMENT) return;
    // Stage 2: enforce the registered audience/scopes against the principal.
  }

  private async runQueryNested<Result = unknown>(
    name: string,
    args: Record<string, any> = {},
    principal: PortablePrincipal,
  ): Promise<Result> {
    const def = this.registry.get(name);
    if (!def) throw new Error(`Portable function not registered locally: ${name}`);
    if (def.kind !== "query") throw new Error(`${name} is a ${def.kind}, not a query`);
    this.accessHook(def, principal);
    return def.handler(this.queryCtx(principal), args) as Promise<Result>;
  }

  private async runMutationNested<Result = unknown>(
    name: string,
    args: Record<string, any> = {},
    principal: PortablePrincipal,
  ): Promise<Result> {
    const def = this.registry.get(name);
    if (!def) throw new Error(`Portable function not registered locally: ${name}`);
    if (def.kind !== "mutation") throw new Error(`${name} is a ${def.kind}, not a mutation`);
    this.accessHook(def, principal);
    return def.handler(this.mutationCtx(principal), args) as Promise<Result>;
  }

  async runQuery<Result = unknown>(name: string, args: Record<string, any> = {}): Promise<Result> {
    const principal = await this.principalProvider();
    return this.runQueryNested(name, args, principal);
  }

  async runMutation<Result = unknown>(name: string, args: Record<string, any> = {}): Promise<Result> {
    const def = this.registry.get(name);
    if (!def) throw new Error(`Portable function not registered locally: ${name}`);
    if (def.kind !== "mutation") throw new Error(`${name} is a ${def.kind}, not a mutation`);
    const principal = await this.principalProvider();
    this.accessHook(def, principal);
    return this.db.transaction(() => def.handler(this.mutationCtx(principal), args)) as Promise<Result>;
  }
}
