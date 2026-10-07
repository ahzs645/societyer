/** AI intake on the desktop: a native folder pick and scoped reads of the files in
 * that folder (plus LibreOffice conversion, intakeFiles.ts) so the renderer's
 * extraction worker can read them. The renderer only ever names a relative path
 * inside a folder the person chose in this session. */
import path from "node:path";
import { randomUUID } from "node:crypto";
import { dialog } from "electron";
import { listIntakeFolder, readFileInFolder, type IntakeFolderEntry } from "./intakeFiles.js";

export { convertLegacyDocument } from "./intakeFiles.js";

const roots = new Map<string, string>();

export type IntakeFolderPick = { token: string; root: string; files: IntakeFolderEntry[] };

export async function pickIntakeFolder(): Promise<IntakeFolderPick | null> {
  const result = await dialog.showOpenDialog({ title: "Choose a folder for AI intake", properties: ["openDirectory"] });
  if (result.canceled || !result.filePaths[0]) return null;
  const root = result.filePaths[0];
  const token = randomUUID();
  roots.set(token, root);
  return { token, root: path.basename(root), files: await listIntakeFolder(root) };
}

export async function readIntakeFile(token: string, relativePath: string): Promise<ArrayBuffer> {
  const root = roots.get(token);
  if (!root) throw new Error("Choose the intake folder again.");
  return readFileInFolder(root, relativePath);
}
