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

export type PortableAccessDecision = {
  functionName: string;
  audience: PortableAccess["audience"];
  principalKind: PortablePrincipal["kind"];
  decision: "allow" | "deny";
  mode: "shadow" | "enforced";
  reason: string;
};

type PortableAccessDecisionResult = Omit<PortableAccessDecision, "mode">;

const DEFAULT_PORTABLE_ACCESS: PortableAccess = { audience: "authenticated" };

const DEFAULT_PORTABLE_ACCESS_ENFORCEMENT = false;
const PORTABLE_ACCESS_ENFORCEMENT_ENV = "SOCIETYER_PORTABLE_ACCESS_ENFORCEMENT";
const VITE_PORTABLE_ACCESS_ENFORCEMENT_ENV = "VITE_SOCIETYER_PORTABLE_ACCESS_ENFORCEMENT";

type RuntimeImportMeta = ImportMeta & {
  readonly env?: Record<string, string | boolean | undefined>;
};

function environmentValue(name: string): string | boolean | undefined {
  const processValue = (globalThis as {
    process?: { env?: Record<string, string | undefined> };
  }).process?.env?.[name];
  if (processValue !== undefined) return processValue;
  return (import.meta as RuntimeImportMeta).env?.[name];
}

function configuredPortableAccessEnforcement(): boolean {
  const configured = environmentValue(PORTABLE_ACCESS_ENFORCEMENT_ENV)
    ?? environmentValue(VITE_PORTABLE_ACCESS_ENFORCEMENT_ENV);
  if (configured === undefined) return DEFAULT_PORTABLE_ACCESS_ENFORCEMENT;
  return configured === true || String(configured).trim().toLowerCase() === "1";
}

/**
 * Stage 2 evaluates access intent but defaults to shadow-only behavior. This
 * live binding is refreshed at each local/runtime decision so Node canary
 * rollback does not require a process restart; hosted importers continue to
 * receive the boolean export they already consume.
 */
export let PORTABLE_ACCESS_ENFORCEMENT = configuredPortableAccessEnforcement();

function portableAccessEnforcementEnabled(): boolean {
  PORTABLE_ACCESS_ENFORCEMENT = configuredPortableAccessEnforcement();
  return PORTABLE_ACCESS_ENFORCEMENT;
}

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
  /** Overrides SOCIETYER_PORTABLE_ACCESS_SHADOW for this runtime. */
  shadowAccessDecisions?: boolean;
}

const DEFAULT_ANONYMOUS_PRINCIPAL: PortablePrincipal = {
  kind: "anonymous",
  runtime: "test",
  assurance: "none",
};

const MAX_SHADOW_DECISIONS = 1_000;

function shadowAccessEnabledFromEnvironment(): boolean {
  return typeof process !== "undefined" && process.env.SOCIETYER_PORTABLE_ACCESS_SHADOW === "1";
}

function accessDecision(
  def: PortableFunctionDef,
  principal: PortablePrincipal,
): PortableAccessDecisionResult {
  const access = def.access ?? DEFAULT_PORTABLE_ACCESS;
  if (access.audience === "public") {
    return {
      functionName: def.name,
      audience: access.audience,
      principalKind: principal.kind,
      decision: "allow",
      reason: "public audience",
    };
  }
  if (access.audience === "authenticated") {
    const hasSubject = principal.kind !== "anonymous" && principal.subject.trim().length > 0;
    const hasVerifiedIssuer =
      principal.kind !== "user" ||
      principal.assurance !== "verified-jwt" ||
      Boolean(principal.issuer?.trim());
    const allowed = hasSubject && hasVerifiedIssuer;
    return {
      functionName: def.name,
      audience: access.audience,
      principalKind: principal.kind,
      decision: allowed ? "allow" : "deny",
      reason: allowed ? "authenticated principal" : "valid authenticated principal required",
    };
  }
  if (principal.kind !== "service") {
    return {
      functionName: def.name,
      audience: access.audience,
      principalKind: principal.kind,
      decision: "deny",
      reason: "service principal required",
    };
  }
  if (!principal.subject.trim()) {
    return {
      functionName: def.name,
      audience: access.audience,
      principalKind: principal.kind,
      decision: "deny",
      reason: "valid service principal required",
    };
  }
  const missingScopes = access.scopes.filter(
    (scope) => !principal.scopes.includes("*") && !principal.scopes.includes(scope),
  );
  return {
    functionName: def.name,
    audience: access.audience,
    principalKind: principal.kind,
    decision: missingScopes.length === 0 ? "allow" : "deny",
    reason: missingScopes.length === 0
      ? "service scopes satisfied"
      : `missing service scopes: ${missingScopes.join(", ")}`,
  };
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
  private readonly principalProvider: () => PortablePrincipal | Promise<PortablePrincipal>;
  private readonly shadowAccessDecisions: boolean;
  private readonly shadowDecisions: PortableAccessDecision[] = [];

  constructor(options: PortableRuntimeOptions) {
    this.db = options.db;
    this.capabilities = options.capabilities;
    this.principalProvider = options.principalProvider ?? (() => DEFAULT_ANONYMOUS_PRINCIPAL);
    this.shadowAccessDecisions = options.shadowAccessDecisions ?? shadowAccessEnabledFromEnvironment();
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

  /** Snapshot of opt-in shadow/enforced decisions for checks/telemetry. */
  accessDecisions(): readonly PortableAccessDecision[] {
    return this.shadowDecisions.slice();
  }

  clearAccessDecisions(): void {
    this.shadowDecisions.length = 0;
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

  private accessHook(def: PortableFunctionDef, principal: PortablePrincipal): void {
    const enforcementEnabled = portableAccessEnforcementEnabled();
    if (!enforcementEnabled && !this.shadowAccessDecisions) return;
    const result: PortableAccessDecision = {
      ...accessDecision(def, principal),
      mode: enforcementEnabled ? "enforced" : "shadow",
    };
    if (this.shadowAccessDecisions && this.shadowDecisions.length < MAX_SHADOW_DECISIONS) {
      this.shadowDecisions.push(result);
    }
    if (!enforcementEnabled) return;
    if (result.decision === "deny") throw new Error(`Access denied: ${result.reason}.`);
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
