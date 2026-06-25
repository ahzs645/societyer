import assert from "node:assert/strict";

import { buildAnnualResolutionContext } from "../shared/annualResolution";
import { buildSocietyRenderContext } from "../shared/societyRenderContext";
import { renderSections } from "../shared/packetRendering";
import { CORPORATION_DOCUMENT_PACKETS } from "../shared/corporationDocumentPackets";

/**
 * #3 Annual consent resolution body. The packet now renders the six real YCN
 * operative clauses (FS approve/waive, fix next FYE, auditor appoint/waive,
 * ratify acts, appoint director slate, deemed-AGM date) bound to the society's
 * settings + directors via the template engine.
 */

// --- the derived context ------------------------------------------------------
const ctxWaived = buildAnnualResolutionContext({
  waivePrepFinancials: true,
  fiscalYearEnd: "December 31",
  directors: [{ name: "Dana Wells" }, { name: "Sam Okoro" }],
});
assert.equal(ctxWaived.waivePrepFinancials, true);
assert.equal(ctxWaived.hasFiscalYearEnd, true);
assert.equal(ctxWaived.directorSlate, "Dana Wells; Sam Okoro");
assert.equal(ctxWaived.hasDirectors, true);

const ctxEmpty = buildAnnualResolutionContext({});
assert.equal(ctxEmpty.waivePrepFinancials, false);
assert.equal(ctxEmpty.hasFiscalYearEnd, false);
assert.equal(ctxEmpty.hasDirectors, false);

// --- the packet body binds the clauses ---------------------------------------
const annual = CORPORATION_DOCUMENT_PACKETS.find((p) => p.key === "annual-resolutions");
assert.ok(annual, "annual-resolutions packet present");

function renderAnnual(opts: { waive: boolean }): string {
  const society = { name: "Acme Inc.", entityType: "corporation__business_", actFormedUnder: "business_corporations_act", shortName: "Acme", waivePrepFinancials: opts.waive, fiscalYearEnd: "December 31" };
  const roleHolders = [
    { roleType: "director", fullName: "Dana Wells", endDate: null },
    { roleType: "director", fullName: "Sam Okoro", endDate: null },
  ];
  const base = buildSocietyRenderContext(society, roleHolders, "2026-06-25");
  const context = {
    ...base,
    annual: buildAnnualResolutionContext({ waivePrepFinancials: opts.waive, fiscalYearEnd: "December 31", directors: base.dir.list }),
  } as unknown as Record<string, unknown>;
  return renderSections(annual!.sections, context)
    .flatMap((s) => s.body)
    .join("\n");
}

const approved = renderAnnual({ waive: false });
assert.ok(approved.includes("financial statements of Acme"), "FS approval clause");
assert.ok(approved.includes("are authorized to appoint an auditor of Acme"), "auditor appointment clause");
assert.ok(approved.includes("next financial year end of Acme is fixed at December 31"), "fix FYE clause");
assert.ok(approved.includes("are appointed as directors of Acme until their successors"), "director slate plural");
assert.ok(approved.includes("Dana Wells; Sam Okoro"), "director slate names");
assert.ok(approved.includes("deemed to have been held on June 25, 2026"), "deemed-AGM clause with long date");
assert.ok(!approved.includes("{"), "no raw tokens remain");

const waived = renderAnnual({ waive: true });
assert.ok(waived.includes("requirement to produce and publish financial statements"), "FS waiver branch");
assert.ok(waived.includes("appointment of an auditor of Acme for the current financial year is waived"), "auditor waiver branch");

console.log("OK annual-resolution");
