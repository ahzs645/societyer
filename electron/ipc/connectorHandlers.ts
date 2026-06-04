import { z } from "zod";

import { checkConnector } from "../connectors.js";
import * as IpcChannels from "../ipcChannels.js";
import { DesktopSchemas, handleValidatedIpc } from "../ipcValidation.js";

export function registerConnectorHandlers() {
  handleValidatedIpc({
    channel: IpcChannels.CHECK_CONNECTOR_CHANNEL,
    payload: z.string(),
    result: DesktopSchemas.connectorHealth,
    handler: (_event, endpoint) => checkConnector(endpoint),
  });
}
