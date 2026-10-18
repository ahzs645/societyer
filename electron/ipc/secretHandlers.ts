import { z } from "zod";

import * as IpcChannels from "../ipcChannels.js";
import { handleValidatedIpc } from "../ipcValidation.js";
import { getDesktopSecret, removeDesktopSecret, setDesktopSecret } from "../safeStorage.js";

export function registerSecretHandlers() {
  handleValidatedIpc({
    channel: IpcChannels.GET_SECRET_CHANNEL,
    payload: z.string(),
    result: z.string().nullable(),
    handler: (_event, key) => {
      // The AI keys are only ever read by the main-process AI proxy (aiHandlers).
      if (key === "ai-api-key") throw new Error("The AI API key is not readable from the app window.");
      if (key === "stt-api-key") throw new Error("The speech-to-text API key is not readable from the app window.");
      return getDesktopSecret(key);
    },
  });

  handleValidatedIpc({
    channel: IpcChannels.HAS_SECRET_CHANNEL,
    payload: z.string(),
    result: z.boolean(),
    handler: async (_event, key) => Boolean(await getDesktopSecret(key)),
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
