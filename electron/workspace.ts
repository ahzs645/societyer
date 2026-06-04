import { app } from "electron";
import { randomUUID } from "node:crypto";
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { readDesktopConfig, updateDesktopConfig } from "./config.js";

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
