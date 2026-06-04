import { app } from "electron";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

import type { DesktopServiceConfig, DesktopServiceId } from "./services.js";

export type DesktopServiceProfileKind =
  | "local-only"
  | "browser-imports"
  | "rustfs-replication"
  | "paperless"
  | "full-assisted";

export type DesktopServiceProfile = {
  id: string;
  name: string;
  kind: DesktopServiceProfileKind;
  services: Partial<Record<DesktopServiceId, Omit<DesktopServiceConfig, "serviceId">>>;
  updatedAtISO: string;
  active: boolean;
};

type PersistedServiceProfile = Omit<DesktopServiceProfile, "active">;

type ServiceProfilesDocument = {
  version: 1;
  activeProfileId?: string;
  profiles: Record<string, PersistedServiceProfile>;
};

const PROFILE_KINDS = new Set<DesktopServiceProfileKind>([
  "local-only",
  "browser-imports",
  "rustfs-replication",
  "paperless",
  "full-assisted",
]);

export function serviceProfilesPath() {
  return path.join(app.getPath("userData"), "service-profiles.json");
}

export async function readServiceProfilesDocument(): Promise<ServiceProfilesDocument> {
  try {
    const parsed = JSON.parse(await readFile(serviceProfilesPath(), "utf8"));
    return normalizeServiceProfilesDocument(parsed);
  } catch {
    return { version: 1, profiles: {} };
  }
}

export async function writeServiceProfilesDocument(next: ServiceProfilesDocument) {
  await mkdir(app.getPath("userData"), { recursive: true });
  const targetPath = serviceProfilesPath();
  const tempPath = `${targetPath}.${process.pid}.${randomUUID().replace(/-/g, "")}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(next, null, 2)}\n`);
  await rename(tempPath, targetPath);
}

export async function listServiceProfilesFromRegistry(): Promise<DesktopServiceProfile[]> {
  const document = await readServiceProfilesDocument();
  return Object.values(document.profiles).map((profile) => ({
    ...profile,
    active: profile.id === document.activeProfileId,
  }));
}

export async function saveServiceProfileToRegistry(input: {
  id: string;
  name: string;
  kind?: DesktopServiceProfileKind;
  services: DesktopServiceProfile["services"];
}): Promise<DesktopServiceProfile> {
  const document = await readServiceProfilesDocument();
  const id = sanitizeProfileId(input.id);
  const profile: PersistedServiceProfile = {
    id,
    name: input.name.trim() || "Service profile",
    kind: input.kind ?? inferProfileKind(input.services),
    services: normalizeServices(input.services),
    updatedAtISO: new Date().toISOString(),
  };
  const next = {
    version: 1 as const,
    activeProfileId: id,
    profiles: { ...document.profiles, [id]: profile },
  };
  await writeServiceProfilesDocument(next);
  return { ...profile, active: true };
}

export async function activateServiceProfileFromRegistry(id: string): Promise<DesktopServiceProfile> {
  const document = await readServiceProfilesDocument();
  const profile = document.profiles[id];
  if (!profile) throw new Error("Service profile not found.");
  await writeServiceProfilesDocument({ ...document, activeProfileId: id });
  return { ...profile, active: true };
}

function normalizeServiceProfilesDocument(value: unknown): ServiceProfilesDocument {
  if (!value || typeof value !== "object") return { version: 1, profiles: {} };
  const raw = value as { activeProfileId?: unknown; profiles?: unknown };
  const profiles: Record<string, PersistedServiceProfile> = {};
  if (raw.profiles && typeof raw.profiles === "object") {
    for (const [id, profile] of Object.entries(raw.profiles)) {
      if (!profile || typeof profile !== "object") continue;
      const parsed = normalizeProfile(id, profile);
      if (parsed) profiles[parsed.id] = parsed;
    }
  }
  return {
    version: 1,
    activeProfileId: typeof raw.activeProfileId === "string" ? raw.activeProfileId : undefined,
    profiles,
  };
}

function normalizeProfile(id: string, value: object): PersistedServiceProfile | null {
  const raw = value as {
    name?: unknown;
    kind?: unknown;
    services?: unknown;
    updatedAtISO?: unknown;
  };
  const safeId = sanitizeProfileId(id);
  return {
    id: safeId,
    name: typeof raw.name === "string" && raw.name.trim() ? raw.name : "Service profile",
    kind: isServiceProfileKind(raw.kind) ? raw.kind : inferProfileKind(normalizeServices(raw.services)),
    services: normalizeServices(raw.services),
    updatedAtISO: typeof raw.updatedAtISO === "string" ? raw.updatedAtISO : new Date().toISOString(),
  };
}

function normalizeServices(value: unknown): DesktopServiceProfile["services"] {
  if (!value || typeof value !== "object") return {};
  const services: DesktopServiceProfile["services"] = {};
  for (const [serviceId, raw] of Object.entries(value)) {
    if (!raw || typeof raw !== "object") continue;
    const service = raw as { endpoint?: unknown; enabled?: unknown };
    services[serviceId as DesktopServiceId] = {
      endpoint: typeof service.endpoint === "string" ? service.endpoint : undefined,
      enabled: typeof service.enabled === "boolean" ? service.enabled : undefined,
    };
  }
  return services;
}

function inferProfileKind(services: DesktopServiceProfile["services"]): DesktopServiceProfileKind {
  const enabled = Object.entries(services).filter(([, service]) => service?.enabled !== false && service?.endpoint);
  if (enabled.length === 0) return "local-only";
  if (enabled.some(([id]) => id === "paperless-ngx")) return "paperless";
  if (enabled.some(([id]) => id === "rustfs-s3")) return "rustfs-replication";
  if (enabled.some(([id]) => id === "browser-connectors")) return "browser-imports";
  return "full-assisted";
}

function isServiceProfileKind(value: unknown): value is DesktopServiceProfileKind {
  return typeof value === "string" && PROFILE_KINDS.has(value as DesktopServiceProfileKind);
}

function sanitizeProfileId(value: string) {
  return value.trim().replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 80) || "default";
}
