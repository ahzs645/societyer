import { StaticConvexClient } from "./staticConvex";
import { DexieWorkspaceClient } from "./dexieWorkspaceClient";
import { getDesktopBridge } from "./desktopBridge";
import { getRuntimeDescriptor, type RuntimeDescriptor } from "./runtimeMode";
import { isStaticDemoRuntime } from "./staticRuntime";

export type LocalWorkspaceAdapter = {
  client: StaticConvexClient;
  runtime: RuntimeDescriptor;
  reseed(): void;
};

export async function createLocalWorkspaceAdapter(): Promise<LocalWorkspaceAdapter> {
  const runtime = getRuntimeDescriptor();
  const client = await createLocalClient(runtime);
  return {
    client,
    runtime,
    reseed: () => client.reseedStaticDemo(),
  };
}

async function createLocalClient(runtime: RuntimeDescriptor) {
  if (runtime.mode === "electron-local" && !isStaticDemoRuntime()) {
    const { databaseName, workspaceId } = await desktopWorkspaceDatabaseBinding(runtime);
    return new DexieWorkspaceClient({
      databaseName,
      workspaceId,
    });
  }
  return new StaticConvexClient({ databaseName: localWorkspaceDatabaseName(runtime, "demo") });
}

async function desktopWorkspaceDatabaseBinding(runtime: RuntimeDescriptor) {
  const legacyDatabaseName = localWorkspaceDatabaseName(runtime, "workspace");
  const workspace = await getDesktopBridge()?.getWorkspaceInfo();
  if (!workspace?.id) {
    return {
      databaseName: legacyDatabaseName,
      workspaceId: localWorkspaceId(runtime, "workspace"),
    };
  }

  const workspaceId = slugifyLocalWorkspaceKey(workspace.id);
  const bindingKey = `societyer.desktop.legacyDexieWorkspace.${legacyDatabaseName}`;
  const legacyWorkspaceId = localStorage.getItem(bindingKey);
  if (!legacyWorkspaceId) {
    localStorage.setItem(bindingKey, workspace.id);
    return { databaseName: legacyDatabaseName, workspaceId };
  }

  return {
    databaseName: legacyWorkspaceId === workspace.id
      ? legacyDatabaseName
      : `societyer-local-${workspaceId}`,
    workspaceId,
  };
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
