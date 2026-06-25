import assert from "node:assert/strict";

import { buildDividendResolutionContext } from "../shared/dividendResolution";
import { buildSocietyRenderContext } from "../shared/societyRenderContext";
import { renderSections } from "../shared/packetRendering";
import { CORPORATION_DOCUMENT_PACKETS } from "../shared/corporationDocumentPackets";

/**
 * #3 Dividend declaration body. The packet renders a multi-class declaration
 * table (Class / per share / total) with the stored currency symbol — the YCN
 * Doc - Dividends structure — instead of a single-class prose stub.
 */

// --- the derived context: currency-formatted multi-class table ---------------
const ctx = buildDividendResolutionContext(
  [
    { shareClass: "Class A", perShareCents: 50, sharesOutstanding: 100, totalCents: 5000, currency: "C$" },
    { shareClass: "Class B", perShareCents: 125, sharesOutstanding: 40, totalCents: 5000, currency: "US$" },
  ],
  { declaredDate: "2026-06-25" },
);
assert.equal(ctx.hasDeclarations, true);
assert.equal(ctx.declarations.length, 2);
assert.equal(ctx.declarations[0].perShare, "C$0.50");
assert.equal(ctx.declarations[0].total, "C$50.00");
assert.equal(ctx.declarations[1].perShare, "US$1.25");
assert.equal(ctx.hasDeclaredDate, true);

const empty = buildDividendResolutionContext([]);
assert.equal(empty.hasDeclarations, false);
assert.equal(empty.hasDeclaredDate, false);

// --- the packet body renders the multi-class table ---------------------------
const dividend = CORPORATION_DOCUMENT_PACKETS.find((p) => p.key === "dividend-declaration");
assert.ok(dividend, "dividend-declaration packet present");

const society = { name: "Acme Inc.", entityType: "corporation__business_", actFormedUnder: "business_corporations_act", shortName: "Acme" };
const base = buildSocietyRenderContext(society, [{ roleType: "director", fullName: "Dana Wells", endDate: null }], "2026-06-25");

const withRows = renderSections(dividend!.sections, { ...base, dividend: ctx } as unknown as Record<string, unknown>)
  .flatMap((s) => s.body)
  .join("\n");
assert.ok(withRows.includes("pay dividends on the issued and outstanding shares"), "declaration sentence");
assert.ok(withRows.includes("as declared on 2026-06-25"), "declared date bound");
assert.ok(withRows.includes("Class Class A: C$0.50 per share — total C$50.00."), "Class A row");
assert.ok(withRows.includes("Class Class B: US$1.25 per share — total US$50.00."), "Class B row");
assert.ok(!withRows.includes("{"), "no raw tokens remain");

// --- empty declaration → graceful fallback prompt ----------------------------
const noRows = renderSections(dividend!.sections, { ...base, dividend: empty } as unknown as Record<string, unknown>)
  .flatMap((s) => s.body)
  .join("\n");
assert.ok(noRows.includes("Complete the dividend schedule"), "fallback prompt when no declarations");

console.log("OK dividend-resolution");
