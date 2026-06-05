import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { openPath } from "./shell.js";
import { ensureWorkspace, resolveWorkspaceKey } from "./workspace.js";

export type DocumentVersionRef = {
  provider: "local-filesystem";
  key: string;
  fileName: string;
  mimeType?: string;
  byteLength?: number;
  sha256?: string;
};

export type WriteDocumentVersionInput = {
  societyId: string;
  documentId: string;
  version: number;
  fileName: string;
  mimeType?: string;
  bytes: ArrayBuffer | Uint8Array | number[];
};

export type ReadDocumentVersionInput = {
  key: string;
};

function sanitizeSegment(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 160) || "item";
}

function bufferFromBytes(value: WriteDocumentVersionInput["bytes"]) {
  if (value instanceof Uint8Array) return Buffer.from(value);
  if (Array.isArray(value)) return Buffer.from(value);
  return Buffer.from(new Uint8Array(value));
}

function documentRelativePath(input: Omit<WriteDocumentVersionInput, "bytes">) {
  const societyId = sanitizeSegment(input.societyId);
  const documentId = sanitizeSegment(input.documentId);
  const version = sanitizeSegment(`v${input.version}`);
  const fileName = sanitizeSegment(input.fileName);
  return path.join(
    "documents",
    "societies",
    societyId,
    "documents",
    documentId,
    `${version}-${fileName}`,
  );
}

export async function writeDocumentVersion(
  input: WriteDocumentVersionInput,
): Promise<DocumentVersionRef> {
  const { root } = await ensureWorkspace();
  const key = documentRelativePath(input);
  const absolutePath = resolveWorkspaceKey(root, key);
  const bytes = bufferFromBytes(input.bytes);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, bytes);
  return {
    provider: "local-filesystem",
    key,
    fileName: input.fileName,
    mimeType: input.mimeType,
    byteLength: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

export async function readDocumentVersion(input: ReadDocumentVersionInput) {
  const { root } = await ensureWorkspace();
  const filePath = resolveWorkspaceKey(root, input.key);
  const bytes = await readFile(filePath);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

export async function openDocumentVersion(input: ReadDocumentVersionInput) {
  const { root } = await ensureWorkspace();
  await openPath(resolveWorkspaceKey(root, input.key));
}
