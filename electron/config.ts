import { app } from "electron";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

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
  await writeFile(configPath(), JSON.stringify(next, null, 2));
}

export async function updateDesktopConfig(patch: DesktopConfig) {
  const current = await readDesktopConfig();
  const next = { ...current, ...patch };
  await writeDesktopConfig(next);
  return next;
}
