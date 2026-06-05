import { z } from "zod";

import {
  openDocumentVersion,
  readDocumentVersion,
  writeDocumentVersion,
} from "../documents.js";
import * as IpcChannels from "../ipcChannels.js";
import { DesktopSchemas, handleValidatedIpc } from "../ipcValidation.js";

export function registerDocumentHandlers() {
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
