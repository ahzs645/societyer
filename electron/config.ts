import { app } from "electron";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { normalizeHostedConfiguration, type HostedDesktopConfiguration } from "./desktopModePolicy.js";

export type DesktopConfig = {
  desktopMode?: "local" | "online";
  hostedApplication?: HostedDesktopConfiguration;
  workspaceRoot?: string;
  legacyDexieWorkspaceId?: string;
  legacyDexieMigrationComplete?: boolean;
  setupComplete?: boolean;
  updateChannel?: "stable" | "beta" | "nightly";
  services?: Record<string, { endpoint?: string; enabled?: boolean }>;
  serviceProfiles?: Record<string, {
    id: string;
    name: string;
    services: Record<string, { endpoint?: string; enabled?: boolean }>;
    updatedAtISO: string;
  }>;
  activeServiceProfileId?: string;
};

function configPath() {
  return path.join(app.getPath("userData"), "desktop-config.json");
}

export async function readDesktopConfig(): Promise<DesktopConfig> {
  try {
    const parsed = JSON.parse(await readFile(configPath(), "utf8"));
    return {
      desktopMode: parsed.desktopMode === "online" ? "online" : "local",
      hostedApplication: parseHostedConfiguration(parsed.hostedApplication),
      workspaceRoot: typeof parsed.workspaceRoot === "string" ? parsed.workspaceRoot : undefined,
      legacyDexieWorkspaceId: typeof parsed.legacyDexieWorkspaceId === "string"
        ? parsed.legacyDexieWorkspaceId
        : undefined,
      legacyDexieMigrationComplete: parsed.legacyDexieMigrationComplete === true,
      setupComplete: parsed.setupComplete === true,
      updateChannel: parseUpdateChannel(parsed.updateChannel),
      services: parseServices(parsed.services),
      serviceProfiles: parseServiceProfiles(parsed.serviceProfiles),
      activeServiceProfileId: typeof parsed.activeServiceProfileId === "string" ? parsed.activeServiceProfileId : undefined,
    };
  } catch {
    return {};
  }
}

function parseHostedConfiguration(value: unknown): HostedDesktopConfiguration | undefined {
  if (!value || typeof value !== "object") return undefined;
  try { return normalizeHostedConfiguration(value as HostedDesktopConfiguration); } catch { return undefined; }
}

export async function writeDesktopConfig(next: DesktopConfig) {
  await mkdir(app.getPath("userData"), { recursive: true });
  const targetPath = configPath();
  const tempPath = `${targetPath}.${process.pid}.${randomUUID().replace(/-/g, "")}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(next, null, 2)}\n`);
  await rename(tempPath, targetPath);
}

let configUpdates: Promise<unknown> = Promise.resolve();

export function updateDesktopConfig(patch: DesktopConfig): Promise<DesktopConfig> {
  const operation = configUpdates.then(async () => {
    const current = await readDesktopConfig();
    const next = {
      ...current,
      ...patch,
      services: { ...current.services, ...patch.services },
      serviceProfiles: { ...current.serviceProfiles, ...patch.serviceProfiles },
    };
    await writeDesktopConfig(next);
    return next;
  });
  configUpdates = operation.catch(() => undefined);
  return operation;
}

function parseServiceProfiles(value: unknown): DesktopConfig["serviceProfiles"] {
  if (!value || typeof value !== "object") return undefined;
  const profiles: NonNullable<DesktopConfig["serviceProfiles"]> = {};
  for (const [id, raw] of Object.entries(value)) {
    if (!raw || typeof raw !== "object") continue;
    const profile = raw as { name?: unknown; services?: unknown; updatedAtISO?: unknown };
    profiles[id] = {
      id,
      name: typeof profile.name === "string" ? profile.name : "Service profile",
      services: parseServices(profile.services) ?? {},
      updatedAtISO: typeof profile.updatedAtISO === "string" ? profile.updatedAtISO : new Date().toISOString(),
    };
  }
  return profiles;
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
