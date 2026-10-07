/** Node / Electron-main host for stage 2: file IO, hashing and LibreOffice
 * conversion of legacy formats. Not imported by browser code. */
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { IntakeExtract } from "../blocks";
import { extractBytes, type ExtractOptions, type LegacyConverter } from "../extract";

const run = promisify(execFile);
let sofficePath: string | null | undefined;

export async function findLibreOffice(): Promise<string | null> {
  if (sofficePath !== undefined) return sofficePath;
  const candidates = [process.env.SOFFICE_PATH, "soffice", "libreoffice", "/Applications/LibreOffice.app/Contents/MacOS/soffice", "C:\\Program Files\\LibreOffice\\program\\soffice.exe"].filter(Boolean) as string[];
  for (const candidate of candidates) {
    try {
      await run(candidate, ["--version"], { timeout: 20000 });
      sofficePath = candidate;
      return candidate;
    } catch {
      // try the next candidate
    }
  }
  sofficePath = null;
  return null;
}

/** Converts with a private LibreOffice profile so concurrent runs never share state. */
export const libreOfficeConverter: LegacyConverter = async (bytes, fileName, target) => {
  const soffice = await findLibreOffice();
  if (!soffice) return null;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "societyer-intake-"));
  try {
    const safeName = `source.${path.extname(fileName).slice(1).toLowerCase() || "bin"}`;
    const input = path.join(dir, safeName);
    fs.writeFileSync(input, bytes);
    const profile = `file://${path.join(dir, "profile").replace(/\\/g, "/")}`;
    await run(soffice, [`-env:UserInstallation=${profile}`, "--headless", "--norestore", "--convert-to", target, "--outdir", dir, input], { timeout: 120000 });
    const output = path.join(dir, `source.${target}`);
    return fs.existsSync(output) ? new Uint8Array(fs.readFileSync(output)) : null;
  } catch {
    return null;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
};

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
export function md5Hex(bytes: Uint8Array): string {
  return createHash("md5").update(bytes).digest("hex");
}

export async function extractFile(filePath: string, options: ExtractOptions = {}): Promise<IntakeExtract> {
  const bytes = new Uint8Array(fs.readFileSync(filePath));
  return extractBytes(path.basename(filePath), bytes, { convertLegacy: libreOfficeConverter, ...options });
}
