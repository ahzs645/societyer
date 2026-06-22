import { ipcMain, type IpcMainInvokeEvent } from "electron";
import { z } from "zod";
import { isManagedServiceId, type ManagedServiceId } from "./processManager.js";
import { isDesktopServiceId, type DesktopServiceId } from "./services.js";

const VoidPayload = z.undefined().optional();
const VoidResult = z.void();
export const VoidPayloadSchema = VoidPayload;
export const VoidResultSchema = VoidResult;

type Handler<Payload, Result> = (
  event: IpcMainInvokeEvent,
  payload: Payload,
) => Result | Promise<Result>;

export function handleValidatedIpc<Payload, Result>(input: {
  channel: string;
  payload?: z.ZodType<Payload>;
  result?: z.ZodType<Result>;
  handler: Handler<Payload, Result>;
}) {
  ipcMain.removeHandler(input.channel);
  ipcMain.handle(input.channel, async (event, rawPayload) => {
    const payload = (input.payload ?? VoidPayload).parse(rawPayload) as Payload;
    const result = await input.handler(event, payload);
    return (input.result ?? VoidResult).parse(result);
  });
}

export const DesktopSchemas = {
  setupState: z.object({ complete: z.boolean() }),
  workspaceInfo: z.object({
    id: z.string(),
    name: z.string(),
    rootPath: z.string(),
    schemaVersion: z.number(),
    createdAtISO: z.string(),
    updatedAtISO: z.string(),
  }),
  backupResult: z.object({
    path: z.string(),
    bytes: z.number().optional(),
  }),
  connectorHealth: z.object({
    ok: z.boolean(),
    provider: z.string().optional(),
    message: z.string().optional(),
  }),
  documentVersionRef: z.object({
    provider: z.literal("local-filesystem"),
    key: z.string(),
    fileName: z.string().optional(),
    mimeType: z.string().optional(),
    byteLength: z.number().optional(),
    sha256: z.string().optional(),
  }).passthrough(),
  writeDocumentVersionInput: z.object({
    societyId: z.string(),
    documentId: z.string(),
    version: z.number(),
    fileName: z.string(),
    mimeType: z.string().optional(),
    bytes: z.any().refine(
      (value) =>
        value instanceof ArrayBuffer ||
        value instanceof Uint8Array ||
        Array.isArray(value),
      "Expected document bytes.",
    ),
  }),
  readDocumentVersionInput: z.object({
    key: z.string(),
  }),
  printToPdfInput: z.object({
    html: z.string(),
    fileName: z.string(),
  }),
  printToPdfResult: z.object({
    path: z.string(),
  }),
  serviceConfig: z.object({
    serviceId: z.custom<DesktopServiceId>(
      (value) => typeof value === "string" && isDesktopServiceId(value),
      "Unknown desktop service.",
    ),
    endpoint: z.string().optional(),
    enabled: z.boolean().optional(),
  }),
  serviceStatus: z.object({
    id: z.string(),
    label: z.string(),
    configured: z.boolean(),
    ok: z.boolean(),
    endpoint: z.string().optional(),
    message: z.string().optional(),
  }),
  managedServiceId: z.custom<ManagedServiceId>(
    (value) => typeof value === "string" && isManagedServiceId(value),
    "Unknown managed service.",
  ),
  managedServiceStatus: z.object({
    id: z.custom<ManagedServiceId>(
      (value) => typeof value === "string" && isManagedServiceId(value),
      "Unknown managed service.",
    ),
    label: z.string(),
    state: z.union([
      z.literal("disabled"),
      z.literal("not-installed"),
      z.literal("stopped"),
      z.literal("starting"),
      z.literal("running"),
      z.literal("unhealthy"),
      z.literal("stopping"),
      z.literal("error"),
    ]),
    manageable: z.boolean(),
    message: z.string().optional(),
    composeFile: z.string().optional(),
  }),
  serviceProfile: z.object({
    id: z.string(),
    name: z.string(),
    kind: z.union([
      z.literal("local-only"),
      z.literal("browser-imports"),
      z.literal("rustfs-replication"),
      z.literal("paperless"),
      z.literal("full-assisted"),
    ]),
    services: z.record(z.string(), z.object({
      endpoint: z.string().optional(),
      enabled: z.boolean().optional(),
    })),
    updatedAtISO: z.string(),
    active: z.boolean(),
  }),
  saveServiceProfileInput: z.object({
    id: z.string(),
    name: z.string(),
    kind: z.union([
      z.literal("local-only"),
      z.literal("browser-imports"),
      z.literal("rustfs-replication"),
      z.literal("paperless"),
      z.literal("full-assisted"),
    ]).optional(),
  }),
  appInfo: z.object({
    name: z.string(),
    version: z.string(),
    isPackaged: z.boolean(),
    platform: z.string(),
    arch: z.string(),
    electronVersion: z.string(),
    chromeVersion: z.string(),
    nodeVersion: z.string(),
    userDataPath: z.string(),
    homePath: z.string(),
    resourcePath: z.string(),
    logDirectory: z.string(),
    runId: z.string(),
    buildCommit: z.string().nullable(),
    runtimeMode: z.string(),
    documentStorageProvider: z.string(),
    iconPaths: z.object({
      png: z.string().nullable(),
      icns: z.string().nullable(),
      ico: z.string().nullable(),
    }),
  }),
  updateChannel: z.union([z.literal("stable"), z.literal("beta"), z.literal("nightly")]),
  updateState: z.object({
    status: z.union([
      z.literal("disabled"),
      z.literal("idle"),
      z.literal("checking"),
      z.literal("available"),
      z.literal("downloading"),
      z.literal("downloaded"),
      z.literal("error"),
    ]),
    enabled: z.boolean(),
    channel: z.union([z.literal("stable"), z.literal("beta"), z.literal("nightly")]),
    currentVersion: z.string(),
    availableVersion: z.string().optional(),
    downloadedVersion: z.string().optional(),
    downloadPercent: z.number().optional(),
    reason: z.string().optional(),
    error: z.string().optional(),
    feedPath: z.string(),
  }),
};
