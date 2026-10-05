import { z } from "zod";
import { getDesktopModeState, openHostedMode, returnToLocalMode } from "../desktopMode.js";
import * as IpcChannels from "../ipcChannels.js";
import { handleValidatedIpc } from "../ipcValidation.js";

export function registerModeHandlers() {
  const configuration = z.object({ origin: z.string().min(1).max(2048), authenticationOrigins: z.array(z.string().max(2048)).max(5) }).strict();
  const state = z.object({
    mode: z.enum(["local", "online"]), startupMode: z.enum(["local", "online"]),
    hostedApplication: configuration.nullable(), lastError: z.string().optional(),
  });
  handleValidatedIpc({ channel: IpcChannels.GET_DESKTOP_MODE_CHANNEL, result: state, handler: () => getDesktopModeState() });
  handleValidatedIpc({ channel: IpcChannels.OPEN_HOSTED_MODE_CHANNEL, payload: configuration.optional(), result: state,
    handler: (_event, input) => openHostedMode(input) });
  handleValidatedIpc({ channel: IpcChannels.RETURN_TO_LOCAL_MODE_CHANNEL, result: state, handler: () => returnToLocalMode() });
}
