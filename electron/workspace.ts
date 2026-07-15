import { app } from "electron";
import { randomUUID } from "node:crypto";
import { cp, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

import { readDesktopConfig, updateDesktopConfig } from "./config.js";
import { openPath } from "./shell.js";

export type WorkspaceInfo = {
  id: string;
  name: string;
  rootPath: string;
  schemaVersion: number;
  createdAtISO: string;
  updatedAtISO: string;
};

let workspaceRoot: string | null = null;
let workspaceInfo: WorkspaceInfo | null = null;

export const LOCAL_WORKSPACE_SNAPSHOT_FILE = "records-snapshot.json";
export const PERSIST_LOCAL_WORKSPACE_SNAPSHOT_CHANNEL = "societyer:persistLocalWorkspaceSnapshot";

export async function ensureWorkspace() {
  if (workspaceRoot && workspaceInfo) return { root: workspaceRoot, info: workspaceInfo };

  const config = await readDesktopConfig();
  const root =
    process.env.SOCIETYER_WORKSPACE_DIR ||
    config.workspaceRoot ||
    path.join(app.getPath("userData"), "workspace");
  workspaceRoot = root;
  workspaceInfo = await readOrCreateWorkspaceInfo(root);
  return { root, info: workspaceInfo };
}

export async function selectWorkspace(root: string) {
  workspaceRoot = root;
  workspaceInfo = await readOrCreateWorkspaceInfo(root);
  await updateDesktopConfig({ workspaceRoot });
  return workspaceInfo;
}

export async function readOrCreateWorkspaceInfo(root: string): Promise<WorkspaceInfo> {
  await mkdir(root, { recursive: true });
  const workspacePath = path.join(root, "workspace.json");
  try {
    const parsed = JSON.parse(await readFile(workspacePath, "utf8"));
    const now = new Date().toISOString();
    const info = {
      id: String(parsed.id || randomUUID()),
      name: String(parsed.name || "Societyer Workspace"),
      rootPath: root,
      schemaVersion: Number(parsed.schemaVersion || 1),
      createdAtISO: String(parsed.createdAtISO || now),
      updatedAtISO: now,
    };
    await writeFile(workspacePath, JSON.stringify(info, null, 2));
    return info;
  } catch {
    const now = new Date().toISOString();
    const info = {
      id: randomUUID(),
      name: "Societyer Workspace",
      rootPath: root,
      schemaVersion: 1,
      createdAtISO: now,
      updatedAtISO: now,
    };
    await writeFile(workspacePath, JSON.stringify(info, null, 2));
    return info;
  }
}

export function resolveWorkspaceKey(root: string, key: string) {
  const resolved = path.resolve(root, key);
  const rootResolved = path.resolve(root);
  if (resolved !== rootResolved && !resolved.startsWith(`${rootResolved}${path.sep}`)) {
    throw new Error("Workspace key is outside the workspace.");
  }
  return resolved;
}

export async function persistLocalWorkspaceSnapshot(serializedSnapshot: string) {
  let snapshot: unknown;
  try {
    snapshot = JSON.parse(serializedSnapshot);
  } catch {
    throw new Error("Local workspace snapshot is not valid JSON.");
  }
  if (
    !snapshot ||
    typeof snapshot !== "object" ||
    Array.isArray(snapshot) ||
    (snapshot as { kind?: unknown }).kind !== "societyer.localWorkspaceSnapshot" ||
    !(snapshot as { tables?: unknown }).tables ||
    typeof (snapshot as { tables?: unknown }).tables !== "object" ||
    Array.isArray((snapshot as { tables?: unknown }).tables)
  ) {
    throw new Error("Local workspace snapshot has an invalid format.");
  }

  const { root } = await ensureWorkspace();
  const snapshotPath = resolveWorkspaceKey(root, LOCAL_WORKSPACE_SNAPSHOT_FILE);
  const temporaryPath = resolveWorkspaceKey(root, `.${LOCAL_WORKSPACE_SNAPSHOT_FILE}.${randomUUID()}.tmp`);
  try {
    await writeFile(temporaryPath, serializedSnapshot, "utf8");
    await rename(temporaryPath, snapshotPath);
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
  return { path: snapshotPath };
}

export async function createBackup() {
  const { root } = await ensureWorkspace();
  const backupRoot = path.join(root, "backups");
  await mkdir(backupRoot, { recursive: true });
  const backupPath = path.join(
    backupRoot,
    `backup-${new Date().toISOString().replace(/[:.]/g, "-")}`,
  );
  await cp(root, backupPath, {
    recursive: true,
    filter: (source) => !source.startsWith(backupRoot),
  });
  return { path: backupPath };
}

export async function openWorkspaceFolder() {
  const { root } = await ensureWorkspace();
  await openPath(root);
}

export async function openBackupFolder(backupPath?: string) {
  const { root } = await ensureWorkspace();
  const backupRoot = path.join(root, "backups");
  const target = backupPath ? resolveWorkspaceKey(root, backupPath) : backupRoot;
  const targetResolved = path.resolve(target);
  const backupRootResolved = path.resolve(backupRoot);
  if (targetResolved !== backupRootResolved && !targetResolved.startsWith(`${backupRootResolved}${path.sep}`)) {
    throw new Error("Backup folder is outside the workspace backups directory.");
  }
  await mkdir(targetResolved, { recursive: true });
  await openPath(targetResolved);
}
