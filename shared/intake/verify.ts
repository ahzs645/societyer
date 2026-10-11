/** Stage 6: re-find every quoted locator span in the extract. A value whose
 * quote cannot be found is a hallucination candidate and is never bulk-accepted. */
import type { IntakeBlock } from "./blocks";
import type { FieldValue, Locator } from "./schemas/common";

export type VerifyStatus = NonNullable<FieldValue<unknown>["verification"]>;
export type VerifiableExtract = { blocks: IntakeBlock[]; text: string };

const RANK: Record<VerifyStatus, number> = { verified_span: 0, verified_fuzzy: 1, no_quote: 2, span_mismatch: 3, invalid: 4 };

/** Lowercased, whitespace-collapsed text with smart quotes/dashes/bullets unified,
 * plus an index map back to the original string. */
export function normalizeForMatch(value: string): { text: string; map: number[] } {
  let text = "";
  const map: number[] = [];
  let pendingSpace = false;
  for (let index = 0; index < value.length; index++) {
    let char = value[index];
    if (/[\s •●▪◦·]/.test(char)) {
      pendingSpace = text.length > 0;
      continue;
    }
    if (/[‘’‚′`]/.test(char)) char = "'";
    else if (/[“”„″]/.test(char)) char = '"';
    else if (/[–—―‐‑]/.test(char)) char = "-";
    if (pendingSpace) {
      text += " ";
      map.push(index);
      pendingSpace = false;
    }
    text += char.toLowerCase();
    map.push(index);
  }
  return { text, map };
}

function cellBounds(block: IntakeBlock, cell?: string): { start: number; end: number } | undefined {
  if (!cell || !block.rows) return undefined;
  for (const row of block.rows) for (const candidate of row.cells) {
    if (candidate.cell === cell && candidate.charStart !== undefined && candidate.charEnd !== undefined) return { start: candidate.charStart, end: candidate.charEnd };
  }
  return undefined;
}

/** Verifies one locator, correcting its offsets in place when the span is found. */
export function verifyLocator(extract: VerifiableExtract, locator: Locator): VerifyStatus {
  if (locator.kind === "filename" || locator.kind === "path") return locator.quote ? "verified_span" : "no_quote";
  const quote = locator.quote?.trim();
  if (!quote) {
    if (locator.charStart !== undefined && locator.charEnd !== undefined && locator.charEnd <= extract.text.length && locator.charStart < locator.charEnd) return "no_quote";
    return locator.blockIndex !== undefined && extract.blocks[locator.blockIndex] ? "no_quote" : "invalid";
  }
  const block = locator.blockIndex !== undefined ? extract.blocks[locator.blockIndex] : undefined;
  if (locator.blockIndex !== undefined && !block) return "invalid";
  const scopes: Array<{ start: number; end: number }> = [];
  if (block) {
    const cell = cellBounds(block, locator.cell);
    if (cell) scopes.push(cell);
    scopes.push({ start: block.charStart, end: block.charEnd });
  }
  scopes.push({ start: 0, end: extract.text.length });
  for (const [scopeIndex, scope] of scopes.entries()) {
    const haystack = extract.text.slice(scope.start, scope.end);
    const exact = haystack.indexOf(quote);
    if (exact >= 0) {
      place(extract, locator, scope.start + exact, scope.start + exact + quote.length);
      return scopeIndex === scopes.length - 1 && block ? "verified_fuzzy" : "verified_span";
    }
    const normalizedHaystack = normalizeForMatch(haystack);
    const normalizedQuote = normalizeForMatch(quote).text;
    const fuzzy = normalizedQuote ? normalizedHaystack.text.indexOf(normalizedQuote) : -1;
    if (fuzzy >= 0) {
      const start = scope.start + normalizedHaystack.map[fuzzy];
      const end = scope.start + normalizedHaystack.map[fuzzy + normalizedQuote.length - 1] + 1;
      place(extract, locator, start, end);
      return "verified_fuzzy";
    }
  }
  return "span_mismatch";
}

function place(extract: VerifiableExtract, locator: Locator, start: number, end: number) {
  locator.charStart = start;
  locator.charEnd = end;
  const block = extract.blocks.find((candidate) => candidate.charStart <= start && end <= candidate.charEnd);
  if (block) {
    locator.blockIndex = block.index;
    if (block.page && !locator.page) locator.page = block.page;
    if (block.sheet && !locator.sheet) locator.sheet = block.sheet;
  }
}

export function isFieldValue(value: unknown): value is FieldValue<unknown> {
  return Boolean(value && typeof value === "object" && "status" in (value as any) && "locators" in (value as any) && Array.isArray((value as any).locators));
}

export type VerificationSummary = { fields: number; locators: number; quoted: number; verified: number; fuzzy: number; mismatched: number; invalid: number; mismatches: Array<{ path: string; quote?: string }> };

/** Walks a record, verifying every FieldValue's locators and stamping `verification`. */
export function verifyRecord(record: unknown, extract: VerifiableExtract): VerificationSummary {
  const summary: VerificationSummary = { fields: 0, locators: 0, quoted: 0, verified: 0, fuzzy: 0, mismatched: 0, invalid: 0, mismatches: [] };
  const visit = (node: unknown, path: string) => {
    if (Array.isArray(node)) {
      node.forEach((item, index) => visit(item, `${path}[${index}]`));
      return;
    }
    if (!node || typeof node !== "object") return;
    if (isFieldValue(node)) {
      summary.fields += 1;
      let worst: VerifyStatus | undefined;
      for (const locator of node.locators) {
        summary.locators += 1;
        const status = verifyLocator(extract, locator);
        if (locator.quote) summary.quoted += 1;
        if (status === "verified_span") summary.verified += 1;
        else if (status === "verified_fuzzy") summary.fuzzy += 1;
        else if (status === "span_mismatch") {
          summary.mismatched += 1;
          summary.mismatches.push({ path, quote: locator.quote });
        } else if (status === "invalid") summary.invalid += 1;
        if (!worst || RANK[status] > RANK[worst]) worst = status;
      }
      if (node.status === "stated" || node.status === "inferred") node.verification = worst ?? "no_quote";
      // Nested structured values (e.g. sub-objects) can hold more FieldValues.
      if (node.value && typeof node.value === "object") visit(node.value, `${path}.value`);
      return;
    }
    for (const [key, value] of Object.entries(node)) visit(value, path ? `${path}.${key}` : key);
  };
  visit(record, "");
  return summary;
}

export function hallucinationRate(summary: VerificationSummary): number {
  return summary.quoted ? (summary.mismatched + summary.invalid) / summary.quoted : 0;
}
