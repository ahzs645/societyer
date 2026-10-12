import assert from "node:assert/strict";

import { buildDividendResolutionContext } from "../shared/dividendResolution";
import { buildSocietyRenderContext } from "../shared/societyRenderContext";
import { renderTemplate } from "../shared/templateAssembly";
import { instrumentPlainLines, renderInstrument } from "../shared/packetInstrument";
import { corporateLawContext, dividendDeclarationView } from "../shared/packetOperativeData";
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

// --- the packet instrument renders the declarations of the date ----------------
const dividend = CORPORATION_DOCUMENT_PACKETS.find((p) => p.key === "dividend-declaration");
assert.ok(dividend?.instrument, "dividend-declaration packet present with an instrument");

const society = { name: "Acme Inc.", entityType: "corporation__business_", actFormedUnder: "business_corporations_act", jurisdictionCode: "CA-BC", shortName: "Acme" };
const base = buildSocietyRenderContext(society, [{ roleType: "director", fullName: "Dana Wells", endDate: null }], "2026-06-25");
const law = Object.fromEntries(Object.entries(corporateLawContext(society, base.org.legislation)).map(([k, v]) => [k, typeof v === "string" ? renderTemplate(v, base as unknown as Record<string, unknown>) : v]));
const rows = [
  { declaredOn: "2026-06-25", shareClass: "Class A", perShareCents: 50, sharesOutstanding: 100, totalCents: 5000, currency: "C$", recordDate: "2026-06-30", paymentDate: "2026-07-15" },
  { declaredOn: "2026-06-25", shareClass: "Class B", perShareCents: 125, sharesOutstanding: 40, totalCents: 5000, currency: "US$", recordDate: "2026-06-30", paymentDate: "2026-07-31" },
  { declaredOn: "2025-01-01", shareClass: "Class A", perShareCents: 999, totalCents: 99900, currency: "C$" },
];
const render = (view: Record<string, unknown>) => instrumentPlainLines(renderInstrument(dividend!.instrument!, { ...base, law, ...view } as unknown as Record<string, unknown>).blocks).join("\n");
const withRows = render(dividendDeclarationView(rows, { asOf: "2026-06-25" }));
assert.ok(withRows.includes("Acme declare the following dividends on its issued and outstanding shares of the classes indicated"), withRows);
assert.ok(withRows.includes("C$0.50 per share on the Class A Shares, for a total of C$50.00, payable on July 15, 2026 to holders of record of Class A Shares on June 30, 2026"), "Class A row");
assert.ok(withRows.includes("US$1.25 per share on the Class B Shares, for a total of US$50.00, payable on July 31, 2026 to holders of record of Class B Shares on June 30, 2026"), "Class B row");
assert.ok(withRows.includes("section 70(2) of the Business Corporations Act (British Columbia)"), "solvency recital kept");
assert.ok(!withRows.includes("9.99"), "the earlier declaration is not the dividend of this date");
assert.ok(!withRows.includes("{"), "no raw tokens remain");

// --- empty declaration → graceful fallback prompt ----------------------------
const noRows = render(dividendDeclarationView([], { asOf: "2026-06-25" }));
assert.ok(noRows.includes("No dividend declaration is recorded on June 25, 2026"), "fallback prompt when no declarations");
assert.ok(noRows.includes("[payment date]"));

console.log("OK dividend-resolution");
