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

type WorkspaceDatabaseBinding = {
  databaseName: string;
  workspaceId: string;
};

type WorkspaceBindingStorage = Pick<Storage, "getItem" | "setItem">;

export async function desktopWorkspaceDatabaseBinding(
  runtime: RuntimeDescriptor,
  options: {
    bridge?: Pick<NonNullable<ReturnType<typeof getDesktopBridge>>, "getWorkspaceInfo">;
    storage?: WorkspaceBindingStorage;
  } = {},
): Promise<WorkspaceDatabaseBinding> {
  const legacyDatabaseName = localWorkspaceDatabaseName(runtime, "workspace");
  const bridge = options.bridge ?? getDesktopBridge();
  if (!bridge) {
    throw new Error("Desktop workspace database binding requires the Electron bridge.");
  }
  const workspace = await bridge.getWorkspaceInfo();
  if (!workspace?.id) {
    throw new Error("Desktop workspace database binding requires a workspace ID.");
  }

  const workspaceId = workspaceDatabaseKey(workspace.id);
  const bindingKey = `societyer.desktop.legacyDexieWorkspace.${legacyDatabaseName}`;
  const storage = options.storage ?? localStorage;
  const legacyWorkspaceId = storage.getItem(bindingKey);
  if (legacyWorkspaceId && legacyWorkspaceId !== workspace.id) {
    return { databaseName: `societyer-local-${workspaceId}`, workspaceId };
  }

  if (workspace.legacyDexieWorkspace || legacyWorkspaceId === workspace.id) {
    if (!legacyWorkspaceId) storage.setItem(bindingKey, workspace.id);
    return { databaseName: legacyDatabaseName, workspaceId };
  }

  return {
    databaseName: `societyer-local-${workspaceId}`,
    workspaceId,
  };
}

function localWorkspaceDatabaseName(runtime: RuntimeDescriptor, seedMode: "demo" | "workspace") {
  return `societyer-local-${localWorkspaceId(runtime, seedMode)}`;
}

function localWorkspaceId(runtime: RuntimeDescriptor, seedMode: "demo" | "workspace") {
  const configured = import.meta.env?.VITE_LOCAL_WORKSPACE_ID as string | undefined;
  const rawKey = configured || `${runtime.mode}-${runtime.documentStorage}-${seedMode}`;
  return slugifyLocalWorkspaceKey(rawKey);
}

function slugifyLocalWorkspaceKey(value: string) {
  return value.replace(/[^a-z0-9_-]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase() || "workspace";
}

function workspaceDatabaseKey(value: string) {
  const slug = slugifyLocalWorkspaceKey(value);
  if (value === slug) return slug;
  let encoded = "";
  for (let index = 0; index < value.length; index += 1) {
    encoded += `%${value.charCodeAt(index).toString(16).padStart(4, "0")}`;
  }
  return `${slug}--${encoded}`;
}
