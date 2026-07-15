import { RECORD_TABLE_OBJECTS } from "../../convex/recordTableMetadataDefinitions";
import { PortableRuntime } from "../../shared/portable/define";
import type { PortablePrincipal } from "../../shared/portable/ctx";
import { LocalStoreDb } from "../../shared/portable/localRowStore";
import { PORTABLE_FUNCTIONS } from "../../shared/functions/registry";
import { buildLocalCapabilities } from "./localCapabilities";
import type { LocalWorkspaceSnapshot } from "./localDexieRowStore";
import { PortableQueryCache } from "./portableQueryCache";
import {
  mutableQueryResult,
  mutationResult,
  portableSyncStub,
} from "./staticLegacyDispatch";
import {
  STATIC_DEMO_SEED,
  StaticDemoDexieStore,
  type StaticDemoSeed,
} from "./staticDemoStore";
import type { StaticArgs } from "./staticConvexFixtures";
import { STATIC_DEMO_SOCIETY_ID, STATIC_DEMO_USER_ID } from "./staticIds";

const FUNCTION_NAME = Symbol.for("functionName");
const warnedLegacyFallbacks = new Set<string>();

function functionName(ref: any) {
  if (typeof ref === "string") return ref;
  const name = ref?.[FUNCTION_NAME];
  return typeof name === "string" ? name : "";
}

function warnLegacyFallback(
  name: string,
  registeredKind?: "query" | "mutation",
  invokedVia?: "watchQuery" | "watchPaginatedQuery" | "query" | "mutation" | "action",
) {
  if (warnedLegacyFallbacks.has(name)) return;
  warnedLegacyFallbacks.add(name);
  if (registeredKind && invokedVia) {
    console.warn(
      `[societyer-local] "${name}" is registered as a ${registeredKind} but was invoked via ${invokedVia}(); served by legacy demo fallback`,
    );
    return;
  }
  console.warn(`[societyer-local] "${name}" served by legacy demo fallback (not in the portable registry)`);
}

/** Local ConvexReactClient-compatible protocol shim. */
export class StaticConvexClient {
  private store: StaticDemoDexieStore;
  private clientUrl: string;
  // Phase 1: the live local runtime. Functions registered here run as the REAL
  // portable handler (shared/functions/*) against the Dexie-backed ctx.db,
  // instead of the hand-written mirror case. See docs/portable-functions-architecture.md.
  private portable: PortableRuntime;
  private portableQueries: PortableQueryCache;

  constructor(options?: {
    databaseName?: string;
    seed?: StaticDemoSeed;
    url?: string;
    principalProvider?: () => PortablePrincipal | Promise<PortablePrincipal>;
  }) {
    this.store = new StaticDemoDexieStore(options?.seed ?? STATIC_DEMO_SEED, options);
    this.clientUrl = options?.url ?? "static://societyer-demo";
    this.portable = new PortableRuntime({
      db: new LocalStoreDb(this.store.rowStore),
      // Local workspaces have no server-only services wired by default; calling
      // one throws a structured CAPABILITY_UNAVAILABLE rather than silently no-op.
      // buildLocalCapabilities is the seam where native Electron capabilities wire in.
      capabilities: buildLocalCapabilities(),
      principalProvider: options?.principalProvider ?? (() => ({
        kind: "user",
        runtime: "browser-local",
        assurance: "trusted-workspace",
        subject: "demo:static_user_owner",
        userId: STATIC_DEMO_USER_ID,
        societyId: STATIC_DEMO_SOCIETY_ID,
      })),
    }).registerAll(PORTABLE_FUNCTIONS);
    this.portableQueries = new PortableQueryCache(
      this.portable,
      this.store,
      (name, args) => portableSyncStub(name, args, this.store),
    );
    // Seed the Twenty-style record-table metadata for the demo society up front,
    // so RecordTable pages (members, assets, …) render immediately instead of
    // showing the "Metadata not seeded" empty state on first visit. Idempotent.
    void this.ensureRecordTableMetadata();
  }

  /** Fire-and-forget metadata seed for every society in the demo store. */
  private async ensureRecordTableMetadata() {
    try {
      const societies = this.store.listRows("societies") ?? [];
      for (const society of societies as any[]) {
        await this.portable.runMutation("seedRecordTableMetadata:ensureForSociety", {
          societyId: society._id,
          objects: RECORD_TABLE_OBJECTS,
        });
      }
      this.portableQueries.emit();
    } catch (error) {
      console.warn("[societyer-local] metadata auto-seed failed", error);
    }
  }

  get url() {
    return this.clientUrl;
  }

  watchQuery(query: any, args?: StaticArgs) {
    const name = functionName(query);
    const kind = this.portable.kind(name);
    if (kind === "query") return this.portableQueries.watchQuery(name, args);
    warnLegacyFallback(name, kind, "watchQuery");
    return {
      onUpdate: (callback: () => void) => this.store.onUpdate(callback),
      localQueryResult: () => mutableQueryResult(name, args, this.store),
      journal: () => undefined,
    };
  }

  watchPaginatedQuery(
    query: any,
    args?: StaticArgs,
    options?: { initialNumItems?: number; id?: number },
  ) {
    const name = functionName(query);
    const kind = this.portable.kind(name);
    if (kind === "query") return this.portableQueries.watchPaginatedQuery(name, args, options);
    warnLegacyFallback(name, kind, "watchPaginatedQuery");
    return {
      onUpdate: (callback: () => void) => this.store.onUpdate(callback),
      localQueryResult: () => ({
        results: mutableQueryResult(name, args, this.store) ?? [],
        status: "Exhausted",
        loadMore: () => undefined,
      }),
    };
  }

  query(query: any, args?: StaticArgs) {
    const name = functionName(query);
    const kind = this.portable.kind(name);
    if (kind === "query") return this.portable.runQuery(name, args ?? {});
    warnLegacyFallback(name, kind, "query");
    return Promise.resolve(mutableQueryResult(name, args, this.store));
  }

  mutation(mutation: any, args?: StaticArgs) {
    const name = functionName(mutation);
    const kind = this.portable.kind(name);
    if (kind === "mutation") {
      // The Convex wrapper for this mutation injects RECORD_TABLE_OBJECTS before
      // calling the portable handler; the offline runtime has to do the same or
      // the handler iterates `undefined` ("objects is not iterable").
      const enriched =
        name === "seedRecordTableMetadata:ensureForSociety" && !(args as any)?.objects
          ? { ...(args ?? {}), objects: RECORD_TABLE_OBJECTS }
          : args ?? {};
      return this.portable.runMutation(name, enriched);
    }
    warnLegacyFallback(name, kind, "mutation");
    return Promise.resolve(mutationResult(name, args, this.store));
  }

  action(action: any, args?: StaticArgs) {
    const name = functionName(action);
    warnLegacyFallback(name, this.portable.kind(name), "action");
    return Promise.resolve(mutationResult(name, args, this.store));
  }

  prewarmQuery() {
    return undefined;
  }

  connectionState() {
    return { hasInflightRequests: false, isWebSocketConnected: false };
  }

  subscribeToConnectionState() {
    return () => undefined;
  }

  setAuth() {
    return undefined;
  }

  clearAuth() {
    return undefined;
  }

  close() {
    return Promise.resolve();
  }

  get logger() {
    return {
      logVerbose: () => undefined,
      log: () => undefined,
      warn: () => undefined,
      error: () => undefined,
    };
  }

  reseedStaticDemo() {
    return this.store.reseed();
  }

  exportLocalWorkspaceSnapshot() {
    return this.store.exportSnapshot();
  }

  importLocalWorkspaceSnapshot(snapshot: LocalWorkspaceSnapshot) {
    return this.store.importSnapshot(snapshot);
  }
}
