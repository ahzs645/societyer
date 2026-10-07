import { z } from "zod";

import * as IpcChannels from "../ipcChannels.js";
import { handleValidatedIpc, VoidPayloadSchema } from "../ipcValidation.js";
import { convertLegacyDocument, pickIntakeFolder, readIntakeFile } from "../intake.js";

const folderPick = z.object({
  token: z.string(),
  root: z.string(),
  files: z.array(z.object({ relativePath: z.string(), size: z.number(), modifiedTime: z.string().optional() })),
}).nullable();
const bytes = z.custom<ArrayBuffer>((value) => value instanceof ArrayBuffer, "Expected file bytes.");

export function registerIntakeHandlers() {
  handleValidatedIpc({
    channel: IpcChannels.PICK_INTAKE_FOLDER_CHANNEL,
    payload: VoidPayloadSchema,
    result: folderPick,
    handler: () => pickIntakeFolder(),
  });

  handleValidatedIpc({
    channel: IpcChannels.READ_INTAKE_FILE_CHANNEL,
    payload: z.object({ token: z.string().uuid(), relativePath: z.string().min(1).max(4000) }),
    result: bytes,
    handler: (_event, input) => readIntakeFile(input.token, input.relativePath),
  });

  handleValidatedIpc({
    channel: IpcChannels.CONVERT_LEGACY_DOCUMENT_CHANNEL,
    payload: z.object({ fileName: z.string().min(1).max(500), bytes, target: z.enum(["docx", "xlsx"]) }),
    result: bytes.nullable(),
    handler: (_event, input) => convertLegacyDocument(input.fileName, input.bytes, input.target),
  });
}
