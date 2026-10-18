/**
 * The catalog console accepts one bounded, read-only SELECT. A port of
 * `validateCatalogSelect` in zoer/backend/src/catalog-reader.ts; keep the two
 * in step so a statement the plugin builds works in both hosts.
 */

export type CatalogParameter = string | number;

const ALLOWED_FUNCTIONS = new Set(["select", "in", "exists", "count", "sum", "avg", "min", "max", "length", "lower", "upper", "json_extract", "coalesce", "julianday", "cast"]);
const FORBIDDEN = /;|\b(main|temp|pragma|attach|detach|load_extension|sqlite_|insert|update|delete|drop|alter)\b/i;

export const CATALOG_SELECT_ROW_LIMIT = 200;
export const CATALOG_SELECT_TIMEOUT_MS = 3000;
export const CATALOG_SELECT_MAX_OUTPUT = 4 * 1024 * 1024;

export function validateCatalogSelect(statement: unknown, parameters: unknown): asserts parameters is CatalogParameter[] {
  if (!Array.isArray(parameters) || parameters.length > 200 || parameters.some((value) => typeof value !== "string" && (typeof value !== "number" || !Number.isFinite(value))) || JSON.stringify(parameters).length > 100000) {
    throw new Error("Use at most 200 bounded string or number query parameters.");
  }
  if (typeof statement !== "string" || statement.length > 10000 || !/^\s*select\b/i.test(statement) || FORBIDDEN.test(statement)) throw new Error("Use one read-only SELECT statement.");
  const functions = [...statement.matchAll(/([a-z_][a-z0-9_]*)\s*\(/gi)].map((match) => match[1].toLowerCase());
  if (functions.some((name) => !ALLOWED_FUNCTIONS.has(name))) throw new Error("Use simple aggregates, text functions or json_extract in the catalog console.");
  if (/\bcontent\b/i.test(statement)) throw new Error("Download files from their record; binary content is not available in SQL results.");
}

/** The wrapper the reference runner uses: never more than one row past the limit. */
export function boundedCatalogSelect(statement: string): string {
  return `SELECT * FROM (${statement}) LIMIT ${CATALOG_SELECT_ROW_LIMIT + 1}`;
}
