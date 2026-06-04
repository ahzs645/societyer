import type { DesktopEnvironment } from "../environment.js";
import * as IpcChannels from "../ipcChannels.js";
import { DesktopSchemas, handleValidatedIpc, VoidPayloadSchema } from "../ipcValidation.js";
import {
  checkForUpdate,
  downloadUpdate,
  getUpdateState,
  installUpdate,
  setUpdateChannel,
} from "../updates.js";

export function registerUpdateHandlers(environment: DesktopEnvironment) {
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
