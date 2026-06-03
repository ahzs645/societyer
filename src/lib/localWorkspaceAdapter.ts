import { StaticConvexClient } from "./staticConvex";
import { getRuntimeDescriptor, type RuntimeDescriptor } from "./runtimeMode";

export type LocalWorkspaceAdapter = {
  client: StaticConvexClient;
  runtime: RuntimeDescriptor;
  reseed(): void;
};

export function createLocalWorkspaceAdapter(): LocalWorkspaceAdapter {
  const runtime = getRuntimeDescriptor();
  const client = new StaticConvexClient({ databaseName: localWorkspaceDatabaseName(runtime) });
  return {
    client,
    runtime,
    reseed: () => client.reseedStaticDemo(),
  };
}

function localWorkspaceDatabaseName(runtime: RuntimeDescriptor) {
  const configured = import.meta.env.VITE_LOCAL_WORKSPACE_ID as string | undefined;
  const rawKey = configured || `${runtime.mode}-${runtime.documentStorage}`;
  return `societyer-local-${slugifyLocalWorkspaceKey(rawKey)}`;
}

function slugifyLocalWorkspaceKey(value: string) {
  return value.replace(/[^a-z0-9_-]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase() || "workspace";
}
