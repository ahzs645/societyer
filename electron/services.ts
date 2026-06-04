import { readDesktopConfig, updateDesktopConfig } from "./config.js";

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
