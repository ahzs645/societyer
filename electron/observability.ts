import { app } from "electron";
import { randomUUID } from "node:crypto";
import { mkdir, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const MAX_LOG_BYTES = 10 * 1024 * 1024;
const MAX_LOG_FILES = 5;

export type DesktopLogLevel = "debug" | "info" | "warn" | "error";

const runId = randomUUID().replace(/-/g, "").slice(0, 12);

export function getDesktopRunId() {
  return runId;
}

export function getLogDirectory() {
  return path.join(app.getPath("userData"), "logs");
}

export function getMainLogPath() {
  return path.join(getLogDirectory(), "main.log");
}

export async function logDesktopEvent(input: {
  component: string;
  level: DesktopLogLevel;
  message: string;
  details?: unknown;
}) {
  const record = {
    timestamp: new Date().toISOString(),
    runId,
    component: input.component,
    level: input.level,
    message: input.message,
    details: serializeDetails(input.details),
  };
  const line = `${JSON.stringify(record)}\n`;
  try {
    await mkdir(getLogDirectory(), { recursive: true });
    await rotateLogIfNeeded(Buffer.byteLength(line));
    await writeFile(getMainLogPath(), line, { flag: "a" });
  } catch (error) {
    console.error("Societyer desktop log write failed", error);
  }
}

export function makeDesktopLogger(component: string) {
  return {
    debug: (message: string, details?: unknown) =>
      logDesktopEvent({ component, level: "debug", message, details }),
    info: (message: string, details?: unknown) =>
      logDesktopEvent({ component, level: "info", message, details }),
    warn: (message: string, details?: unknown) =>
      logDesktopEvent({ component, level: "warn", message, details }),
    error: (message: string, details?: unknown) =>
      logDesktopEvent({ component, level: "error", message, details }),
  };
}

async function rotateLogIfNeeded(incomingBytes: number) {
  const filePath = getMainLogPath();
  const size = await stat(filePath).then((stats) => stats.size, () => 0);
  if (size > 0 && size + incomingBytes <= MAX_LOG_BYTES) return;

  await renameIfExists(`${filePath}.${MAX_LOG_FILES - 1}`, `${filePath}.${MAX_LOG_FILES}`);
  for (let index = MAX_LOG_FILES - 2; index >= 1; index -= 1) {
    await renameIfExists(`${filePath}.${index}`, `${filePath}.${index + 1}`);
  }
  await renameIfExists(filePath, `${filePath}.1`);
}

async function renameIfExists(source: string, target: string) {
  try {
    await rename(source, target);
  } catch {
    // Missing rotated files are expected.
  }
}

function serializeDetails(details: unknown) {
  if (!details) return undefined;
  if (details instanceof Error) {
    return {
      name: details.name,
      message: details.message,
      stack: details.stack,
    };
  }
  return details;
}
