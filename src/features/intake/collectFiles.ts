/** Choosing intake sources in the browser: individual files, a folder through
 * the File System Access API (showDirectoryPicker) or a webkitdirectory input,
 * and — on the desktop app — a native folder pick through the Electron bridge. */
import { junkVerdict } from "../../../shared/intake/junk";
import { EXTRACTABLE_EXTENSIONS, extensionOf, OCR_IMAGE_EXTENSIONS } from "../../../shared/intake/extract/extensions";
import { isDocumentImage } from "../../../shared/intake/extract/ocr";
import { getDesktopBridge } from "../../lib/desktopBridge";

export type IntakeInputFile = { file: Blob; name: string; relativePath: string; size: number; lastModified?: number; type?: string };
export type IntakeSelection = { sourceKind: "upload" | "local_folder"; root: string; files: IntakeInputFile[] };

export function selectionFromFileList(list: FileList | File[] | null, sourceKind: IntakeSelection["sourceKind"]): IntakeSelection {
  const files = Array.from(list ?? []).map((file) => ({ file, name: file.name, relativePath: (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name, size: file.size, lastModified: file.lastModified, type: file.type }));
  const root = sourceKind === "local_folder" ? (files[0]?.relativePath.split("/")[0] ?? "Folder") : files.length === 1 ? files[0].name : `${files.length} files`;
  return { sourceKind, root, files };
}

type DirectoryHandle = { name: string; kind: "directory"; values(): AsyncIterable<DirectoryHandle | FileHandle> };
type FileHandle = { name: string; kind: "file"; getFile(): Promise<File> };

export function supportsDirectoryPicker(): boolean {
  return typeof window !== "undefined" && typeof (window as any).showDirectoryPicker === "function";
}

/** Recursively lists a folder chosen with the File System Access API (bytes are read lazily by the worker). */
export async function pickDirectory(): Promise<IntakeSelection | null> {
  const picker = (window as any).showDirectoryPicker as (options?: unknown) => Promise<DirectoryHandle>;
  let root: DirectoryHandle;
  try {
    root = await picker({ mode: "read" });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") return null;
    throw error;
  }
  const files: IntakeInputFile[] = [];
  const walk = async (dir: DirectoryHandle, prefix: string) => {
    for await (const entry of dir.values()) {
      const path = `${prefix}${entry.name}`;
      if (entry.kind === "directory") await walk(entry, `${path}/`);
      else {
        const file = await entry.getFile();
        files.push({ file, name: file.name, relativePath: `${root.name}/${path}`, size: file.size, lastModified: file.lastModified, type: file.type });
      }
    }
  };
  await walk(root, "");
  return { sourceKind: "local_folder", root: root.name, files };
}

/** Optional desktop bridge methods (added by the desktop host when it supports intake folders). */
type IntakeDesktopBridge = {
  pickIntakeFolder?: () => Promise<{ token: string; root: string; files: Array<{ relativePath: string; size: number; modifiedTime?: string }> } | null>;
  readIntakeFile?: (input: { token: string; relativePath: string }) => Promise<ArrayBuffer>;
  convertLegacyDocument?: (input: { fileName: string; bytes: ArrayBuffer; target: "docx" | "xlsx" }) => Promise<ArrayBuffer | null>;
};

export function desktopIntakeBridge(): IntakeDesktopBridge | null {
  const bridge = getDesktopBridge() as unknown as IntakeDesktopBridge | null;
  return bridge?.pickIntakeFolder && bridge.readIntakeFile ? bridge : null;
}

export function desktopLegacyConverter(): IntakeDesktopBridge["convertLegacyDocument"] | undefined {
  const bridge = getDesktopBridge() as unknown as IntakeDesktopBridge | null;
  return bridge?.convertLegacyDocument?.bind(bridge);
}

/** Native folder pick on the desktop app; files are read on demand through the bridge. */
export async function pickDesktopFolder(): Promise<IntakeSelection | null> {
  const bridge = desktopIntakeBridge();
  if (!bridge) return null;
  const picked = await bridge.pickIntakeFolder!();
  if (!picked) return null;
  const files: IntakeInputFile[] = [];
  for (const entry of picked.files) {
    const name = entry.relativePath.split("/").pop() ?? entry.relativePath;
    // Bytes are fetched lazily: the Blob is materialised only for files the pipeline extracts.
    const blob = new LazyDesktopBlob(() => bridge.readIntakeFile!({ token: picked.token, relativePath: entry.relativePath }), entry.size);
    files.push({ file: blob as unknown as Blob, name, relativePath: `${picked.root}/${entry.relativePath}`, size: entry.size, lastModified: entry.modifiedTime ? Date.parse(entry.modifiedTime) : undefined });
  }
  return { sourceKind: "local_folder", root: picked.root, files };
}

/** Desktop files cannot be cloned to the worker lazily, so they are read before the run starts. */
class LazyDesktopBlob {
  constructor(private readonly load: () => Promise<ArrayBuffer>, readonly size: number) {}
  async materialize(): Promise<Blob> {
    return new Blob([await this.load()]);
  }
}

export async function materializeSelection(selection: IntakeSelection, include: (file: IntakeInputFile) => boolean): Promise<IntakeSelection> {
  const files: IntakeInputFile[] = [];
  for (const file of selection.files) {
    if (file.file instanceof LazyDesktopBlob) files.push(include(file) ? { ...file, file: await (file.file as LazyDesktopBlob).materialize() } : { ...file, file: new Blob([]) });
    else files.push(file);
  }
  return { ...selection, files };
}

export type SelectionSummary = { files: number; bytes: number; junk: number; excluded: number; catalogue: number; extract: number; ocrImages: number; byExtension: Array<[string, number]> };

/** A document-like image (scan, signed form, certificate) read by OCR when OCR is on. */
function ocrImage(file: IntakeInputFile, ocr: boolean): boolean {
  return ocr && OCR_IMAGE_EXTENSIONS.has(extensionOf(file.name)) && isDocumentImage(file.name, file.relativePath) && junkVerdict({ name: file.name, path: file.relativePath, sizeBytes: file.size }).disposition === "catalogue";
}

/** What the junk filter will do with the selection (shown before a run starts). */
export function summarizeSelection(selection: IntakeSelection | null, options: { ocr?: boolean } = {}): SelectionSummary {
  const summary: SelectionSummary = { files: 0, bytes: 0, junk: 0, excluded: 0, catalogue: 0, extract: 0, ocrImages: 0, byExtension: [] };
  const extensions = new Map<string, number>();
  for (const file of selection?.files ?? []) {
    summary.files++;
    summary.bytes += file.size;
    const verdict = junkVerdict({ name: file.name, path: file.relativePath, sizeBytes: file.size });
    if (verdict.disposition === "junk") summary.junk++;
    else if (verdict.disposition === "excluded") summary.excluded++;
    else if (ocrImage(file, Boolean(options.ocr))) {
      summary.extract++;
      summary.ocrImages++;
    } else if (verdict.disposition === "catalogue" || (!EXTRACTABLE_EXTENSIONS.has(extensionOf(file.name)) && extensionOf(file.name))) summary.catalogue++;
    else summary.extract++;
    const ext = extensionOf(file.name) || "(none)";
    extensions.set(ext, (extensions.get(ext) ?? 0) + 1);
  }
  summary.byExtension = [...extensions.entries()].sort((a, b) => b[1] - a[1]);
  return summary;
}

/** Whether the junk filter keeps a file (only kept files are read into memory for desktop picks).
 * With OCR on, document-like images are kept too; files without an extension are kept so their
 * format can be read from their bytes. */
export function keptByJunkFilter(file: IntakeInputFile, options: { ocr?: boolean } = {}): boolean {
  const verdict = junkVerdict({ name: file.name, path: file.relativePath, sizeBytes: file.size });
  if (ocrImage(file, Boolean(options.ocr))) return true;
  const ext = extensionOf(file.name);
  return verdict.disposition === "keep" && (EXTRACTABLE_EXTENSIONS.has(ext) || !ext);
}
