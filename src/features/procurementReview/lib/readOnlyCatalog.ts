/**
 * Read-only view over a published plugin catalog. A port of ReadOnlyCatalog
 * in zoer/packages/plugin-site/src/catalog.ts (the contract's reference), so
 * the plugin sees identical response shapes; every write path is absent.
 * Keep the two in step.
 */
import {
  boundedCatalogSelect,
  CATALOG_SELECT_MAX_OUTPUT,
  CATALOG_SELECT_ROW_LIMIT,
  CATALOG_SELECT_TIMEOUT_MS,
  validateCatalogSelect,
} from "../../../../shared/procurementReview/catalogSelect";
import { SHA256_PATTERN } from "../../../../shared/procurementReview/paths";
import type { CatalogSql, SqlRow, SqlValue } from "./catalogSql";
import { sha256Hex } from "./digest";

type Input = Record<string, unknown>;
/** A row whose JSON `data` column has been parsed. */
type ParsedRow = Record<string, unknown>;

const FIELD = /^[A-Za-z][A-Za-z0-9_]{0,50}$/;
const RECORD_PAGE_BYTES = 1_500_000;

const asInput = (value: unknown): Input => (value && typeof value === "object" && !Array.isArray(value) ? value as Input : {});
const asObject = (value: unknown): Record<string, unknown> | null => (value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null);
const json = (value: SqlValue | undefined): unknown => JSON.parse(String(value));
const documentVersionKey = async (id: string, sha256: string) => "procurement:document:" + await sha256Hex(JSON.stringify([id, sha256]));

export type CatalogMethod = "query" | "read" | "workspace" | "history" | "record" | "state" | "document";
export type CatalogDocument = { name: string; content: string };

export class ReadOnlyCatalog {
  private constructor(private readonly sql: CatalogSql) {}

  /**
   * The console reads `documents` through a view without the content column,
   * as the reference runner does; the catalog's own lookups name main.documents.
   */
  static async open(sql: CatalogSql): Promise<ReadOnlyCatalog> {
    try {
      await sql.all("CREATE TEMP VIEW documents AS SELECT id,record_id,url,name,media_type,sha256,byte_length AS bytes,text,status,error,updated_at FROM main.documents");
    } catch {
      // A catalog without a documents table has nothing to hide.
    }
    return new ReadOnlyCatalog(sql);
  }

  close() {
    return this.sql.close();
  }

  private async one(statement: string, parameters: (string | number)[] = []): Promise<SqlRow | null> {
    return (await this.sql.all(statement, parameters))[0] ?? null;
  }

  private async parsed(statement: string, parameters: (string | number)[]): Promise<ParsedRow[]> {
    return (await this.sql.all(statement, parameters)).map((row) => ({ ...row, data: json(row.data) }));
  }

  async record(id: string): Promise<ParsedRow | null> {
    const row = await this.one("SELECT * FROM records WHERE id=?", [id]);
    if (!row) return null;
    const data = json(row.data);
    const record = asObject(data);
    const lookup = asObject(record?.attachmentLookup);
    if (record && lookup && typeof lookup.kind === "string" && typeof lookup.value === "string" && typeof lookup.field === "string" && FIELD.test(lookup.field)) {
      const sources = await this.sql.all("SELECT data FROM records WHERE kind=? AND json_extract(data,?)=? LIMIT 2", [lookup.kind, "$." + lookup.field, lookup.value]);
      const source = sources.length === 1 ? asObject(json(sources[0].data)) : null;
      record.attachments = Array.isArray(source?.attachments) ? source.attachments : [];
      record.attachmentSource = source?.detailUrl ?? null;
    }
    return { ...row, data };
  }

  async workspaceRead(value: unknown = {}) {
    const input = asInput(value);
    const revision = Number((await this.one("SELECT data FROM workspace_state WHERE key='_revision'"))?.data ?? 0);
    if (input.revision !== undefined && input.revision !== revision) throw new Error("Catalog changed; reload the snapshot.");
    const limit = Math.min(200, Math.max(1, Number(input.limit) || 100));
    const after = String(input.after ?? "");
    let rows: ParsedRow[];
    if (input.ids) {
      const ids = input.ids;
      if (!Array.isArray(ids) || ids.length > 200 || ids.some((id) => typeof id !== "string")) throw new Error("Read at most 200 record IDs.");
      rows = [];
      for (const id of ids as string[]) {
        const row = await this.record(id);
        if (row) rows.push(row);
      }
    } else if (input.match) {
      const { field, value: matchValue, kind } = asInput(input.match);
      if (typeof field !== "string" || !FIELD.test(field) || typeof matchValue !== "string" || typeof kind !== "string") throw new Error("Invalid record lookup.");
      rows = await this.parsed("SELECT * FROM records WHERE kind=? AND json_extract(data,?)=? ORDER BY id LIMIT ?", [kind, "$." + field, matchValue, limit]);
    } else if (input.kind !== undefined) {
      if (typeof input.kind !== "string" || input.kind.length > 100) throw new Error("Invalid record kind.");
      rows = await this.parsed("SELECT * FROM records WHERE kind=? AND id>? ORDER BY id LIMIT ?", [input.kind, after, limit]);
    } else {
      rows = await this.parsed("SELECT * FROM records WHERE id>? ORDER BY id LIMIT ?", [after, limit]);
    }
    let size = 0;
    const records: ParsedRow[] = [];
    const encoder = new TextEncoder();
    for (const row of rows) {
      const bytes = encoder.encode(JSON.stringify(row)).byteLength;
      if (records.length && size + bytes > RECORD_PAGE_BYTES) break;
      size += bytes;
      records.push(row);
    }
    if (input.ids && records.length !== rows.length) throw new Error("Record lookup too large; use fewer IDs.");
    return {
      revision,
      primary: Boolean(await this.one("SELECT 1 FROM workspace_state WHERE key='_primary'")),
      records,
      next: !input.ids && !input.match && records.length ? records[records.length - 1].id : null,
    };
  }

  async workspaceState(value: unknown = {}) {
    const input = asInput(value);
    const { revision } = await this.workspaceRead({ ids: [] });
    if (input.revision !== undefined && input.revision !== revision) throw new Error("Catalog changed; reload the snapshot.");
    if (input.keys) {
      const keys = input.keys;
      if (!Array.isArray(keys) || keys.length > 20 || keys.some((key) => typeof key !== "string" || key.startsWith("_"))) throw new Error("Invalid state keys.");
      const entries: { key: SqlValue; value: unknown }[] = [];
      for (const key of keys as string[]) {
        const row = await this.one("SELECT key,data FROM workspace_state WHERE key=?", [key]);
        if (row) entries.push({ key: row.key, value: json(row.data) });
      }
      return { revision, entries, next: null };
    }
    const rows = await this.sql.all("SELECT key,data FROM workspace_state WHERE key>? AND key NOT LIKE '\\_%' ESCAPE '\\' ORDER BY key LIMIT 50", [String(input.after ?? "")]);
    return { revision, entries: rows.map((row) => ({ key: row.key, value: json(row.data) })), next: rows.length ? rows[rows.length - 1].key : null };
  }

  async historyRead(value: unknown = {}) {
    const input = asInput(value);
    if (typeof input.runId !== "string") throw new Error("Run ID required.");
    const rows = await this.sql.all("SELECT record_id,data FROM record_history WHERE run_id=? AND record_id>? ORDER BY record_id LIMIT 50", [input.runId, String(input.after ?? "")]);
    return { rows: rows.map((row) => ({ id: row.record_id, data: json(row.data) })), next: rows.length ? rows[rows.length - 1].record_id : null };
  }

  async overview() {
    return {
      counts: await this.sql.all("SELECT kind,count(*) AS count FROM records GROUP BY kind"),
      prompts: await this.sql.all("SELECT * FROM prompts ORDER BY updated_at DESC"),
      batches: await this.sql.all("SELECT * FROM batches ORDER BY updated_at DESC LIMIT 30"),
    };
  }

  /** `catalog.record`: the record with its documents, reviews and tags. */
  async details(id: string) {
    return {
      record: await this.record(id),
      documents: await this.sql.all("SELECT id,record_id,url,name,media_type,sha256,byte_length AS bytes,length(text) AS text_length,status,error,updated_at FROM main.documents WHERE record_id=?", [id]),
      reviews: (await this.sql.all("SELECT * FROM reviews WHERE record_id=? ORDER BY created_at DESC LIMIT 30", [id])).map((review) => ({ ...review, result: review.result ? json(review.result) : null })),
      tags: (await this.sql.all("SELECT value FROM tags WHERE record_id=? ORDER BY value", [id])).map((tag) => tag.value),
    };
  }

  async query(statement: unknown, parameters: unknown = []) {
    validateCatalogSelect(statement, parameters);
    const start = Date.now();
    let rows: SqlRow[];
    try {
      rows = await this.sql.all(boundedCatalogSelect(statement as string), parameters, { deadlineMs: CATALOG_SELECT_TIMEOUT_MS });
    } catch {
      throw new Error("Query failed or exceeded its three-second limit. Use the table schema and a smaller SELECT.");
    }
    const result = {
      rows: rows.slice(0, CATALOG_SELECT_ROW_LIMIT),
      columns: Object.keys(rows[0] ?? {}),
      truncated: rows.length > CATALOG_SELECT_ROW_LIMIT,
      durationMs: Date.now() - start,
    };
    if (JSON.stringify(result).length > CATALOG_SELECT_MAX_OUTPUT) throw new Error("Query output exceeds 4 MiB; select fewer columns.");
    return result;
  }

  /** The document route, including pinned immutable versions (procurement:document:* state). */
  async document(documentId: string, sha256?: string): Promise<CatalogDocument | null> {
    if (sha256) {
      if (!SHA256_PATTERN.test(sha256)) throw new Error("Invalid document version.");
      const version = asObject((await this.workspaceState({ keys: [await documentVersionKey(documentId, sha256)] })).entries[0]?.value);
      if (!version || version.documentId !== documentId || version.sha256 !== sha256 || version.content !== sha256) throw new Error("Retained document version not found.");
      return { name: String(version.name ?? "document"), content: sha256 };
    }
    const row = await this.one("SELECT name,content FROM main.documents WHERE id=? AND status='downloaded'", [documentId]);
    // `content` holds the blob's content address, stored as text (or as its UTF-8 bytes).
    const content = row?.content instanceof Uint8Array ? new TextDecoder().decode(row.content) : row?.content;
    return row && typeof content === "string" && SHA256_PATTERN.test(content) ? { name: String(row.name ?? "document"), content } : null;
  }

  /** One bridge-shaped call, by the catalog method the host routes to. */
  call(method: CatalogMethod, value: unknown): Promise<unknown> {
    const input = asInput(value);
    switch (method) {
      case "query": return this.query(input.statement, input.parameters ?? []);
      case "read": return this.workspaceRead(input);
      case "workspace": return this.workspaceState(input);
      case "history": return this.historyRead(input);
      case "record": return this.details(String(input.id ?? ""));
      case "state": return this.overview();
      case "document": return this.document(String(input.id ?? ""), typeof input.sha256 === "string" ? input.sha256 : undefined);
    }
  }
}
