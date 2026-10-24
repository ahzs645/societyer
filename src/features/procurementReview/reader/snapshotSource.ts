/**
 * The no-login demo's reader data: its bundled snapshot, opened in the catalog
 * worker. A console read returns at most 200 rows, so a kind's list is read in
 * 200-row batches (each shown as it arrives) and projected here the way the
 * hosted import projects it (scripts/procurement/export-convex.py
 * `project_record`), so the demo's list has the same columns.
 */
import { useEffect, useMemo, useState } from "react";
import type { SnapshotManifest } from "../../../../shared/procurementReview/manifest";
import type { BlobReader } from "../lib/blobs";
import type { CatalogClient } from "../lib/catalogClient";
import { readVerifiedDocument, type StoredProcurementDocument } from "../lib/documents";
import { describeNotice, sortableDate } from "../lib/notice";
import type { ReviewRow } from "../lib/review";
import { progressive, useProgressive, type CatalogReviewRow, type DocumentPage, type ListRow, type Progressive, type ReaderSource, type RecordList, type RecordSummary } from "./source";

type SqlRow = Record<string, unknown>;
const REVIEW_TABLES = ["reviews", "procurement_stage_runs", "procurement_requirements", "procurement_facts", "procurement_assessments", "procurement_decisions", "procurement_tasks", "procurement_changes", "procurement_matches", "procurement_judgements"];
/** The console's row limit. */
const BATCH = 200;
/** As the hosted reader (convexSource.ts). */
const REVIEW_LIMIT = 5000;
const str = (value: unknown) => (typeof value === "string" ? value : typeof value === "number" ? String(value) : "");
const squash = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const MONEY = /^(-)?\s*(?:CA)?\$?\s*(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?$/;

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

function parse(row: SqlRow): Record<string, unknown> {
  try {
    const data: unknown = JSON.parse(str(row.data));
    return data && typeof data === "object" && !Array.isArray(data) ? data as Record<string, unknown> : {};
  } catch { return {}; /* a malformed row still lists by title */ }
}
const textOf = (data: Record<string, unknown>) => (...keys: string[]) => keys.map((key) => str(data[key]).trim()).find(Boolean) ?? "";

/** The import's summary of one catalog row. */
function summarize(row: SqlRow, data: Record<string, unknown>): RecordSummary {
  const text = textOf(data);
  const kind = str(row.kind);
  const keys = kind === "award" ? ["awardDate", "issueDate"] : ["closingAt", "closingDate", "issueDate"];
  return {
    recordKey: str(row.id), kind, title: str(row.title),
    organization: text("issuedBy", "issuingOrganization"), status: text("status"),
    date: keys.map((key) => sortableDate(data[key])).find(Boolean) ?? "",
    dateText: text("closingDate", "awardDate", "issueDate"),
  };
}

/** A contract value as a number when it reads as one ("$1,240,000.00", 64800); `money_value` in the exporter. */
function moneyValue(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) && Math.abs(value) <= 9_000_000_000_000 && Math.abs(value * 100 - Math.round(value * 100)) < .00001 ? value : null;
  const m = MONEY.exec(str(value).trim());
  if (!m) return null;
  const number = Number(m[2].replaceAll(",", "") + (m[3] ?? ""));
  return moneyValue(m[1] ? -number : number);
}
function projectedMoney(data: Record<string, unknown>) {
  const raw = str(data.contractValueText).trim(), parsed = data.contractValueParsed as Record<string, unknown> | undefined;
  if (parsed?.parserVersion === "award-money-v2" && (!raw || str(parsed.raw) === raw)) {
    if (parsed.status !== "parsed") return null;
    if (data.currency && str(parsed.currency).toUpperCase() !== str(data.currency).toUpperCase()) return raw ? moneyValue(raw) : null;
    const scale = Number(parsed.scale), decimal = str(parsed.decimal), minor = str(parsed.minorUnits);
    if (!Number.isInteger(scale) || scale < 0 || scale > 3 || !/^-?\d+$/.test(minor) || !/^-?\d+(\.\d+)?$/.test(decimal)) return null;
    const negative = decimal.startsWith("-"), [whole, fraction = ""] = decimal.replace(/^-/, "").split(".");
    if (fraction.length > scale || BigInt(`${negative ? "-" : ""}${whole}${fraction.padEnd(scale, "0")}`) !== BigInt(minor)) return null;
    return moneyValue(Number(decimal));
  }
  return raw ? moneyValue(raw) : moneyValue(data.contractValue);
}

type StoredFile = { name: string; available: boolean };
const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** `project_record` in scripts/procurement/export-convex.py; keep the two in step. */
function listRow(row: SqlRow, files: StoredFile[]): ListRow {
  const data = parse(row);
  const summary = summarize(row, data);
  const text = textOf(data);
  const award = summary.kind === "award";
  const model = describeNotice(summary, data);
  const issuedFor = text("issuedFor");
  return {
    ...summary, dateText: summary.dateText ?? "",
    issuedFor: issuedFor && squash(issuedFor) !== squash(summary.organization) ? issuedFor : "",
    reference: model.reference,
    documents: files.filter((file) => file.available).length,
    listedDocuments: model.attachments.filter((item) => !files.some((file) => sameName(file.name, item.name))).length,
    supplier: award ? text("successfulSupplier", "supplier") : "",
    value: award ? projectedMoney(data) : null,
    currency: award ? text("currency").toUpperCase() : "",
    procurementType: award ? text("opportunityType", "type") : "",
    analyticsJson: JSON.stringify(Object.fromEntries(Object.entries(data).filter(([key]) => /^(identity|sourceRevision|contractValueParsed|contractValueText|contractNumber|justification|buyer|supplierId|mapping|parserVersion|observedAt|collectionRunId|taxonomyReleaseId|classificationCodes|commodityClassifications|urlExcluded|urlExclusionReason|closingAt|closingDate|datePrecision|dateTimezone|timezone)/.test(key)))),
  };
}

export function useSnapshotReaderSource(manifest: SnapshotManifest, catalog: CatalogClient, read: BlobReader): ReaderSource {
  return useMemo<ReaderSource>(() => {
    const rows = async (statement: string, parameters: (string | number)[] = []) =>
      ((await catalog.call("query", { statement, parameters })) as { rows: SqlRow[] }).rows;
    /** Every stored file's record and name, read once: the list counts them per record. */
    let files: Promise<Map<string, StoredFile[]>> | null = null;
    const storedFiles = () => files ??= (async () => {
      const byRecord = new Map<string, StoredFile[]>();
      for (let after = ""; ;) {
        const batch = await rows("SELECT id, record_id, name, sha256 FROM documents WHERE id > ? ORDER BY id LIMIT 200", [after]);
        for (const row of batch) {
          const list = byRecord.get(str(row.record_id)) ?? [];
          list.push({ name: str(row.name), available: Boolean(manifest.files[str(row.sha256)]) });
          byRecord.set(str(row.record_id), list);
        }
        if (batch.length < BATCH) return byRecord;
        after = str(batch[batch.length - 1].id);
      }
    })();
    const lists = new Map<string, Progressive<RecordList>>();
    const list = (kind: string) => {
      let store = lists.get(kind);
      if (!store) {
        const total = manifest.counts[kind] ?? 0;
        store = progressive<RecordList>(async (emit) => {
          const stored = await storedFiles();
          let loaded: ListRow[] = [];
          for (let after = ""; ;) {
            const batch = await rows("SELECT id, kind, title, data FROM records WHERE kind = ? AND id > ? ORDER BY id LIMIT 200", [kind, after]);
            loaded = loaded.concat(batch.map((row) => listRow(row, stored.get(str(row.id)) ?? [])));
            const done = batch.length < BATCH;
            emit({ rows: loaded, total: done ? loaded.length : Math.max(total, loaded.length), done });
            if (done) return;
            after = str(batch[batch.length - 1].id);
          }
        });
        lists.set(kind, store);
      }
      return store;
    };
    // Only an explicitly absent legacy table is empty; timeouts/corruption/SQL errors propagate.
    const optionalRows = async (statement: string, parameters: (string | number)[] = []) => {
      try { return await rows(statement, parameters); }
      catch (error) { if (/no such table:/i.test(error instanceof Error ? error.message : String(error))) return []; throw error; }
    };
    const reviews = progressive<{ rows: CatalogReviewRow[]; truncated: boolean }>(async (emit) => {
      const found: CatalogReviewRow[] = [];
      for (const table of REVIEW_TABLES) {
        for (let offset = 0; found.length <= REVIEW_LIMIT; offset += BATCH) {
          // Older snapshots lack some review tables.
          const batch = await optionalRows(`SELECT * FROM ${table} ORDER BY rowid LIMIT 200 OFFSET ?`, [offset]);
          for (const row of batch) found.push({ source: table, recordKey: str(row.record_id), dataJson: JSON.stringify(row) });
          if (batch.length < BATCH) break;
        }
      }
      emit({ rows: found.slice(0, REVIEW_LIMIT), truncated: found.length > REVIEW_LIMIT });
    });
    return {
      catalog: { generation: manifest.snapshotId, publishedAt: manifest.publishedAt, counts: manifest.counts },
      useList(kind: string) {
        return useProgressive(list(kind));
      },
      useReviews() {
        return useProgressive(reviews);
      },
      useRecord(recordKey: string) {
        return useAsync(`record:${recordKey}`, async () => {
          const [row] = await rows("SELECT id, kind, title, data FROM records WHERE id = ?", [recordKey]);
          if (!row) return null;
          return { summary: summarize(row, parse(row)), dataJson: str(row.data) };
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
            const list = await optionalRows(`SELECT * FROM ${table} WHERE record_id = ? ORDER BY rowid DESC LIMIT 121`, [recordKey]);
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
