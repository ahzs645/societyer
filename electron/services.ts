import { readDesktopConfig, updateDesktopConfig } from "./config.js";
import { makeDesktopLogger } from "./observability.js";

const logger = makeDesktopLogger("services");

export type DesktopServiceId =
  | "browser-connectors"
  | "rustfs-s3"
  | "paperless-ngx"
  | "sync-helper"
  | "ai-worker";

export type DesktopServiceConfig = {
  serviceId: DesktopServiceId;
  endpoint?: string;
  enabled?: boolean;
};

export type DesktopServiceStatus = {
  id: DesktopServiceId;
  label: string;
  configured: boolean;
  ok: boolean;
  endpoint?: string;
  message?: string;
};

export type DesktopServiceProfile = {
  id: string;
  name: string;
  services: Record<string, { endpoint?: string; enabled?: boolean }>;
  updatedAtISO: string;
  active: boolean;
};

const SERVICES: Record<DesktopServiceId, { label: string; healthPath?: string }> = {
  "browser-connectors": { label: "Browser connector Docker runner", healthPath: "/healthz" },
  "rustfs-s3": { label: "RustFS/S3 replication" },
  "paperless-ngx": { label: "Paperless-ngx" },
  "sync-helper": { label: "Sync helper" },
  "ai-worker": { label: "AI/local worker" },
};

export function isDesktopServiceId(value: string): value is DesktopServiceId {
  return value in SERVICES;
}

export async function getServiceConfig(serviceId: DesktopServiceId): Promise<DesktopServiceConfig> {
  const config = await readDesktopConfig();
  return {
    serviceId,
    endpoint: config.services?.[serviceId]?.endpoint,
    enabled: config.services?.[serviceId]?.enabled,
  };
}

export async function saveServiceConfig(input: DesktopServiceConfig): Promise<DesktopServiceConfig> {
  await updateDesktopConfig({
    services: {
      [input.serviceId]: {
        endpoint: input.endpoint?.trim() || undefined,
        enabled: input.enabled,
      },
    },
  });
  return getServiceConfig(input.serviceId);
}

export async function listServiceStatuses(): Promise<DesktopServiceStatus[]> {
  return Promise.all((Object.keys(SERVICES) as DesktopServiceId[]).map((id) => checkService(id)));
}

export async function listServiceProfiles(): Promise<DesktopServiceProfile[]> {
  const config = await readDesktopConfig();
  return Object.values(config.serviceProfiles ?? {}).map((profile) => ({
    ...profile,
    active: profile.id === config.activeServiceProfileId,
  }));
}

export async function saveCurrentServiceProfile(input: { id: string; name: string }) {
  const config = await readDesktopConfig();
  const id = sanitizeProfileId(input.id);
  const profile = {
    id,
    name: input.name.trim() || "Service profile",
    services: config.services ?? {},
    updatedAtISO: new Date().toISOString(),
  };
  await updateDesktopConfig({
    serviceProfiles: { [id]: profile },
    activeServiceProfileId: id,
  });
  return { ...profile, active: true };
}

export async function activateServiceProfile(id: string) {
  const config = await readDesktopConfig();
  const profile = config.serviceProfiles?.[id];
  if (!profile) throw new Error("Service profile not found.");
  await updateDesktopConfig({
    services: profile.services,
    activeServiceProfileId: id,
  });
  return { ...profile, active: true };
}

export async function checkService(serviceId: DesktopServiceId): Promise<DesktopServiceStatus> {
  const service = SERVICES[serviceId];
  const config = await getServiceConfig(serviceId);
  const endpoint = config.endpoint?.trim();
  if (!endpoint) {
    return {
      id: serviceId,
      label: service.label,
      configured: false,
      ok: false,
      message: "No endpoint configured.",
    };
  }

  if (!service.healthPath) {
    return {
      id: serviceId,
      label: service.label,
      configured: true,
      ok: false,
      endpoint,
      message: "Health checks are not implemented for this optional service yet.",
    };
  }

  try {
    const response = await fetch(new URL(service.healthPath, endpoint).toString());
    return {
      id: serviceId,
      label: service.label,
      configured: true,
      ok: response.ok,
      endpoint,
      message: response.ok ? "Service is available." : `Service returned ${response.status}.`,
    };
  } catch (error) {
    await logger.warn("service health check failed", { serviceId, endpoint, error });
    return {
      id: serviceId,
      label: service.label,
      configured: true,
      ok: false,
      endpoint,
      message: error instanceof Error ? error.message : "Service is unavailable.",
    };
  }
}

function sanitizeProfileId(value: string) {
  return value.trim().replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 80) || "default";
}
