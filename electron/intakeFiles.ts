/** Filesystem side of desktop AI intake (no Electron APIs, so it is testable in Node):
 * bounded folder listing, path containment and LibreOffice conversion. */
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
export const MAX_INTAKE_FILES = 20_000;
export const MAX_INTAKE_FILE_BYTES = 200 * 1024 * 1024;

export type IntakeFolderEntry = { relativePath: string; size: number; modifiedTime?: string };

/** Lists regular files under a folder (no symlinks), relative paths with forward slashes. */
export async function listIntakeFolder(root: string, limit = MAX_INTAKE_FILES): Promise<IntakeFolderEntry[]> {
  const out: IntakeFolderEntry[] = [];
  const walk = async (dir: string) => {
    const entries = await fs.promises.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (out.length >= limit) return;
      const full = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile()) {
        const stat = await fs.promises.stat(full);
        out.push({ relativePath: path.relative(root, full).split(path.sep).join("/"), size: stat.size, modifiedTime: stat.mtime.toISOString() });
      }
    }
  };
  await walk(root);
  return out;
}

/** Resolves a relative path strictly inside the chosen folder. */
export function resolveIntakePath(root: string, relativePath: string): string {
  const resolved = path.resolve(root, relativePath);
  const inside = path.relative(root, resolved);
  if (!inside || inside.startsWith("..") || path.isAbsolute(inside)) throw new Error("That file is outside the chosen intake folder.");
  return resolved;
}

export async function readFileInFolder(root: string, relativePath: string): Promise<ArrayBuffer> {
  const lexical = resolveIntakePath(root, relativePath);
  // A symlinked directory inside the folder must not lead outside it: compare real paths.
  const [file, realRoot] = await Promise.all([fs.promises.realpath(lexical), fs.promises.realpath(root)]);
  const inside = path.relative(realRoot, file);
  if (!inside || inside.startsWith("..") || path.isAbsolute(inside)) throw new Error("That file is outside the chosen intake folder.");
  const stat = await fs.promises.lstat(file);
  if (!stat.isFile()) throw new Error("Not a regular file.");
  if (stat.size > MAX_INTAKE_FILE_BYTES) throw new Error("File is too large for intake (over 200 MB).");
  const bytes = await fs.promises.readFile(file);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

let sofficePath: string | null | undefined;
async function findLibreOffice(): Promise<string | null> {
  if (sofficePath !== undefined) return sofficePath;
  const candidates = [process.env.SOFFICE_PATH, "soffice", "libreoffice", "/Applications/LibreOffice.app/Contents/MacOS/soffice", "C:\\Program Files\\LibreOffice\\program\\soffice.exe"].filter(Boolean) as string[];
  for (const candidate of candidates) {
    try {
      await run(candidate, ["--version"], { timeout: 20_000 });
      sofficePath = candidate;
      return candidate;
    } catch {
      // try the next candidate
    }
  }
  sofficePath = null;
  return null;
}

/** Converts a legacy document with a private LibreOffice profile; null when LibreOffice is unavailable. */
export async function convertLegacyDocument(fileName: string, bytes: ArrayBuffer, target: "docx" | "xlsx"): Promise<ArrayBuffer | null> {
  const soffice = await findLibreOffice();
  if (!soffice) return null;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "societyer-intake-"));
  try {
    const ext = path.extname(fileName).slice(1).toLowerCase().replace(/[^a-z0-9]/g, "") || "bin";
    const input = path.join(dir, `source.${ext}`);
    fs.writeFileSync(input, Buffer.from(bytes));
    const profile = `file://${path.join(dir, "profile").replace(/\\/g, "/")}`;
    await run(soffice, [`-env:UserInstallation=${profile}`, "--headless", "--norestore", "--convert-to", target, "--outdir", dir, input], { timeout: 120_000 });
    const output = path.join(dir, `source.${target}`);
    if (!fs.existsSync(output)) return null;
    const converted = fs.readFileSync(output);
    return converted.buffer.slice(converted.byteOffset, converted.byteOffset + converted.byteLength) as ArrayBuffer;
  } catch {
    return null;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
