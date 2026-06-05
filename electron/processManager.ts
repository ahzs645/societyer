import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import type { DesktopEnvironment } from "./environment.js";
import { makeDesktopLogger } from "./observability.js";

const execFileAsync = promisify(execFile);
const logger = makeDesktopLogger("process-manager");

export type ManagedServiceId =
  | "browser-connectors"
  | "paperless-ngx"
  | "rustfs"
  | "sync-helper"
  | "ai-worker";

export type ManagedServiceState =
  | "disabled"
  | "not-installed"
  | "stopped"
  | "starting"
  | "running"
  | "unhealthy"
  | "stopping"
  | "error";

export type ManagedServiceStatus = {
  id: ManagedServiceId;
  label: string;
  state: ManagedServiceState;
  manageable: boolean;
  message?: string;
  composeFile?: string;
};

const CONNECTOR_CONTAINERS = [
  "societyer-connector-runner",
  "societyer-blitzbrowser",
  "societyer-blitzbrowser-dashboard",
];

export async function listManagedServiceStatuses(environment: DesktopEnvironment) {
  return [await getManagedServiceStatus(environment, "browser-connectors")];
}

export async function getManagedServiceStatus(
  environment: DesktopEnvironment,
  serviceId: ManagedServiceId,
): Promise<ManagedServiceStatus> {
  if (serviceId !== "browser-connectors") {
    return {
      id: serviceId,
      label: labelForManagedService(serviceId),
      state: "disabled",
      manageable: false,
      message: "Process management is not implemented for this optional service yet.",
    };
  }

  const composeFile = resolveComposeFile(environment);
  if (!(await pathExists(composeFile))) {
    return {
      id: serviceId,
      label: labelForManagedService(serviceId),
      state: "not-installed",
      manageable: false,
      composeFile,
      message: "docker-compose.yml is not available to the desktop process.",
    };
  }

  const docker = await runDocker(["--version"]);
  if (!docker.ok) {
    return {
      id: serviceId,
      label: labelForManagedService(serviceId),
      state: "not-installed",
      manageable: false,
      composeFile,
      message: "Docker is not installed or is not on PATH.",
    };
  }

  const compose = await runDocker(["compose", "version"]);
  if (!compose.ok) {
    return {
      id: serviceId,
      label: labelForManagedService(serviceId),
      state: "not-installed",
      manageable: false,
      composeFile,
      message: "Docker Compose is not available.",
    };
  }

  const ps = await runDocker([
    "compose",
    "--profile",
    "connectors",
    "-f",
    composeFile,
    "ps",
    "--format",
    "json",
  ]);
  if (!ps.ok) {
    return {
      id: serviceId,
      label: labelForManagedService(serviceId),
      state: "error",
      manageable: true,
      composeFile,
      message: ps.message || "Could not inspect connector containers.",
    };
  }

  const containers = parseDockerComposePsJson(ps.stdout);
  const connectorContainers = containers.filter((container) =>
    CONNECTOR_CONTAINERS.includes(container.name),
  );
  if (connectorContainers.length === 0) {
    return {
      id: serviceId,
      label: labelForManagedService(serviceId),
      state: "stopped",
      manageable: true,
      composeFile,
      message: "Connector stack is not running.",
    };
  }

  const running = connectorContainers.filter((container) => container.state === "running").length;
  return {
    id: serviceId,
    label: labelForManagedService(serviceId),
    state: running === connectorContainers.length ? "running" : "unhealthy",
    manageable: true,
    composeFile,
    message: `${running}/${connectorContainers.length} connector containers are running.`,
  };
}

export async function startManagedService(
  environment: DesktopEnvironment,
  serviceId: ManagedServiceId,
): Promise<ManagedServiceStatus> {
  if (serviceId !== "browser-connectors") return getManagedServiceStatus(environment, serviceId);
  const composeFile = resolveComposeFile(environment);
  await logger.info("starting managed service", { serviceId, composeFile });
  const result = await runDocker([
    "compose",
    "--profile",
    "connectors",
    "-f",
    composeFile,
    "up",
    "-d",
    "connector-runner",
  ]);
  if (!result.ok) {
    await logger.error("managed service start failed", { serviceId, error: result.message });
    return {
      id: serviceId,
      label: labelForManagedService(serviceId),
      state: "error",
      manageable: true,
      composeFile,
      message: result.message || "Could not start connector stack.",
    };
  }
  return getManagedServiceStatus(environment, serviceId);
}

export async function stopManagedService(
  environment: DesktopEnvironment,
  serviceId: ManagedServiceId,
): Promise<ManagedServiceStatus> {
  if (serviceId !== "browser-connectors") return getManagedServiceStatus(environment, serviceId);
  const composeFile = resolveComposeFile(environment);
  await logger.info("stopping managed service", { serviceId, composeFile });
  const result = await runDocker([
    "compose",
    "--profile",
    "connectors",
    "-f",
    composeFile,
    "stop",
    "connector-runner",
    "blitzbrowser",
    "blitzbrowser-dashboard",
  ]);
  if (!result.ok) {
    await logger.error("managed service stop failed", { serviceId, error: result.message });
    return {
      id: serviceId,
      label: labelForManagedService(serviceId),
      state: "error",
      manageable: true,
      composeFile,
      message: result.message || "Could not stop connector stack.",
    };
  }
  return getManagedServiceStatus(environment, serviceId);
}

export function isManagedServiceId(value: string): value is ManagedServiceId {
  return (
    value === "browser-connectors" ||
    value === "paperless-ngx" ||
    value === "rustfs" ||
    value === "sync-helper" ||
    value === "ai-worker"
  );
}

function resolveComposeFile(environment: DesktopEnvironment) {
  return path.resolve(environment.dirname, "../../docker-compose.yml");
}

async function runDocker(args: string[]) {
  try {
    const result = await execFileAsync("docker", args, {
      timeout: 30_000,
      maxBuffer: 1024 * 1024,
    });
    return { ok: true as const, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    const details = error as { stdout?: string; stderr?: string; message?: string };
    return {
      ok: false as const,
      stdout: details.stdout ?? "",
      stderr: details.stderr ?? "",
      message: details.stderr || details.message,
    };
  }
}

function parseDockerComposePsJson(raw: string): Array<{ name: string; state: string }> {
  const trimmed = raw.trim();
  if (!trimmed) return [];
  try {
    const parsed = JSON.parse(trimmed);
    const rows = Array.isArray(parsed) ? parsed : [parsed];
    return rows.flatMap(toContainerRow);
  } catch {
    return trimmed
      .split("\n")
      .flatMap((line) => {
        try {
          return toContainerRow(JSON.parse(line));
        } catch {
          return [];
        }
      });
  }
}

function toContainerRow(value: unknown): Array<{ name: string; state: string }> {
  if (!value || typeof value !== "object") return [];
  const row = value as { Name?: unknown; Service?: unknown; State?: unknown };
  const name = typeof row.Name === "string" ? row.Name : typeof row.Service === "string" ? row.Service : "";
  const state = typeof row.State === "string" ? row.State.toLowerCase() : "";
  return name && state ? [{ name, state }] : [];
}

async function pathExists(filePath: string) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function labelForManagedService(serviceId: ManagedServiceId) {
  if (serviceId === "browser-connectors") return "Browser connector Docker stack";
  if (serviceId === "paperless-ngx") return "Paperless-ngx";
  if (serviceId === "rustfs") return "RustFS";
  if (serviceId === "sync-helper") return "Sync helper";
  return "AI/local worker";
}
