/**
 * The no-login demo's reader data: its bundled snapshot, opened in the catalog
 * worker. The demo catalog is small (a console read returns at most 200 rows),
 * so a kind is read once, then filtered, sorted and paged here the way the
 * hosted queries do it on the server.
 */
import { useEffect, useMemo, useState } from "react";
import type { SnapshotManifest } from "../../../../shared/procurementReview/manifest";
import type { BlobReader } from "../lib/blobs";
import type { CatalogClient } from "../lib/catalogClient";
import { readVerifiedDocument, type StoredProcurementDocument } from "../lib/documents";
import { sortableDate } from "../lib/notice";
import type { ReviewRow } from "../lib/review";
import type { DocumentPage, ReaderSource, RecordPage, RecordQuery, RecordSummary } from "./source";

type SqlRow = Record<string, unknown>;
const REVIEW_TABLES = ["reviews", "procurement_stage_runs", "procurement_requirements", "procurement_facts", "procurement_assessments", "procurement_decisions", "procurement_tasks", "procurement_changes", "procurement_matches", "procurement_judgements"];
const str = (value: unknown) => (typeof value === "string" ? value : typeof value === "number" ? String(value) : "");

/** `load`'s result once it settles; a failure is thrown to the page's error boundary rather than loading forever. */
function useAsync<T>(key: string, load: () => Promise<T>): T | undefined {
  const [state, setState] = useState<{ key: string; value: T } | { key: string; error: unknown } | null>(null);
  useEffect(() => {
    let live = true;
    load().then((value) => { if (live) setState({ key, value }); }, (error: unknown) => { if (live) setState({ key, error }); });
    return () => { live = false; };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps -- `key` names everything `load` reads
  if (state?.key !== key) return undefined;
  if ("error" in state) throw state.error;
  return state.value;
}

/** The import's list projection of one catalog row (scripts/procurement/export-convex.py `project_record`). */
function summarize(row: SqlRow): RecordSummary & { searchText: string } {
  let data: SqlRow = {};
  try { data = JSON.parse(str(row.data)) as SqlRow; } catch { /* a malformed row still lists by title */ }
  const text = (...keys: string[]) => keys.map((key) => str(data[key]).trim()).find(Boolean) ?? "";
  const kind = str(row.kind);
  const keys = kind === "award" ? ["awardDate", "issueDate"] : ["closingAt", "closingDate", "issueDate"];
  return {
    recordKey: str(row.id), kind, title: str(row.title),
    organization: text("issuedBy", "issuingOrganization"), status: text("status"),
    date: keys.map((key) => sortableDate(data[key])).find(Boolean) ?? "",
    dateText: text("closingDate", "awardDate", "issueDate"),
    searchText: [str(row.title), text("issuedBy", "issuingOrganization"), text("searchText", "description"), text("successfulSupplier", "mainCommodity"), str(row.id)].join(" ").toLowerCase(),
  };
}

export function useSnapshotReaderSource(manifest: SnapshotManifest, catalog: CatalogClient, read: BlobReader): ReaderSource {
  return useMemo<ReaderSource>(() => {
    const rows = async (statement: string, parameters: (string | number)[] = []) =>
      ((await catalog.call("query", { statement, parameters })) as { rows: SqlRow[] }).rows;
    const kinds = new Map<string, Promise<(RecordSummary & { searchText: string })[]>>();
    const all = (kind: string) => {
      let loaded = kinds.get(kind);
      if (!loaded) kinds.set(kind, loaded = rows("SELECT id, kind, title, data FROM records WHERE kind = ? LIMIT 200", [kind]).then((list) => list.map(summarize)));
      return loaded;
    };
    return {
      catalog: { generation: manifest.snapshotId, publishedAt: manifest.publishedAt, counts: manifest.counts },
      useRecords(query: RecordQuery) {
        return useAsync<RecordPage>(JSON.stringify(query), async () => {
          const words = query.search.toLowerCase().split(/\s+/).filter(Boolean);
          let list = (await all(query.kind)).filter((row) => (!query.status || row.status === query.status) && words.every((word) => row.searchText.includes(word)));
          if (query.from && !query.search) list = list.filter((row) => row.date >= query.from!).sort((a, b) => a.date.localeCompare(b.date));
          else if (!query.search) list = [...list].sort((a, b) => b.date.localeCompare(a.date));
          const start = Number(query.cursor ?? 0);
          const page = list.slice(start, start + query.pageSize).map(({ searchText: _searchText, ...row }) => row);
          return { page, isDone: start + query.pageSize >= list.length, continueCursor: String(start + query.pageSize) };
        });
      },
      useRecord(recordKey: string) {
        return useAsync(`record:${recordKey}`, async () => {
          const [row] = await rows("SELECT id, kind, title, data FROM records WHERE id = ?", [recordKey]);
          if (!row) return null;
          const { searchText: _searchText, ...summary } = summarize(row);
          return { summary, dataJson: str(row.data) };
        });
      },
      useDocuments(recordKey: string, cursor: string | null) {
        return useAsync<DocumentPage>(`documents:${recordKey}:${cursor}`, async () => {
          const start = Number(cursor ?? 0);
          const list = await rows("SELECT id, name, media_type, sha256, status FROM documents WHERE record_id = ? ORDER BY name LIMIT 11 OFFSET ?", [recordKey, start]);
          const page: StoredProcurementDocument[] = list.slice(0, 10).map((row) => {
            const file = manifest.files[str(row.sha256)];
            return { documentKey: str(row.id), name: str(row.name), mediaType: str(row.media_type) || "application/octet-stream", sha256: str(row.sha256), bytes: file?.bytes ?? 0, parts: file?.parts ?? 0, available: Boolean(file) };
          });
          return { page, isDone: list.length <= 10, continueCursor: String(start + 10) };
        });
      },
      useReview(recordKey: string) {
        return useAsync(`review:${recordKey}`, async () => {
          const found: ReviewRow[] = [];
          for (const table of REVIEW_TABLES) {
            // Older snapshots lack some review tables.
            const list = await rows(`SELECT * FROM ${table} WHERE record_id = ? LIMIT 120`, [recordKey]).catch(() => []);
            for (const row of list) found.push({ source: table, dataJson: JSON.stringify(row) });
          }
          return { rows: found.slice(0, 120), truncated: found.length > 120 };
        });
      },
      readDocument: (document, signal) => readVerifiedDocument(read, document, signal),
      previewId: (document) => `procurement:demo:${manifest.snapshotId}:${document.documentKey}`,
    };
  }, [manifest, catalog, read]);
}
