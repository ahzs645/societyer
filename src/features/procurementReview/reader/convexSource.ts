/** The hosted reader's data: indexed, authenticated Convex queries; file bytes only on preview or download. */
import { useMemo } from "react";
import { useQuery } from "convex/react";
import { api } from "../../../lib/convexApi";
import { readProcurementDocument } from "../lib/documents";
import type { ReviewRow } from "../lib/review";
import type { DocumentPage, ReaderCatalog, ReaderSource, RecordPage, RecordQuery, RecordSummary } from "./source";

export function useConvexReaderSource(societyId: string, catalog: ReaderCatalog): ReaderSource {
  const { generation } = catalog;
  return useMemo<ReaderSource>(() => ({
    catalog,
    useRecords({ kind, search, status, from, cursor, pageSize }: RecordQuery) {
      return useQuery(api.procurementReview.records, {
        societyId, generation, kind, search, status,
        ...(from && !search ? { from } : {}),
        paginationOpts: { numItems: pageSize, cursor },
      }) as RecordPage | undefined;
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
  }), [societyId, generation, catalog]);
}
