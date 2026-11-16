/**
 * Recording chunks written to this browser's IndexedDB as they are recorded,
 * so a crash, reload, closed tab or quit app doesn't lose the meeting. The
 * stash is removed once the recording is saved where the workspace keeps
 * recordings, or the person closes or discards it. On the next start the
 * recording bar offers to recover what is left.
 *
 * Best effort: when IndexedDB is unavailable (private windows, blocked site
 * data) recording still works, it just isn't crash-safe.
 */

export type StashMeta = {
  id: string;
  meetingId: string;
  meetingTitle: string;
  startedAt: number;
  mimeType: string;
  extension: string;
  /** Last chunk written: a live recording in another tab keeps this fresh. */
  updatedAt: number;
  /** Seconds recorded by the last chunk. */
  elapsed: number;
};

const DB = "societyer-meeting-recordings";
const META = "recordings";
const CHUNKS = "chunks";
/** A stash touched this recently may belong to a recording still running in another tab. */
export const STASH_LIVE_MS = 30_000;

let opening: Promise<IDBDatabase | null> | null = null;
/** Dropped in this tab: never offered back, even before the delete lands. */
const dropped = new Set<string>();

function open(): Promise<IDBDatabase | null> {
  if (opening) return opening;
  opening = new Promise((resolve) => {
    try {
      if (typeof indexedDB === "undefined") return resolve(null);
      const request = indexedDB.open(DB, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(META)) db.createObjectStore(META, { keyPath: "id" });
        if (!db.objectStoreNames.contains(CHUNKS)) db.createObjectStore(CHUNKS, { keyPath: ["id", "seq"] });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return opening;
}

function done(tx: IDBTransaction): Promise<boolean> {
  return new Promise((resolve) => {
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => resolve(false);
    tx.onabort = () => resolve(false);
  });
}

function all<T>(request: IDBRequest<T[]>): Promise<T[]> {
  return new Promise((resolve) => {
    request.onsuccess = () => resolve(request.result ?? []);
    request.onerror = () => resolve([]);
  });
}

/** Writes one chunk and refreshes the recording's details. Never throws. */
export async function stashChunk(meta: StashMeta, seq: number, chunk: Blob): Promise<boolean> {
  if (dropped.has(meta.id)) return false;
  try {
    const db = await open();
    if (!db) return false;
    const tx = db.transaction([META, CHUNKS], "readwrite");
    tx.objectStore(META).put(meta);
    tx.objectStore(CHUNKS).put({ id: meta.id, seq, blob: chunk });
    return await done(tx);
  } catch {
    return false;
  }
}

/** Recordings left in the stash, oldest first. */
export async function listStashes(): Promise<StashMeta[]> {
  try {
    const db = await open();
    if (!db) return [];
    const rows = await all<StashMeta>(db.transaction(META).objectStore(META).getAll());
    return rows.filter((row) => !dropped.has(row.id)).sort((a, b) => a.startedAt - b.startedAt);
  } catch {
    return [];
  }
}

/** The stashed recording as one file. */
export async function readStash(meta: StashMeta, fileName: string): Promise<File | null> {
  try {
    const db = await open();
    if (!db) return null;
    const range = IDBKeyRange.bound([meta.id, 0], [meta.id, Number.MAX_SAFE_INTEGER]);
    const rows = await all<{ seq: number; blob: Blob }>(db.transaction(CHUNKS).objectStore(CHUNKS).getAll(range));
    if (!rows.length) return null;
    rows.sort((a, b) => a.seq - b.seq);
    const type = meta.mimeType.split(";")[0] || "audio/webm";
    return new File(rows.map((row) => row.blob), fileName, { type });
  } catch {
    return null;
  }
}

export async function dropStash(id: string): Promise<void> {
  dropped.add(id);
  try {
    const db = await open();
    if (!db) return;
    const tx = db.transaction([META, CHUNKS], "readwrite");
    tx.objectStore(META).delete(id);
    tx.objectStore(CHUNKS).delete(IDBKeyRange.bound([id, 0], [id, Number.MAX_SAFE_INTEGER]));
    await done(tx);
  } catch {
    /* nothing to clean up */
  }
}
