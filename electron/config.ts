import { app } from "electron";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

export type DesktopConfig = {
  workspaceRoot?: string;
  setupComplete?: boolean;
  updateChannel?: "stable" | "beta" | "nightly";
  services?: Record<string, { endpoint?: string; enabled?: boolean }>;
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
      updateChannel: parseUpdateChannel(parsed.updateChannel),
      services: parseServices(parsed.services),
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
  const next = { ...current, ...patch, services: { ...current.services, ...patch.services } };
  await writeDesktopConfig(next);
  return next;
}

function parseUpdateChannel(value: unknown): DesktopConfig["updateChannel"] {
  return value === "stable" || value === "beta" || value === "nightly" ? value : undefined;
}

function parseServices(value: unknown): DesktopConfig["services"] {
  if (!value || typeof value !== "object") return undefined;
  const services: NonNullable<DesktopConfig["services"]> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (!raw || typeof raw !== "object") continue;
    const service = raw as { endpoint?: unknown; enabled?: unknown };
    services[key] = {
      endpoint: typeof service.endpoint === "string" ? service.endpoint : undefined,
      enabled: typeof service.enabled === "boolean" ? service.enabled : undefined,
    };
  }
  return services;
}
