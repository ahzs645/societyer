/** Original source bytes for intake runs, kept on this device (IndexedDB),
 * content-addressed by SHA-256. The review screen renders DOCX/PDF originals
 * from here; promotion saves them as document versions where the runtime has
 * file storage. Browsers can clear this store; the stored text extract keeps
 * every locator usable without it. */
import Dexie, { type Table } from "dexie";

export type CachedOriginal = { sha256: string; blob: Blob; name: string; mimeType?: string; size: number; cachedAtISO: string };

class OriginalsDb extends Dexie {
  originals!: Table<CachedOriginal, string>;
  constructor() {
    super("societyer-intake-originals");
    this.version(1).stores({ originals: "&sha256, cachedAtISO" });
  }
}

let db: OriginalsDb | null = null;
function open(): OriginalsDb | null {
  if (typeof indexedDB === "undefined") return null;
  db ??= new OriginalsDb();
  return db;
}

const memory = new Map<string, CachedOriginal>();

export async function putOriginal(entry: Omit<CachedOriginal, "cachedAtISO">): Promise<void> {
  const row = { ...entry, cachedAtISO: new Date().toISOString() };
  memory.set(entry.sha256, row);
  try {
    await open()?.originals.put(row);
  } catch {
    // Quota or private mode: the in-memory copy serves this session.
  }
}

/** The original from this device's intake cache only. */
export async function getCachedOriginal(sha256: string | undefined): Promise<CachedOriginal | undefined> {
  if (!sha256) return undefined;
  const hit = memory.get(sha256);
  if (hit) return hit;
  try {
    return (await open()?.originals.get(sha256)) ?? undefined;
  } catch {
    return undefined;
  }
}

/** The original from the intake cache, else from files restored with a workspace backup
 * (intake originals travel in ZIP backups, so the viewer works after a restore). */
export async function getOriginal(sha256: string | undefined): Promise<CachedOriginal | undefined> {
  const cached = await getCachedOriginal(sha256);
  if (cached || !sha256) return cached;
  try {
    const { getRestoredFile } = await import("../../lib/workspaceArchiveFiles");
    const blob = await getRestoredFile({ sha256 });
    return blob ? { sha256, blob, name: sha256, mimeType: blob.type || undefined, size: blob.size, cachedAtISO: "" } : undefined;
  } catch {
    return undefined;
  }
}

export async function originalsUsage(): Promise<{ files: number; bytes: number }> {
  try {
    const rows = (await open()?.originals.toArray()) ?? [];
    return { files: rows.length, bytes: rows.reduce((sum, row) => sum + row.size, 0) };
  } catch {
    return { files: memory.size, bytes: [...memory.values()].reduce((sum, row) => sum + row.size, 0) };
  }
}

export async function clearOriginals(): Promise<void> {
  memory.clear();
  try {
    await open()?.originals.clear();
  } catch {
    // nothing stored
  }
}
