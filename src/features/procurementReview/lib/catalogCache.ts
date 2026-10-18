/** Verified snapshot catalogs kept on this device (IndexedDB), one per workspace: the newest snapshot replaces the last. */
import Dexie, { type Table } from "dexie";
import type { CatalogCache } from "./snapshot";

type CachedCatalog = { id: string; societyId: string; snapshotId: string; catalog: Blob; cachedAtISO: string };

class CatalogDb extends Dexie {
  catalogs!: Table<CachedCatalog, string>;
  constructor() {
    super("societyer-procurement-review");
    this.version(1).stores({ catalogs: "&id, societyId" });
  }
}

let db: CatalogDb | null = null;
function open(): CatalogDb | null {
  if (typeof indexedDB === "undefined") return null;
  db ??= new CatalogDb();
  return db;
}

/** Cache failures (quota, private browsing) only cost a refetch, so they never surface. */
export function catalogCacheFor(societyId: string): CatalogCache {
  const key = (snapshotId: string) => `${societyId}:${snapshotId}`;
  return {
    async get(snapshotId) {
      const row = await open()?.catalogs.get(key(snapshotId));
      return row && row.societyId === societyId ? new Uint8Array(await row.catalog.arrayBuffer()) : null;
    },
    async put(snapshotId, bytes) {
      const store = open();
      if (!store) return;
      await store.transaction("rw", store.catalogs, async () => {
        await store.catalogs.where("societyId").equals(societyId).delete();
        await store.catalogs.put({ id: key(snapshotId), societyId, snapshotId, catalog: new Blob([bytes]), cachedAtISO: new Date().toISOString() });
      });
    },
  };
}
