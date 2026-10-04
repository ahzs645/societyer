/** Old persisted setup snapshots contained personal view configuration. They
 * cannot authorize a render; current Convex/portable query results supply it. */
export function purgeLegacyMetadataCache() {
  if (typeof window === "undefined") return;
  try {
    const storage = window.localStorage;
    const keys: string[] = [];
    for (let index = 0; index < storage.length; index++) {
      const key = storage.key(index);
      if (key?.startsWith("societyer.record-table.v")) keys.push(key);
    }
    for (const key of keys) storage.removeItem(key);
  } catch {
    // Unavailable storage must not block an authorized live query.
  }
}
