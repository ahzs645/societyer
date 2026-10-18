import { useEffect, useState } from "react";
import { SnapshotFormatError, type SnapshotManifest } from "../../../../shared/procurementReview/manifest";
import { blobReaderFor, SnapshotAccessError, type BlobReader } from "./blobs";
import { catalogCacheFor } from "./catalogCache";
import { openCatalogWorker, type CatalogClient } from "./catalogClient";
import { fetchSnapshotManifest, loadSnapshotCatalog, SnapshotIntegrityError, type SnapshotProgress } from "./snapshot";

export type SnapshotFailure = "integrity" | "format" | "access" | "open";

export type SnapshotState =
  | { status: "idle" }
  | { status: "loading"; progress: SnapshotProgress }
  | { status: "unpublished" }
  | { status: "failed"; failure: SnapshotFailure; message: string }
  | { status: "ready"; manifest: SnapshotManifest; catalog: CatalogClient; read: BlobReader; fromCache: boolean };

function failed(error: unknown): SnapshotState {
  const message = error instanceof Error ? error.message : "The snapshot couldn't be opened.";
  if (error instanceof SnapshotIntegrityError) return { status: "failed", failure: "integrity", message };
  if (error instanceof SnapshotFormatError) return { status: "failed", failure: "format", message };
  if (error instanceof SnapshotAccessError) return { status: "failed", failure: "access", message };
  return { status: "failed", failure: "open", message };
}

/**
 * Loads the workspace's published snapshot and opens it in the catalog worker.
 * Changing `reloadKey` loads the current manifest again; the worker of the
 * previous snapshot is closed when it is replaced or the page unmounts.
 */
export function useProcurementSnapshot(societyId: string | undefined, folder: string, reloadKey: number): SnapshotState {
  const [state, setState] = useState<SnapshotState>({ status: "idle" });

  useEffect(() => {
    if (!societyId || !folder) {
      setState({ status: "idle" });
      return;
    }
    let cancelled = false;
    let opened: CatalogClient | null = null;
    setState({ status: "loading", progress: { stage: "manifest", done: 0, total: 1 } });
    (async () => {
      const read = blobReaderFor(societyId);
      const manifest = await fetchSnapshotManifest(read);
      if (cancelled) return;
      if (!manifest) {
        setState({ status: "unpublished" });
        return;
      }
      const { bytes, fromCache } = await loadSnapshotCatalog(manifest, read, {
        cache: catalogCacheFor(societyId),
        onProgress: (progress) => { if (!cancelled) setState({ status: "loading", progress }); },
      });
      if (cancelled) return;
      setState({ status: "loading", progress: { stage: "open", done: 0, total: 1 } });
      const catalog = await openCatalogWorker(bytes);
      if (cancelled) {
        catalog.close();
        return;
      }
      opened = catalog;
      setState({ status: "ready", manifest, catalog, read, fromCache });
    })().catch((error: unknown) => {
      if (!cancelled) setState(failed(error));
    });
    return () => {
      cancelled = true;
      opened?.close();
    };
  }, [societyId, folder, reloadKey]);

  return state;
}
