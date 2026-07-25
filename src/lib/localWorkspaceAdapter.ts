import { StaticConvexClient } from "./staticConvex";
import { DexieWorkspaceClient } from "./dexieWorkspaceClient";
import { getRuntimeDescriptor, type RuntimeDescriptor } from "./runtimeMode";
import { isStaticDemoRuntime } from "./staticRuntime";

export type LocalWorkspaceAdapter = {
  client: StaticConvexClient;
  runtime: RuntimeDescriptor;
  reseed(): void;
};

export function createLocalWorkspaceAdapter(): LocalWorkspaceAdapter {
  const runtime = getRuntimeDescriptor();
  const client = createLocalClient(runtime);
  return {
    client,
    runtime,
    reseed: () => client.reseedStaticDemo(),
  };
}

function createLocalClient(runtime: RuntimeDescriptor) {
  if (runtime.mode === "electron-local" && !isStaticDemoRuntime()) {
    const workspaceId = localWorkspaceId(runtime, "workspace");
    return new DexieWorkspaceClient({
      databaseName: `societyer-local-${workspaceId}`,
      workspaceId,
    });
  }
  return new StaticConvexClient({ databaseName: localWorkspaceDatabaseName(runtime, "demo") });
}

function localWorkspaceDatabaseName(runtime: RuntimeDescriptor, seedMode: "demo" | "workspace") {
  return `societyer-local-${localWorkspaceId(runtime, seedMode)}`;
}

function localWorkspaceId(runtime: RuntimeDescriptor, seedMode: "demo" | "workspace") {
  const configured = import.meta.env.VITE_LOCAL_WORKSPACE_ID as string | undefined;
  const rawKey = configured || `${runtime.mode}-${runtime.documentStorage}-${seedMode}`;
  return slugifyLocalWorkspaceKey(rawKey);
}

function slugifyLocalWorkspaceKey(value: string) {
  return value.replace(/[^a-z0-9_-]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase() || "workspace";
}
