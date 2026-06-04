import { dialog, ipcMain } from "electron";

import { getAppInfo } from "./appInfo.js";
import { checkConnector } from "./connectors.js";
import { readDesktopConfig, updateDesktopConfig } from "./config.js";
import {
  openDocumentVersion,
  readDocumentVersion,
  type ReadDocumentVersionInput,
  writeDocumentVersion,
  type WriteDocumentVersionInput,
} from "./documents.js";
import * as IpcChannels from "./ipcChannels.js";
import { openExternal } from "./shell.js";
import { createBackup, ensureWorkspace, selectWorkspace } from "./workspace.js";

export function registerIpc() {
  ipcMain.handle(IpcChannels.CHOOSE_WORKSPACE_DIRECTORY_CHANNEL, async () => {
    const result = await dialog.showOpenDialog({
      properties: ["openDirectory", "createDirectory"],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    await selectWorkspace(result.filePaths[0]);
    return result.filePaths[0];
  });

  ipcMain.handle(IpcChannels.GET_WORKSPACE_INFO_CHANNEL, async () => (await ensureWorkspace()).info);

  ipcMain.handle(IpcChannels.GET_SETUP_STATE_CHANNEL, async () => {
    const config = await readDesktopConfig();
    return { complete: config.setupComplete === true };
  });

  ipcMain.handle(IpcChannels.SET_SETUP_COMPLETE_CHANNEL, async (_event, complete: boolean) => {
    const config = await updateDesktopConfig({ setupComplete: complete === true });
    return { complete: config.setupComplete === true };
  });

  ipcMain.handle(IpcChannels.WRITE_DOCUMENT_VERSION_CHANNEL, (_event, input: WriteDocumentVersionInput) =>
    writeDocumentVersion(input),
  );

  ipcMain.handle(IpcChannels.READ_DOCUMENT_VERSION_CHANNEL, (_event, input: ReadDocumentVersionInput) =>
    readDocumentVersion(input),
  );

  ipcMain.handle(IpcChannels.OPEN_DOCUMENT_VERSION_CHANNEL, (_event, input: ReadDocumentVersionInput) =>
    openDocumentVersion(input),
  );

  ipcMain.handle(IpcChannels.CREATE_BACKUP_CHANNEL, () => createBackup());
  ipcMain.handle(IpcChannels.CHECK_CONNECTOR_CHANNEL, (_event, endpoint: string) =>
    checkConnector(endpoint),
  );
  ipcMain.handle(IpcChannels.OPEN_EXTERNAL_CHANNEL, (_event, url: string) => openExternal(url));
  ipcMain.handle(IpcChannels.GET_APP_INFO_CHANNEL, () => getAppInfo());
}
