import { getStoredUserId } from "../hooks/useCurrentUser";
import { RECORD_TABLE_OBJECTS } from "../../convex/recordTableMetadataDefinitions";
import { definePortableMutation, definePortableQuery, PortableRuntime } from "../../shared/portable/define";
import { simulateDemoChatPortable } from "../../shared/functions/aiChat";
import type { PortableDoc, PortablePrincipal, RuntimeKind } from "../../shared/portable/ctx";
import { LocalStoreDb } from "../../shared/portable/localRowStore";
import { PORTABLE_FUNCTIONS } from "../../shared/functions/registry";
import { buildLocalCapabilities } from "./localCapabilities";
import type { LocalWorkspaceSnapshot, LocalWorkspaceBinaryFile } from "./localDexieRowStore";
import { PortableQueryCache } from "./portableQueryCache";
import {
  STATIC_DEMO_SEED,
  StaticDemoDexieStore,
  type StaticDemoSeed,
} from "./staticDemoStore";
import type { StaticArgs } from "./staticConvexFixtures";

const FUNCTION_NAME = Symbol.for("functionName");
const warnedLegacyFallbacks = new Set<string>();
const LEGACY_UNTRACKED_READ_ID = "__societyer_legacy_dispatch_reads_every_table__";

export type LocalActorChoice = {
  _id: string;
  displayName: string;
  email: string;
  role: string;
  status?: string;
};

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
  private releasePrincipalListeners?: () => void;

  constructor(options?: {
    databaseName?: string;
    seed?: StaticDemoSeed;
    url?: string;
    principalProvider?: () => PortablePrincipal | Promise<PortablePrincipal>;
    trustedWorkspacePrincipal?: { runtime: RuntimeKind; subject: string };
  }) {
    this.store = new StaticDemoDexieStore(options?.seed ?? STATIC_DEMO_SEED, options);
    this.clientUrl = options?.url ?? "static://societyer-demo";
    this.portable = new PortableRuntime({
      db: new LocalStoreDb(this.store.rowStore),
      // Local workspaces have no server-only services wired by default; calling
      // one throws a structured CAPABILITY_UNAVAILABLE rather than silently no-op.
      // buildLocalCapabilities is the seam where native Electron capabilities wire in.
      capabilities: buildLocalCapabilities(),
      principalProvider: async () => {
        // Seed backfill and persisted rows must settle before any handler can
        // resolve authority or write. Otherwise an early save can race startup
        // backfill, and authority may be taken from the temporary seed rows.
        await this.store.whenHydrated();
        return options?.principalProvider
          ? await options.principalProvider()
          : this.resolveTrustedWorkspacePrincipal(options?.trustedWorkspacePrincipal ?? {
            runtime: "browser-local",
            subject: "demo:static-workspace",
          });
      },
    }).registerAll(PORTABLE_FUNCTIONS);
    if (this.clientUrl === "static://societyer-demo") {
      this.portable.registerAll([definePortableMutation({ name: "aiChatActions:sendChatMessage", applicationPolicy: true, handler: simulateDemoChatPortable })]);
    }
    this.portableQueries = new PortableQueryCache(
      this.portable,
      this.store,
      // Authorized portable results own the cache; fixture fallbacks are never
      // read synchronously. Load the legacy dispatcher only on an actual call.
      () => undefined,
    );
    if (typeof window !== "undefined") {
      const refresh = () => this.portableQueries.invalidatePrincipal();
      const refreshStorage = (event: StorageEvent) => {
        if (event.key === null || event.key === "societyer.currentUserId") refresh();
      };
      window.addEventListener("societyer:user-changed", refresh);
      window.addEventListener("storage", refreshStorage);
      this.releasePrincipalListeners = () => {
        window.removeEventListener("societyer:user-changed", refresh);
        window.removeEventListener("storage", refreshStorage);
      };
    }
    // Seed the Twenty-style record-table metadata for the demo society up front,
    // so RecordTable pages (members, assets, …) render immediately instead of
    // showing the "Metadata not seeded" empty state on first visit. Idempotent.
    void this.ensureRecordTableMetadata();
  }

  /**
   * Bind a desktop principal to rows from its trusted local database, never to
   * request arguments. Owner is the deterministic local operator when present.
   */
  private resolveTrustedWorkspacePrincipal(
    workspace: { runtime: RuntimeKind; subject: string },
  ): PortablePrincipal {
    const users = (this.store.listRows("users") ?? []) as PortableDoc[];
    const eligible = users.filter(
      (row) => typeof row.societyId === "string" && (!row.status || row.status === "Active"),
    );
    const selectedId = typeof window !== "undefined" ? getStoredUserId() : null;
    const user = eligible.find((row) => row._id === selectedId) ?? eligible.find((row) => row.role === "Owner") ?? eligible[0];
    return {
      kind: "user",
      runtime: workspace.runtime,
      assurance: "trusted-workspace",
      subject: workspace.subject,
      ...(user
        ? { userId: user._id, societyId: String(user.societyId) }
        : {}),
    };
  }

  /** Fire-and-forget metadata seed for every society in the demo store. */
  private async ensureRecordTableMetadata() {
    try {
      const societies = this.store.listRows("societies") ?? [];
      for (const society of societies as any[]) {
        await this.seedRecordTableMetadataFor(society._id);
      }
      this.portableQueries.emit();
    } catch (error) {
      console.warn("[societyer-local] metadata auto-seed failed", error);
    }
  }

  private async seedRecordTableMetadataFor(societyId: string) {
    if (!societyId) return;
    await this.portable.runMutation("seedRecordTableMetadata:ensureForSociety", {
      societyId,
      objects: RECORD_TABLE_OBJECTS,
    });
  }

  get url() {
    return this.clientUrl;
  }

  private registerLegacyQuery(name: string) {
    if (this.portable.has(name)) throw new Error(`Function ${name} is not a query.`);
    this.portable.register(definePortableQuery({ name, applicationPolicy: true,
      handler: async (ctx, args) => {
        // The legacy dispatcher reads the store directly, outside ctx.db, so the
        // query cache cannot know its tables. Looking up an id that exists in
        // no table marks the read set unbounded: it refreshes on every write.
        await ctx.db.get(LEGACY_UNTRACKED_READ_ID);
        const { mutableQueryResult } = await import("./staticLegacyDispatch");
        return mutableQueryResult(name, args, this.store);
      },
    }));
  }

  watchQuery(query: any, args?: StaticArgs) {
    const name = functionName(query);
    const kind = this.portable.kind(name);
    if (kind === "query") return this.portableQueries.watchQuery(name, args);
    warnLegacyFallback(name, kind, "watchQuery");
    this.registerLegacyQuery(name);
    return this.portableQueries.watchQuery(name, args);
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
    this.registerLegacyQuery(name);
    return this.portableQueries.watchPaginatedQuery(name, args, options);
  }

  query(query: any, args?: StaticArgs) {
    const name = functionName(query);
    const kind = this.portable.kind(name);
    if (kind === "query") return this.portable.runQuery(name, args ?? {});
    warnLegacyFallback(name, kind, "query");
    return this.portable.authorizeFunction(name, "query", args ?? {}).then(async () => {
      const { mutableQueryResult } = await import("./staticLegacyDispatch");
      return mutableQueryResult(name, args, this.store);
    });
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
    const result = this.portable.authorizeFunction(name, "mutation", args ?? {}).then(async () => {
      const { mutationResult } = await import("./staticLegacyDispatch");
      return mutationResult(name, args, this.store);
    });
    if (name === "society:createWorkspace") {
      // convex/society.createWorkspace seeds the record-table metadata for the
      // new society (seedSociety). The offline mirror doesn't, and the one-shot
      // seed in the constructor only covers societies that already existed — so
      // without this every record page in a freshly created workspace shows
      // "Metadata not seeded", which is the first thing setup hands the operator.
      return result.then(async (value) => {
        try {
          await this.seedRecordTableMetadataFor((value as any)?.societyId);
          this.portableQueries.emit();
        } catch (error) {
          console.warn("[societyer-local] record-table metadata seed failed for the new workspace", error);
        }
        return value;
      });
    }
    return result;
  }

  action(action: any, args?: StaticArgs) {
    const name = functionName(action);
    if (name === "aiChatActions:sendChatMessage") {
      if (this.clientUrl !== "static://societyer-demo") return Promise.reject(new Error("Live AI requires a connected workspace. No local inference engine is configured."));
      return this.portable.runMutation(name, args ?? {});
    }
    warnLegacyFallback(name, this.portable.kind(name), "action");
    return this.portable.authorizeFunction(name, "action", args ?? {}).then(async () => {
      const { mutationResult } = await import("./staticLegacyDispatch");
      return mutationResult(name, args, this.store);
    });
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
    this.releasePrincipalListeners?.();
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

  /** Resolves once the persisted workspace has been read into memory. */
  whenLocalWorkspaceReady() {
    return this.store.whenHydrated();
  }

  /** Physical local-file operator controls, never a hosted/portable endpoint. */
  getLocalActorChoices(societyId: string): LocalActorChoice[] {
    return (this.store.listRows("users") ?? [])
      .filter((row: any) => row.societyId === societyId)
      .map((row: any) => ({
        _id: row._id,
        displayName: row.displayName,
        email: row.email,
        role: row.role,
        status: row.status,
      }));
  }

  subscribeLocalActorChoices(societyId: string, listener: (choices: LocalActorChoice[]) => void) {
    let subscribed = true;
    let hydrated = false;
    const publish = () => {
      if (subscribed && hydrated) listener(this.getLocalActorChoices(societyId));
    };
    const unsubscribe = this.store.onUpdate(publish);
    void this.store.whenHydrated().then(() => { hydrated = true; publish(); });
    return () => { subscribed = false; unsubscribe(); };
  }

  /** Full workspace snapshot (async: heavy fields are read back from IndexedDB). */
  exportLocalWorkspaceSnapshot() {
    return this.store.exportSnapshot();
  }

  importLocalWorkspaceSnapshot(snapshot: LocalWorkspaceSnapshot, files?: LocalWorkspaceBinaryFile[]) {
    return this.store.importSnapshot(snapshot, files);
  }

  readRestoredWorkspaceFile(args: { sha256?: string; provider?: string; storageKey?: string; documentId?: string; versionId?: string }) {
    return this.store.readRestoredFile(args);
  }

  getLocalWorkspaceAttachmentReferences() { return this.store.exportAttachmentReferences(); }

  /** In-place record migrations retain already saved binary files. */
  replaceLocalWorkspaceRecords(snapshot: LocalWorkspaceSnapshot) { return this.store.importSnapshot(snapshot, undefined, true); }
}
