/**
 * The hosted reader's data: indexed, authenticated Convex queries; file bytes
 * only on preview or download. A catalog generation never changes once
 * imported, so the whole-kind lists and the catalog's review rows are read
 * once (one-shot queries, large bounded pages) and kept for the life of the
 * source rather than held open as subscriptions.
 */
import { useMemo } from "react";
import { useConvex, useQuery } from "convex/react";
import { api } from "../../../lib/convexApi";
import { readProcurementDocument } from "../lib/documents";
import type { ReviewRow } from "../lib/review";
import { progressive, useProgressive, type CatalogReviewRow, type DocumentPage, type ListRow, type Progressive, type ReaderCatalog, type ReaderSource, type RecordList, type RecordSummary } from "./source";

/** procurementReview:list reads at most this many rows a page (fewer when it reaches its bytes bound). */
const LIST_PAGE = 1000;
const REVIEW_PAGE = 500;
/** The insights read at most this many review rows; past it they say the figures are partial. */
const REVIEW_LIMIT = 5000;

type Page<T> = { page: T[]; isDone: boolean; continueCursor: string };

export function useConvexReaderSource(societyId: string, catalog: ReaderCatalog): ReaderSource {
  const { generation } = catalog;
  const client = useConvex();
  // Kept apart from the source object, which follows `catalog`, so a re-delivered catalog never drops loaded lists.
  const loaded = useMemo(() => {
    const lists = new Map<string, Progressive<RecordList>>();
    const list = (kind: string, total: number) => {
      let store = lists.get(kind);
      if (!store) {
        store = progressive<RecordList>(async (emit) => {
          let rows: ListRow[] = [];
          for (let cursor: string | null = null; ;) {
            const result = await client.query(api.procurementReview.list, { societyId, generation, kind, paginationOpts: { numItems: LIST_PAGE, cursor } }) as Page<ListRow>;
            rows = rows.concat(result.page);
            emit({ rows, total: result.isDone ? rows.length : Math.max(total, rows.length), done: result.isDone });
            if (result.isDone) return;
            cursor = result.continueCursor;
          }
        });
        lists.set(kind, store);
      }
      return store;
    };
    const reviews = progressive<{ rows: CatalogReviewRow[]; truncated: boolean }>(async (emit) => {
      let rows: CatalogReviewRow[] = [];
      for (let cursor: string | null = null; ;) {
        const result = await client.query(api.procurementReview.reviews, { societyId, generation, paginationOpts: { numItems: REVIEW_PAGE, cursor } }) as Page<CatalogReviewRow>;
        rows = rows.concat(result.page);
        if (result.isDone || rows.length >= REVIEW_LIMIT) { emit({ rows: rows.slice(0, REVIEW_LIMIT), truncated: !result.isDone || rows.length > REVIEW_LIMIT }); return; }
        cursor = result.continueCursor;
      }
    });
    return { list, reviews };
  }, [client, societyId, generation]);

  return useMemo<ReaderSource>(() => ({
    catalog,
    usePage(kind, request, cursor) {
      const asOf = useMemo(() => Date.now(), [societyId, generation, kind, request]);
      return useQuery(api.procurementReview.page, { societyId, generation, kind, request, asOf, paginationOpts: { numItems: 50, cursor } }) as any;
    },
    useList(kind: string) {
      return useProgressive(loaded.list(kind, catalog.counts[kind] ?? 0));
    },
    useReviews() {
      return useProgressive(loaded.reviews);
    },
    useRecord(recordKey: string) {
      return useQuery(api.procurementReview.record, { societyId, generation, recordKey }) as { summary: RecordSummary; dataJson: string } | null | undefined;
    },
    useDocuments(recordKey: string, cursor: string | null) {
      return useQuery(api.procurementReview.documents, { societyId, generation, recordKey, paginationOpts: { numItems: 10, cursor } }) as DocumentPage | undefined;
    },
    useReview(recordKey: string) {
      return useQuery(api.procurementReview.review, { societyId, generation, recordKey }) as { rows: ReviewRow[]; truncated: boolean } | undefined;
    },
    readDocument: (document, signal) => readProcurementDocument(societyId, document, signal),
    previewId: (document) => `procurement:${societyId}:${generation}:${document.documentKey}`,
  }), [societyId, generation, catalog, loaded]);
}
