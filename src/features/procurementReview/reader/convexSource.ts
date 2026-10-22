/**
 * The hosted reader's data: indexed, authenticated Convex queries; file bytes
 * only on preview or download. A catalog generation never changes once
 * imported, so the whole-kind lists and the catalog's review rows are read
 * once (one-shot queries, large bounded pages) and kept for the life of the
 * source rather than held open as subscriptions.
 */
import { useEffect, useMemo, useState } from "react";
import { useConvex, useMutation, useQuery } from "convex/react";
import { api } from "../../../lib/convexApi";
import { readProcurementDocument } from "../lib/documents";
import type { ReviewRow } from "../lib/review";
import { useProcurementClock, useProcurementDeadline } from "../lib/clock";
import { deadlineInstant, procurementDeadlineValue } from "../lib/notice";
import { analysisIdentity, normalizeAnalysisRequest, type AnalysisRequest, type AnalysisResult } from "../../../../shared/procurementAnalytics";
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
    useAnalysis(request: AnalysisRequest) {
      const clock = useProcurementClock();
      let identity = "", serialized = "", invalid = "";
      try { identity = analysisIdentity(request, clock); serialized = JSON.stringify(normalizeAnalysisRequest(request)); }
      catch (error) { invalid = error instanceof Error ? error.message : "Invalid analysis filters."; identity = JSON.stringify(request); }
      const asOf = clock;
      const enqueue = useMutation(api.procurementAnalytics.request);
      const [failure, setFailure] = useState<{ key: string; error: string } | null>(null);
      const args = { societyId, generation, request: serialized, asOf };
      const result = useQuery(api.procurementAnalytics.get, invalid ? "skip" : args) as { state: "preparing" | "ready" | "failed"; resultJson: string | null; error: string | null; computedAt: number | null; asOf: number; metricVersion: string; mappingVersion: string } | undefined;
      const retry = () => { if (invalid) return; setFailure(null); void enqueue(args).catch(error => setFailure({ key: identity, error: error instanceof Error ? error.message : "Could not prepare analysis." })); };
      useEffect(() => {
        if (invalid) return;
        let live = true;
        const timer = setTimeout(() => { void enqueue(args).catch(error => { if (live) setFailure({ key: identity, error: error instanceof Error ? error.message : "Could not prepare analysis." }); }); }, 250);
        return () => { live = false; clearTimeout(timer); };
      }, [identity, societyId, generation, asOf]); // eslint-disable-line react-hooks/exhaustive-deps -- identity includes every normalized input
      const parsed = useMemo(() => result?.resultJson ? JSON.parse(result.resultJson) as AnalysisResult : null, [result?.resultJson]);
      const boundary = parsed?.type === "opportunities" || parsed?.type === "decisions" ? parsed.data.nextBoundaryAt : parsed?.type === "party" ? parsed.data.opportunities.nextBoundaryAt : null;
      useProcurementDeadline(boundary);
      const error = invalid || (failure?.key === identity ? failure.error : null) || result?.error || null;
      return { state: error ? "failed" : result?.state ?? "preparing", result: parsed, error, computedAt: result?.computedAt ?? null, asOf: result?.asOf ?? asOf, metricVersion: result?.metricVersion ?? "", mappingVersion: result?.mappingVersion ?? "", retry };
    },
    usePage(kind, request, cursor) {
      const asOf = useProcurementClock();
      const result = useQuery(api.procurementReview.page, { societyId, generation, kind, request, asOf, paginationOpts: { numItems: 50, cursor } }) as any;
      const deadlines: number[] = (result?.page ?? []).map((row: ListRow) => deadlineInstant(procurementDeadlineValue(row))).filter((at: number | null): at is number => at !== null && at >= asOf);
      useProcurementDeadline(deadlines.length ? Math.min(...deadlines) + 1 : null);
      return result;
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
