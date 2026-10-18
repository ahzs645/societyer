/**
 * Where the procurement reader gets its data. Hosted workspaces read bounded
 * Convex queries (convexSource.ts); the no-login demo reads its bundled
 * snapshot (snapshotSource.ts). The reader's pages only see this contract, so
 * the demo shows exactly what a signed-in reviewer sees.
 *
 * Each `use*` member is a React hook: call it unconditionally, and keep the
 * source object stable for the life of the page.
 */
import { createContext, useContext } from "react";
import type { StoredProcurementDocument } from "../lib/documents";
import type { ReviewRow } from "../lib/review";

export type RecordSummary = { recordKey: string; kind: string; title: string; organization: string; date: string; status: string; dateText?: string };
export type RecordPage = { page: RecordSummary[]; isDone: boolean; continueCursor: string };
export type DocumentPage = { page: StoredProcurementDocument[]; isDone: boolean; continueCursor: string };
export type ReaderCatalog = { generation: string; publishedAt: string; counts: Record<string, number> };

/**
 * One page of records. `from` (a YYYY-MM-DD day) lists upcoming dates
 * soonest first; without it the newest dates come first. Search ranks by
 * relevance and ignores both.
 */
export type RecordQuery = { kind: string; search: string; status: string; from?: string; cursor: string | null; pageSize: number };

export type ReaderSource = {
  catalog: ReaderCatalog;
  useRecords(query: RecordQuery): RecordPage | undefined;
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
