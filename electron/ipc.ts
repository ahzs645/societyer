import type { DesktopEnvironment } from "./environment.js";
import { registerAppHandlers } from "./ipc/appHandlers.js";
import { registerConnectorHandlers } from "./ipc/connectorHandlers.js";
import { registerDocumentHandlers } from "./ipc/documentHandlers.js";
import { registerSecretHandlers } from "./ipc/secretHandlers.js";
import { registerServiceHandlers } from "./ipc/serviceHandlers.js";
import { registerUpdateHandlers } from "./ipc/updateHandlers.js";
import { registerWorkspaceHandlers } from "./ipc/workspaceHandlers.js";

export function registerIpc(environment: DesktopEnvironment) {
  registerAppHandlers(environment);
  registerWorkspaceHandlers();
  registerDocumentHandlers();
  registerConnectorHandlers();
  registerUpdateHandlers(environment);
  registerServiceHandlers(environment);
  registerSecretHandlers();
}
