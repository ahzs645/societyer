/** A publication is immutable. Grants and loaded data live only in this reader's memory. */
import { useEffect, useMemo, useState, useRef } from "react";
import { useConvex } from "convex/react";
import { api } from "../../../lib/convexApi";
import { readProcurementDocument, type StoredProcurementDocument } from "../lib/documents";
import { useProcurementClock, useProcurementDeadline } from "../lib/clock";
import { analysisIdentity, normalizeAnalysisRequest, PROCUREMENT_METRIC_VERSION, PROCUREMENT_MAPPING_VERSION, type AnalysisRequest, type AnalysisResult, type AnalysisState } from "../../../../shared/procurementAnalytics";
import { documentTipNames } from "../lib/notice";
import { progressive, useProgressive, type CatalogReviewRow, type Progressive, type ReaderCatalog, type ReaderSource, type RecordList, type RecordSummary } from "./source";

export type ServiceCatalog = ReaderCatalog & { publicationId: string };
import { CatalogAccess } from "./catalogAccess";
export { CatalogAccess } from "./catalogAccess";
type Notice = { summary: RecordSummary; dataJson: string; removed: boolean; documents: StoredProcurementDocument[] } | null;
export function createHttpReaderSource(access: CatalogAccess, catalog: ServiceCatalog): ReaderSource & { warm: (kind: string) => Promise<void> } {
  const prefix = "/p/" + encodeURIComponent(catalog.publicationId);
  const loads = new Map<string, Promise<RecordList>>(), lists = new Map<string, Progressive<RecordList>>(), notices = new Map<string, Progressive<Notice>>();
  const load = (kind: string) => {
    if (!["opportunity", "award"].includes(kind)) return Promise.reject(new Error("Unknown procurement kind."));
    if (!loads.has(kind)) loads.set(kind, access.read<any[]>(prefix + "/list/" + kind + ".json").then(rows => ({ rows, total: rows.length, done: true })));
    return loads.get(kind)!;
  };
  const notice = (key: string) => {
    let entry = notices.get(key);
    if (!entry) { entry = progressive<Notice>(async emit => emit(await access.read<Notice>(prefix + "/notice?key=" + encodeURIComponent(key)))); notices.set(key, entry); }
    else { notices.delete(key); notices.set(key, entry); }
    if (notices.size > 64) notices.delete(notices.keys().next().value!);
    return entry;
  };
  const reviews = progressive<{ rows: CatalogReviewRow[]; truncated: boolean }>(async emit => emit(await access.read(prefix + "/reviews")));
  return {
    catalog,
    warm: async kind => { await load(kind); },
    useList(kind) {
      if (!lists.has(kind)) lists.set(kind, progressive<RecordList>(async emit => emit(await load(kind))));
      return useProgressive(lists.get(kind)!);
    },
    useRecord(key) { return useProgressive(notice(key)); },
    useDocuments(key) { const record = useProgressive(notice(key)); return record === undefined ? undefined : { page: record?.documents ?? [], isDone: true, continueCursor: "" }; },
    useDocumentTip(key) { const record = useProgressive(notice(key)); return useMemo(() => record === undefined ? undefined : record ? documentTipNames(record.documents, JSON.parse(record.dataJson), true) : null, [record]); },
    useReview(key) {
      const store = useMemo(() => progressive<{ rows: CatalogReviewRow[]; truncated: boolean }>(async emit => emit(await access.read(prefix + "/review?key=" + encodeURIComponent(key)))), [key]);
      return useProgressive(store);
    },
    useReviews() { return useProgressive(reviews); },
    prefetchRecord(key) { const store = notice(key); store.subscribe(() => {})(); },
    searchText: (query, kind, signal) => access.read(prefix + "/search?" + new URLSearchParams({ q: query, kind, limit: "100" }), { signal }),
    useAnalysis(request) { return useHttpAnalysis(access, prefix, request); },
    readDocument: (document, signal) => readProcurementDocument(access.societyId, document, signal),
    previewId: document => `procurement:${access.societyId}:${catalog.generation}:${document.documentKey}`,
  };
}
function useHttpAnalysis(access: CatalogAccess, prefix: string, request: AnalysisRequest): AnalysisState & { retry: () => void } {
  const clock = useProcurementClock(), [version, setVersion] = useState(0);
  const latestClock = useRef(clock); latestClock.current = clock;
  let identity = "", invalid = "", serialized = "", deadlineClock = 0;
  try { const normalized = normalizeAnalysisRequest(request); identity = analysisIdentity(normalized, clock); serialized = JSON.stringify(normalized); if (["opportunities", "decisions", "party"].includes(normalized.view)) deadlineClock = clock; }
  catch (error) { invalid = error instanceof Error ? error.message : "Invalid analysis filters."; }
  const [loaded, setLoaded] = useState<{ key: string; result: AnalysisResult | null; error: string | null; asOf: number; computedAt: number } | null>(null);
  useEffect(() => {
    if (invalid) return;
    const controller = new AbortController(), asOf = latestClock.current;
    void access.read<{ result: AnalysisResult; asOf: number; computedAt: number }>(prefix + "/analysis", { method: "POST", signal: controller.signal, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ request: JSON.parse(serialized), asOf }) }).then(value => setLoaded({ ...value, key: identity, error: null }), error => { if (!controller.signal.aborted) setLoaded({ key: identity, result: null, error: error instanceof Error ? error.message : "Analysis failed.", asOf, computedAt: 0 }); });
    return () => controller.abort();
  }, [access, prefix, identity, serialized, invalid, version, deadlineClock]); // exact deadline ticks also refresh within a minute bucket
  const current = loaded?.key === identity ? loaded : null, result = current?.result ?? null;
  const boundary = result?.type === "opportunities" || result?.type === "decisions" ? result.data.nextBoundaryAt : result?.type === "party" ? result.data.opportunities.nextBoundaryAt : null;
  useProcurementDeadline(boundary);
  const error = invalid || current?.error || null;
  return { state: error ? "failed" : result ? "ready" : "preparing", result, error, asOf: current?.asOf ?? clock, computedAt: current?.computedAt ?? null, metricVersion: PROCUREMENT_METRIC_VERSION, mappingVersion: PROCUREMENT_MAPPING_VERSION, retry: () => setVersion(value => value + 1) };
}
export function useCatalogAccess(societyId: string, baseUrl: string) {
  const client = useConvex();
  const resource = useMemo(() => {
    const access = new CatalogAccess(societyId, baseUrl, () => client.action(api.procurementCatalogActions.grant, { societyId }));
    let closing: ReturnType<typeof setTimeout> | undefined;
    return { access, retain: () => clearTimeout(closing), release: () => { closing = setTimeout(() => access.close(), 0); } };
  }, [client, societyId, baseUrl]);
  // React StrictMode probes effects with setup/cleanup/setup. A real unmount
  // still aborts and forgets the grant; the immediate probe cancels that close.
  useEffect(() => { resource.retain(); return resource.release; }, [resource]);
  return resource.access;
}
