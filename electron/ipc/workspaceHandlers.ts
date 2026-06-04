import { dialog } from "electron";
import { z } from "zod";

import { readDesktopConfig, updateDesktopConfig } from "../config.js";
import { getLogDirectory } from "../observability.js";
import * as IpcChannels from "../ipcChannels.js";
import { DesktopSchemas, handleValidatedIpc, VoidPayloadSchema } from "../ipcValidation.js";
import { openPath } from "../shell.js";
import {
  createBackup,
  ensureWorkspace,
  openBackupFolder,
  openWorkspaceFolder,
  selectWorkspace,
} from "../workspace.js";

export function registerWorkspaceHandlers() {
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
    payload: z.boolean(),
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
    payload: z.string().optional(),
    handler: (_event, backupPath) => openBackupFolder(backupPath),
  });

  handleValidatedIpc({
    channel: IpcChannels.OPEN_LOG_FOLDER_CHANNEL,
    payload: VoidPayloadSchema,
    handler: () => openPath(getLogDirectory()),
  });
}
