/**
 * The hosted reader's data: indexed, authenticated Convex queries; file bytes
 * only on preview or download. A catalog generation never changes once
 * imported, so the whole-kind lists and the catalog's review rows are read
 * once (one-shot queries, large bounded pages) and kept for the life of the
 * source rather than held open as subscriptions.
 */
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useConvex, useMutation, useQuery } from "convex/react";
import { api } from "../../../lib/convexApi";
import { readProcurementDocument } from "../lib/documents";
import type { ReviewRow } from "../lib/review";
import { useProcurementClock, useProcurementDeadline } from "../lib/clock";
import { deadlineInstant, procurementDeadlineValue, type DocumentTipNames } from "../lib/notice";
import { analysisIdentity, normalizeAnalysisRequest, type AnalysisRequest, type AnalysisResult } from "../../../../shared/procurementAnalytics";
import type { Triage } from "../../../../shared/procurementTriage";
import { progressive, useProgressive, type CatalogReviewRow, type DocumentPage, type ListRow, type Progressive, type ReaderCatalog, type ReaderSource, type RecordList, type RecordSummary } from "./source";

/** procurementReview:list reads at most this many rows a page (fewer when it reaches its bytes bound). */
const LIST_PAGE = 1000;
const REVIEW_PAGE = 500;
/** The insights read at most this many review rows; past it they say the figures are partial. */
const REVIEW_LIMIT = 5000;

type Page<T> = { page: T[]; isDone: boolean; continueCursor: string };

/** A store with nothing in it yet, for hooks that mustn't start a whole-kind load before the generation is confirmed. */
const PENDING: Progressive<never> = { read: () => undefined, subscribe: () => () => {} };

/**
 * `confirmed` is false while `catalog` is the one this device remembered
 * (lib/lastCatalog.ts) and the live catalog is still on its way. The queries
 * are subscribed straight away, so they travel alongside the catalog's, but
 * every hook reads as loading until the generation is confirmed: a remembered
 * generation that has since been replaced reads as empty on the server, and
 * that must never show as "no notices". A replaced generation remounts the
 * reader (its key) with the live catalog.
 */
export function useConvexReaderSource(societyId: string, catalog: ReaderCatalog, confirmed = true): ReaderSource {
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
  // What this visit saved. It belongs to the workspace, not to a catalog generation.
  const triage = useMemo(() => {
    let saved: ReadonlyMap<string, Triage> = new Map();
    const listeners = new Set<() => void>();
    const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
    const read = () => saved;
    return {
      async set(recordKey: string, next: Triage) {
        await client.mutation(api.procurementReview.setTriage, { societyId, recordKey, reviewed: next.reviewed, classification: next.classification });
        saved = new Map(saved).set(recordKey, next);
        for (const listener of listeners) listener();
      },
      useOverrides: () => useSyncExternalStore(subscribe, read),
      useOne: (recordKey: string) => useQuery(api.procurementReview.triage, { societyId, recordKey }) as ReturnType<NonNullable<ReaderSource["triage"]>["useOne"]>,
    };
  }, [client, societyId]);

  return useMemo<ReaderSource>(() => ({
    catalog,
    triage,
    useAnalysis(request: AnalysisRequest) {
      const clock = useProcurementClock();
      let identity = "", serialized = "", invalid = "";
      try { identity = analysisIdentity(request, clock); serialized = JSON.stringify(normalizeAnalysisRequest(request)); }
      catch (error) { invalid = error instanceof Error ? error.message : "Invalid analysis filters."; identity = JSON.stringify(request); }
      const asOf = clock;
      const enqueue = useMutation(api.procurementAnalytics.request);
      const [failure, setFailure] = useState<{ key: string; error: string } | null>(null);
      const args = { societyId, generation, request: serialized, asOf };
      // Analysis refuses a generation that isn't the active one, so it waits for confirmation rather than failing on a stale one.
      const result = useQuery(api.procurementAnalytics.get, invalid || !confirmed ? "skip" : args) as { state: "preparing" | "ready" | "failed"; resultJson: string | null; error: string | null; computedAt: number | null; asOf: number; metricVersion: string; mappingVersion: string } | undefined;
      const retry = () => { if (invalid) return; setFailure(null); void enqueue(args).catch(error => setFailure({ key: identity, error: error instanceof Error ? error.message : "Could not prepare analysis." })); };
      // Prepared (published) results usually arrive before the pause ends; asking
      // the server to prepare one that is already ready is a wasted mutation.
      const ready = useRef(false);
      ready.current = result?.state === "ready";
      useEffect(() => {
        if (invalid || !confirmed) return;
        let live = true;
        const timer = setTimeout(() => { if (ready.current) return; void enqueue(args).catch(error => { if (live) setFailure({ key: identity, error: error instanceof Error ? error.message : "Could not prepare analysis." }); }); }, 250);
        return () => { live = false; clearTimeout(timer); };
      }, [identity, societyId, generation, asOf, confirmed]); // eslint-disable-line react-hooks/exhaustive-deps -- identity includes every normalized input
      const parsed = useMemo(() => result?.resultJson ? JSON.parse(result.resultJson) as AnalysisResult : null, [result?.resultJson]);
      const boundary = parsed?.type === "opportunities" || parsed?.type === "decisions" ? parsed.data.nextBoundaryAt : parsed?.type === "party" ? parsed.data.opportunities.nextBoundaryAt : null;
      useProcurementDeadline(boundary);
      const error = invalid || (failure?.key === identity ? failure.error : null) || result?.error || null;
      return { state: error ? "failed" : result?.state ?? "preparing", result: parsed, error, computedAt: result?.computedAt ?? null, asOf: result?.asOf ?? asOf, metricVersion: result?.metricVersion ?? "", mappingVersion: result?.mappingVersion ?? "", retry };
    },
    usePage(kind, request, cursor) {
      const asOf = useProcurementClock();
      const result = useQuery(api.procurementReview.page, request === null ? "skip" : { societyId, generation, kind, request, asOf, paginationOpts: { numItems: 50, cursor } }) as any;
      const deadlines: number[] = (result?.page ?? []).map((row: ListRow) => deadlineInstant(procurementDeadlineValue(row))).filter((at: number | null): at is number => at !== null && at >= asOf);
      useProcurementDeadline(deadlines.length ? Math.min(...deadlines) + 1 : null);
      return confirmed ? result : undefined;
    },
    useList(kind: string) {
      return useProgressive(confirmed ? loaded.list(kind, catalog.counts[kind] ?? 0) : PENDING);
    },
    useReviews() {
      return useProgressive(confirmed ? loaded.reviews : PENDING);
    },
    useRecord(recordKey: string) {
      const result = useQuery(api.procurementReview.record, { societyId, generation, recordKey }) as { summary: RecordSummary; dataJson: string } | null | undefined;
      return confirmed ? result : undefined;
    },
    useDocuments(recordKey: string, cursor: string | null) {
      const result = useQuery(api.procurementReview.documents, { societyId, generation, recordKey, paginationOpts: { numItems: 10, cursor } }) as DocumentPage | undefined;
      return confirmed ? result : undefined;
    },
    useDocumentTip(recordKey: string) {
      const result = useQuery(api.procurementReview.documentTip, { societyId, generation, recordKey }) as DocumentTipNames | null | undefined;
      return confirmed ? result : undefined;
    },
    useReview(recordKey: string) {
      const result = useQuery(api.procurementReview.review, { societyId, generation, recordKey }) as { rows: ReviewRow[]; truncated: boolean } | undefined;
      return confirmed ? result : undefined;
    },
    readDocument: (document, signal) => readProcurementDocument(societyId, document, signal),
    previewId: (document) => `procurement:${societyId}:${generation}:${document.documentKey}`,
  }), [societyId, generation, catalog, loaded, confirmed, triage]);
}
