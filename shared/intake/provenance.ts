/** Field provenance rows that reference their intake extraction instead of copying it.
 *
 * A promoted field's provenance row used to copy the reviewed value and the
 * source locator with its quote (about 1 KB per field). The extraction keeps
 * both, and is kept for as long as the provenance is (compaction never removes
 * extractions), so new rows store only what differs from the extraction: an
 * edited value, and the locator `kind`. Readers call `hydrateProvenance` to get
 * the full row back. Legacy rows with copies hydrate to themselves; "Compact
 * this intake run" slims them with `slimProvenance`. */
import type { PortableQueryCtx } from "../portable/ctx";
import { primaryLocator } from "./review";
import { isFieldValue } from "./verify";

const clean = (value: unknown, max = 2000) => (typeof value === "string" && value.trim() ? value.trim().slice(0, max) : undefined);
const compact = <T extends Record<string, unknown>>(row: T): T => Object.fromEntries(Object.entries(row).filter(([, value]) => value !== undefined)) as T;

/** Resolves "motions[2].movedBy" against an extraction record; throws for unknown paths. */
export function resolveFieldPath(record: unknown, fieldPath: string): any {
  const parts = fieldPath.match(/[^.[\]]+|\[\d+\]/g) ?? [];
  let node: any = record;
  for (const part of parts) {
    const key = part.startsWith("[") ? Number(part.slice(1, -1)) : part;
    if (node === null || typeof node !== "object" || !(key in node)) throw new Error(`Unknown field path ${fieldPath}.`);
    node = node[key as any];
  }
  if (!isFieldValue(node)) throw new Error(`${fieldPath} is not a reviewable field.`);
  return node;
}

export const sanitizeLocator = (locator: any) => compact({ fileId: clean(locator?.fileId, 600), kind: String(locator?.kind ?? "block"), blockIndex: locator?.blockIndex, page: locator?.page, sheet: clean(locator?.sheet, 200), cell: clean(locator?.cell, 40), charStart: locator?.charStart, charEnd: locator?.charEnd, quote: clean(locator?.quote, 400) });
const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** The provenance facts a row can read from its extraction instead of copying: the reviewed value
 * (unless the reviewer edited it) and the source locator with its quote (`sourceFieldPath`'s primary locator). */
function derivedProvenance(extraction: any, sourceFieldPath: string | undefined): { value: unknown; locator: Record<string, unknown> } | undefined {
  if (!extraction?.record || !sourceFieldPath) return undefined;
  try {
    const field = resolveFieldPath(extraction.record, sourceFieldPath);
    return { value: field.value, locator: sanitizeLocator(primaryLocator(field, extraction.fileKey)) };
  } catch {
    return undefined;
  }
}

/** Removes from a provenance row what its extraction already holds (value of an accepted field, locator
 * details and quote), keeping `kind` and anything that differs. `hydrateProvenance` restores the full row. */
export function slimProvenance<T extends { value?: unknown; decision?: string; locator?: any; sourceFieldPath?: string }>(row: T, extraction: any): T {
  const derived = derivedProvenance(extraction, row.sourceFieldPath);
  if (!derived) return row;
  const next: any = { ...row };
  if (row.decision !== "edit" && row.value !== undefined && sameJson(row.value, derived.value)) delete next.value;
  const locator: Record<string, unknown> = { kind: String(row.locator?.kind ?? derived.locator.kind ?? "block") };
  for (const [key, value] of Object.entries(row.locator ?? {})) if (key !== "kind" && !sameJson(value, derived.locator[key])) locator[key] = value;
  next.locator = locator;
  return next;
}

/** One fieldProvenance row for a promoted field; values and locators the extraction holds are referenced, not copied. */
export function provenanceRow(input: { societyId: string; targetTable: string; targetId: string; fieldPath: string; sourceFieldPath?: string; extraction: any; locator: any; value: unknown; decision: string; at: string }) {
  const row = compact({
    societyId: input.societyId, targetTable: input.targetTable, targetId: input.targetId, fieldPath: input.fieldPath.slice(0, 300), sourceFieldPath: input.sourceFieldPath?.slice(0, 300),
    runId: input.extraction.runId, extractionId: input.extraction._id, fileKey: input.extraction.fileKey, locator: sanitizeLocator(input.locator), value: input.value, decision: input.decision, createdAtISO: input.at,
  });
  return compact(slimProvenance(row, input.extraction) as any);
}

/** Restores the value and locator of provenance rows that reference their extraction (see `slimProvenance`). */
export async function hydrateProvenance(ctx: PortableQueryCtx, rows: any[]): Promise<any[]> {
  const extractions = new Map<string, any>();
  const out: any[] = [];
  for (const row of rows) {
    if (!row.extractionId || !row.sourceFieldPath) { out.push(row); continue; }
    const key = String(row.extractionId);
    if (!extractions.has(key)) extractions.set(key, (await ctx.db.get<any>(row.extractionId, "intakeExtractions").catch(() => null)) ?? null);
    const derived = derivedProvenance(extractions.get(key), row.sourceFieldPath);
    if (!derived) { out.push(row); continue; }
    out.push({ ...row, value: row.value !== undefined || row.decision === "edit" ? row.value : derived.value, locator: { ...derived.locator, ...(row.locator ?? {}) } });
  }
  return out;
}

