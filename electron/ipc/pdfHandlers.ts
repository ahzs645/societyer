import * as IpcChannels from "../ipcChannels.js";
import { DesktopSchemas, handleValidatedIpc } from "../ipcValidation.js";
import { printHtmlToPdf } from "../printPdf.js";

export function registerPdfHandlers() {
  handleValidatedIpc({
    channel: IpcChannels.PRINT_TO_PDF_CHANNEL,
    payload: DesktopSchemas.printToPdfInput,
    result: DesktopSchemas.printToPdfResult,
    handler: (_event, input) => printHtmlToPdf(input),
  });
}
