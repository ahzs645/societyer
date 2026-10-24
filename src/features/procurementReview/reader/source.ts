/**
 * Where the procurement reader gets its data. Hosted workspaces read bounded
 * Convex queries (convexSource.ts); the no-login demo reads its bundled
 * snapshot (snapshotSource.ts). The reader's pages only see this contract, so
 * the demo shows exactly what a signed-in reviewer sees.
 *
 * Each `use*` member is a React hook: call it unconditionally, and keep the
 * source object stable for the life of the page.
 */
import { createContext, useContext, useSyncExternalStore } from "react";
import type { StoredProcurementDocument } from "../lib/documents";
import type { ReviewRow } from "../lib/review";
import type { AnalysisRequest, AnalysisState } from "../../../../shared/procurementAnalytics";

export type RecordSummary = { recordKey: string; kind: string; title: string; organization: string; date: string; status: string; dateText?: string };
export type DocumentPage = { page: StoredProcurementDocument[]; isDone: boolean; continueCursor: string };
export type ReaderCatalog = { generation: string; publishedAt: string; counts: Record<string, number> };

/**
 * One record as the list, the buyer pages and the analytics see it. A kind's
 * whole list is loaded (it is small: no notice bodies, no file contents), so
 * the shared table sorts, filters and groups the entire catalog, not a page.
 */
export type { ListRow } from "../../../../shared/procurementListRow";
import type { ListRow } from "../../../../shared/procurementListRow";
/** A kind's list as it loads: rows so far, how many there are in all, and whether it's complete. */
export type RecordList = { rows: ListRow[]; total: number; done: boolean };
/** A published review row with the record it belongs to (for the catalog-wide insights). */
export type CatalogReviewRow = ReviewRow & { recordKey: string };

export type ReaderSource = {
  catalog: ReaderCatalog;
  /** Publication metrics prepared once on the server; drill-downs return at most 50 records. */
  useAnalysis?: (request: AnalysisRequest) => AnalysisState & { retry: () => void };
  /** Hosted interactive page; absent for the offline snapshot host. */
  usePage?: (kind: string, request: string, cursor: string | null) => { page: ListRow[]; isDone: boolean; continueCursor: string; scanned: number; relevance: boolean; restart?: boolean } | undefined;
  /**
   * Every record of a kind, loaded progressively; `undefined` until the first
   * rows arrive. A kind loads the first time it is asked for and stays loaded
   * for the life of the source, so returning to the list doesn't reload it.
   */
  useList(kind: string): RecordList | undefined;
  /** Every published review row in the catalog (bounded; `truncated` past the bound); for the insights. Loaded once, on first use. */
  useReviews(): { rows: CatalogReviewRow[]; truncated: boolean } | undefined;
  useRecord(recordKey: string): { summary: RecordSummary; dataJson: string } | null | undefined;
  useDocuments(recordKey: string, cursor: string | null): DocumentPage | undefined;
  /** Every published review row for the record (bounded); `truncated` when there were more. */
  useReview(recordKey: string): { rows: ReviewRow[]; truncated: boolean } | undefined;
  readDocument(document: StoredProcurementDocument, signal?: AbortSignal): Promise<ArrayBuffer>;
  /** Stable id for the shared file preview's cache. */
  previewId(document: StoredProcurementDocument): string;
};

export const ReaderSourceContext = createContext<ReaderSource | null>(null);

export function useReaderSource(): ReaderSource {
  const source = useContext(ReaderSourceContext);
  if (!source) throw new Error("The procurement reader needs a data source.");
  return source;
}

/**
 * A value that loads in steps the first time a component subscribes, then
 * stays: every reader of it shares one load. `read` throws the load's failure
 * to the page's error boundary rather than loading forever.
 */
export type Progressive<T> = { read: () => T | undefined; subscribe: (listener: () => void) => () => void };

export function progressive<T>(load: (emit: (value: T) => void) => Promise<void>): Progressive<T> {
  let value: T | undefined;
  let failure: { error: unknown } | null = null;
  let started = false;
  const listeners = new Set<() => void>();
  const notify = () => { for (const listener of listeners) listener(); };
  return {
    read: () => { if (failure) throw failure.error; return value; },
    subscribe: (listener) => {
      listeners.add(listener);
      if (!started) {
        started = true;
        load((next) => { value = next; notify(); }).catch((error: unknown) => { failure = { error }; notify(); });
      }
      return () => { listeners.delete(listener); };
    },
  };
}

export function useProgressive<T>(store: Progressive<T>): T | undefined {
  return useSyncExternalStore(store.subscribe, store.read);
}
