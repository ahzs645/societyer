import { z } from "zod";

import * as IpcChannels from "../ipcChannels.js";
import { handleValidatedIpc } from "../ipcValidation.js";
import { getDesktopSecret, removeDesktopSecret, setDesktopSecret } from "../safeStorage.js";

export function registerSecretHandlers() {
  handleValidatedIpc({
    channel: IpcChannels.GET_SECRET_CHANNEL,
    payload: z.string(),
    result: z.string().nullable(),
    handler: (_event, key) => getDesktopSecret(key),
  });

  handleValidatedIpc({
    channel: IpcChannels.SET_SECRET_CHANNEL,
    payload: z.object({ key: z.string(), value: z.string() }),
    result: z.object({ stored: z.boolean() }),
    handler: (_event, input) => setDesktopSecret(input.key, input.value),
  });

  handleValidatedIpc({
    channel: IpcChannels.REMOVE_SECRET_CHANNEL,
    payload: z.string(),
    result: z.object({ stored: z.boolean() }),
    handler: (_event, key) => removeDesktopSecret(key),
  });
}
