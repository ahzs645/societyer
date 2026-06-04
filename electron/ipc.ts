import { dialog } from "electron";
import { z } from "zod";

import { getAppInfo } from "./appInfo.js";
import { checkConnector } from "./connectors.js";
import { readDesktopConfig, updateDesktopConfig } from "./config.js";
import {
  openDocumentVersion,
  readDocumentVersion,
  writeDocumentVersion,
} from "./documents.js";
import type { DesktopEnvironment } from "./environment.js";
import * as IpcChannels from "./ipcChannels.js";
import { DesktopSchemas, handleValidatedIpc, VoidPayloadSchema } from "./ipcValidation.js";
import { getLogDirectory } from "./observability.js";
import { getDesktopSecret, removeDesktopSecret, setDesktopSecret } from "./safeStorage.js";
import {
  checkService,
  activateServiceProfile,
  getServiceConfig,
  isDesktopServiceId,
  listServiceProfiles,
  listServiceStatuses,
  saveCurrentServiceProfile,
  saveServiceConfig,
  type DesktopServiceId,
} from "./services.js";
import { openExternal, openPath } from "./shell.js";
import {
  checkForUpdate,
  downloadUpdate,
  getUpdateState,
  installUpdate,
  setUpdateChannel,
} from "./updates.js";
import {
  createBackup,
  ensureWorkspace,
  openBackupFolder,
  openWorkspaceFolder,
  selectWorkspace,
} from "./workspace.js";

const optionalString = z.string().optional();
const booleanPayload = z.boolean();
const externalUrlPayload = z.string();
const secretKeyPayload = z.string();
const setSecretPayload = z.object({ key: z.string(), value: z.string() });
const serviceIdPayload = z.custom<DesktopServiceId>(
  (value) => typeof value === "string" && isDesktopServiceId(value),
  "Unknown desktop service.",
);

export function registerIpc(environment: DesktopEnvironment) {
  registerAppHandlers(environment);
  registerWorkspaceHandlers();
  registerDocumentHandlers();
  registerConnectorHandlers();
  registerUpdateHandlers(environment);
  registerServiceHandlers();
  registerSecretHandlers();
}

function registerAppHandlers(environment: DesktopEnvironment) {
  handleValidatedIpc({
    channel: IpcChannels.GET_APP_INFO_CHANNEL,
    payload: VoidPayloadSchema,
    result: DesktopSchemas.appInfo,
    handler: () => getAppInfo(environment),
  });

  handleValidatedIpc({
    channel: IpcChannels.OPEN_EXTERNAL_CHANNEL,
    payload: externalUrlPayload,
    result: z.boolean(),
    handler: (_event, url) => openExternal(url),
  });
}

function registerWorkspaceHandlers() {
  handleValidatedIpc({
    channel: IpcChannels.CHOOSE_WORKSPACE_DIRECTORY_CHANNEL,
    payload: VoidPayloadSchema,
    result: z.string().nullable(),
    handler: async () => {
      const result = await dialog.showOpenDialog({
        properties: ["openDirectory", "createDirectory"],
      });
      if (result.canceled || !result.filePaths[0]) return null;
      await selectWorkspace(result.filePaths[0]);
      return result.filePaths[0];
    },
  });

  handleValidatedIpc({
    channel: IpcChannels.GET_WORKSPACE_INFO_CHANNEL,
    payload: VoidPayloadSchema,
    result: DesktopSchemas.workspaceInfo,
    handler: async () => (await ensureWorkspace()).info,
  });

  handleValidatedIpc({
    channel: IpcChannels.GET_SETUP_STATE_CHANNEL,
    payload: VoidPayloadSchema,
    result: DesktopSchemas.setupState,
    handler: async () => {
      const config = await readDesktopConfig();
      return { complete: config.setupComplete === true };
    },
  });

  handleValidatedIpc({
    channel: IpcChannels.SET_SETUP_COMPLETE_CHANNEL,
    payload: booleanPayload,
    result: DesktopSchemas.setupState,
    handler: async (_event, complete) => {
      const config = await updateDesktopConfig({ setupComplete: complete === true });
      return { complete: config.setupComplete === true };
    },
  });

  handleValidatedIpc({
    channel: IpcChannels.CREATE_BACKUP_CHANNEL,
    payload: VoidPayloadSchema,
    result: DesktopSchemas.backupResult,
    handler: () => createBackup(),
  });

  handleValidatedIpc({
    channel: IpcChannels.OPEN_WORKSPACE_FOLDER_CHANNEL,
    payload: VoidPayloadSchema,
    handler: () => openWorkspaceFolder(),
  });

  handleValidatedIpc({
    channel: IpcChannels.OPEN_BACKUP_FOLDER_CHANNEL,
    payload: optionalString,
    handler: (_event, backupPath) => openBackupFolder(backupPath),
  });

  handleValidatedIpc({
    channel: IpcChannels.OPEN_LOG_FOLDER_CHANNEL,
    payload: VoidPayloadSchema,
    handler: () => openPath(getLogDirectory()),
  });
}

function registerDocumentHandlers() {
  handleValidatedIpc({
    channel: IpcChannels.WRITE_DOCUMENT_VERSION_CHANNEL,
    payload: DesktopSchemas.writeDocumentVersionInput,
    result: DesktopSchemas.documentVersionRef,
    handler: (_event, input) => writeDocumentVersion(input),
  });

  handleValidatedIpc({
    channel: IpcChannels.READ_DOCUMENT_VERSION_CHANNEL,
    payload: DesktopSchemas.readDocumentVersionInput,
    result: z.instanceof(ArrayBuffer),
    handler: (_event, input) => readDocumentVersion(input),
  });

  handleValidatedIpc({
    channel: IpcChannels.OPEN_DOCUMENT_VERSION_CHANNEL,
    payload: DesktopSchemas.readDocumentVersionInput,
    handler: (_event, input) => openDocumentVersion(input),
  });
}

function registerConnectorHandlers() {
  handleValidatedIpc({
    channel: IpcChannels.CHECK_CONNECTOR_CHANNEL,
    payload: z.string(),
    result: DesktopSchemas.connectorHealth,
    handler: (_event, endpoint) => checkConnector(endpoint),
  });
}

function registerUpdateHandlers(environment: DesktopEnvironment) {
  handleValidatedIpc({
    channel: IpcChannels.GET_UPDATE_STATE_CHANNEL,
    payload: VoidPayloadSchema,
    result: DesktopSchemas.updateState,
    handler: () => getUpdateState(environment),
  });

  handleValidatedIpc({
    channel: IpcChannels.SET_UPDATE_CHANNEL_CHANNEL,
    payload: DesktopSchemas.updateChannel,
    result: DesktopSchemas.updateState,
    handler: (_event, channel) => setUpdateChannel(environment, channel),
  });

  handleValidatedIpc({
    channel: IpcChannels.CHECK_FOR_UPDATE_CHANNEL,
    payload: VoidPayloadSchema,
    result: DesktopSchemas.updateState,
    handler: () => checkForUpdate(environment),
  });

  handleValidatedIpc({
    channel: IpcChannels.DOWNLOAD_UPDATE_CHANNEL,
    payload: VoidPayloadSchema,
    result: DesktopSchemas.updateState,
    handler: () => downloadUpdate(environment),
  });

  handleValidatedIpc({
    channel: IpcChannels.INSTALL_UPDATE_CHANNEL,
    payload: VoidPayloadSchema,
    result: DesktopSchemas.updateState,
    handler: () => installUpdate(environment),
  });
}

function registerServiceHandlers() {
  handleValidatedIpc({
    channel: IpcChannels.LIST_SERVICE_STATUSES_CHANNEL,
    payload: VoidPayloadSchema,
    result: z.array(DesktopSchemas.serviceStatus),
    handler: () => listServiceStatuses(),
  });

  handleValidatedIpc({
    channel: IpcChannels.CHECK_SERVICE_CHANNEL,
    payload: serviceIdPayload,
    result: DesktopSchemas.serviceStatus,
    handler: (_event, serviceId) => checkService(serviceId),
  });

  handleValidatedIpc({
    channel: IpcChannels.GET_SERVICE_CONFIG_CHANNEL,
    payload: serviceIdPayload,
    result: DesktopSchemas.serviceConfig,
    handler: (_event, serviceId) => getServiceConfig(serviceId),
  });

  handleValidatedIpc({
    channel: IpcChannels.SAVE_SERVICE_CONFIG_CHANNEL,
    payload: DesktopSchemas.serviceConfig,
    result: DesktopSchemas.serviceConfig,
    handler: (_event, input) => saveServiceConfig(input),
  });

  handleValidatedIpc({
    channel: IpcChannels.LIST_SERVICE_PROFILES_CHANNEL,
    payload: VoidPayloadSchema,
    result: z.array(DesktopSchemas.serviceProfile),
    handler: () => listServiceProfiles(),
  });

  handleValidatedIpc({
    channel: IpcChannels.SAVE_SERVICE_PROFILE_CHANNEL,
    payload: DesktopSchemas.saveServiceProfileInput,
    result: DesktopSchemas.serviceProfile,
    handler: (_event, input) => saveCurrentServiceProfile(input),
  });

  handleValidatedIpc({
    channel: IpcChannels.ACTIVATE_SERVICE_PROFILE_CHANNEL,
    payload: z.string(),
    result: DesktopSchemas.serviceProfile,
    handler: (_event, id) => activateServiceProfile(id),
  });
}

function registerSecretHandlers() {
  handleValidatedIpc({
    channel: IpcChannels.GET_SECRET_CHANNEL,
    payload: secretKeyPayload,
    result: z.string().nullable(),
    handler: (_event, key) => getDesktopSecret(key),
  });

  handleValidatedIpc({
    channel: IpcChannels.SET_SECRET_CHANNEL,
    payload: setSecretPayload,
    result: z.object({ stored: z.boolean() }),
    handler: (_event, input) => setDesktopSecret(input.key, input.value),
  });

  handleValidatedIpc({
    channel: IpcChannels.REMOVE_SECRET_CHANNEL,
    payload: secretKeyPayload,
    result: z.object({ stored: z.boolean() }),
    handler: (_event, key) => removeDesktopSecret(key),
  });
}
