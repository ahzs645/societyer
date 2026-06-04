import { app } from "electron";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

export type DesktopConfig = {
  workspaceRoot?: string;
  setupComplete?: boolean;
};

function configPath() {
  return path.join(app.getPath("userData"), "desktop-config.json");
}

export async function readDesktopConfig(): Promise<DesktopConfig> {
  try {
    const parsed = JSON.parse(await readFile(configPath(), "utf8"));
    return {
      workspaceRoot: typeof parsed.workspaceRoot === "string" ? parsed.workspaceRoot : undefined,
      setupComplete: parsed.setupComplete === true,
    };
  } catch {
    return {};
  }
}

export async function writeDesktopConfig(next: DesktopConfig) {
  await mkdir(app.getPath("userData"), { recursive: true });
  const targetPath = configPath();
  const tempPath = `${targetPath}.${process.pid}.${randomUUID().replace(/-/g, "")}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(next, null, 2)}\n`);
  await rename(tempPath, targetPath);
}

export async function updateDesktopConfig(patch: DesktopConfig) {
  const current = await readDesktopConfig();
  const next = { ...current, ...patch };
  await writeDesktopConfig(next);
  return next;
}
