import { z } from "zod";

import { getAppInfo } from "../appInfo.js";
import type { DesktopEnvironment } from "../environment.js";
import * as IpcChannels from "../ipcChannels.js";
import { DesktopSchemas, handleValidatedIpc, VoidPayloadSchema } from "../ipcValidation.js";
import { makeDesktopLogger, readMainLogTail } from "../observability.js";
import { openExternal } from "../shell.js";

const rendererLogger = makeDesktopLogger("renderer");

export function registerAppHandlers(environment: DesktopEnvironment) {
  handleValidatedIpc({
    channel: IpcChannels.GET_APP_INFO_CHANNEL,
    payload: VoidPayloadSchema,
    result: DesktopSchemas.appInfo,
    handler: () => getAppInfo(environment),
  });

  handleValidatedIpc({
    channel: IpcChannels.OPEN_EXTERNAL_CHANNEL,
    payload: z.string(),
    result: z.boolean(),
    handler: (_event, url) => openExternal(url),
  });

  handleValidatedIpc({
    channel: IpcChannels.READ_MAIN_LOG_CHANNEL,
    payload: z.number().int().min(1).max(1_000_000).optional(),
    result: z.string(),
    handler: (_event, maxBytes) => readMainLogTail(maxBytes),
  });

  handleValidatedIpc({
    channel: IpcChannels.LOG_RENDERER_EVENT_CHANNEL,
    payload: z.object({
      level: z.union([z.literal("info"), z.literal("warn"), z.literal("error")]),
      message: z.string().min(1).max(500),
      details: z.record(z.string(), z.unknown()).optional(),
    }),
    handler: (_event, input) => rendererLogger[input.level](input.message, input.details ?? {}),
  });
}
