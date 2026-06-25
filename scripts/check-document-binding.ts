import assert from "node:assert/strict";

import { buildRenderContext } from "../shared/renderContext";
import { renderTemplate } from "../shared/templateAssembly";
import type { RenderContextOrg } from "../shared/renderContext";

/**
 * Wave 2 integration proof: shared/renderContext.ts + shared/templateAssembly.ts
 * compose to bind live grammar (from shared/nlg.ts) into legal-document prose,
 * so one template renders correct language for any board composition.
 *
 * This is the data-binding layer the YCN engine had in cell formulas
 * (CONCATENATE + IF over grammar tokens); here it is pure, typed TS that the
 * existing document-generation pipeline (convex/legalOperations.ts,
 * shared/corporationPacketDocx.ts) can adopt for any packet section body.
 */

const society: RenderContextOrg = {
  entityType: "society",
  actFormedUnder: "societies_act",
  legalName: "Riverbend Community Society",
  shortName: "Riverbend",
  jurisdictionCode: "CA-BC",
};

// A grammar-aware version of a corporationDocumentPackets-style resolution line.
const ADOPTION_CLAUSE =
  "The undersigned being {#if dir.isSole}the sole director{/if}" +
  "{#if dir.isMultiple}all the directors{/if} of {org.shortName} hereby " +
  "adopt{dir.verbS} the foregoing resolution pursuant to the {org.legislation}.";

const APPOINTMENT_CLAUSE =
  "The following person{dir.plural} {dir.isAre} appointed as " +
  "{#if dir.isSole}the sole director{/if}{#if dir.isMultiple}directors{/if} " +
  "of {org.shortName}:\n{#each dir.list}  - {this.name}\n{/each}";

// --- Sole director ------------------------------------------------------------
const soleCtx = buildRenderContext({
  org: society,
  directors: [{ name: "Avery Chen", gender: "F" }],
  asOf: "2026-01-15",
});

const soleAdoption = renderTemplate(ADOPTION_CLAUSE, soleCtx as unknown as Record<string, unknown>);
assert.equal(
  soleAdoption,
  "The undersigned being the sole director of Riverbend hereby adopts the foregoing resolution pursuant to the Societies Act.",
);

const soleAppt = renderTemplate(APPOINTMENT_CLAUSE, soleCtx as unknown as Record<string, unknown>);
assert.ok(soleAppt.includes("The following person is appointed as the sole director of Riverbend:"));
assert.ok(soleAppt.includes("  - Avery Chen"));

// --- Multiple directors -------------------------------------------------------
const multiCtx = buildRenderContext({
  org: society,
  directors: [
    { name: "Avery Chen", gender: "F" },
    { name: "Morgan Patel", gender: "M" },
    { name: "Bluewater Holdings Ltd." }, // org-named → neutral, but group already plural
  ],
  asOf: "2026-01-15",
});

const multiAdoption = renderTemplate(ADOPTION_CLAUSE, multiCtx as unknown as Record<string, unknown>);
assert.equal(
  multiAdoption,
  "The undersigned being all the directors of Riverbend hereby adopt the foregoing resolution pursuant to the Societies Act.",
);

const multiAppt = renderTemplate(APPOINTMENT_CLAUSE, multiCtx as unknown as Record<string, unknown>);
assert.ok(multiAppt.includes("The following persons are appointed as directors of Riverbend:"));
assert.ok(multiAppt.includes("  - Avery Chen"));
assert.ok(multiAppt.includes("  - Morgan Patel"));
assert.ok(multiAppt.includes("  - Bluewater Holdings Ltd."));

// --- Corporation legislation mapping flows through ---------------------------
const corp: RenderContextOrg = {
  entityType: "corporation__business_",
  actFormedUnder: "canada_business_corporations_act",
  legalName: "Northstar Manufacturing Inc.",
  shortName: "Northstar",
  jurisdictionCode: "CA-FED-CBCA",
};
const corpCtx = buildRenderContext({ org: corp, directors: [{ name: "Sam Lee", gender: "M" }], asOf: "2026-03-01" });
const corpAdoption = renderTemplate(ADOPTION_CLAUSE, corpCtx as unknown as Record<string, unknown>);
assert.ok(corpAdoption.includes("pursuant to the Canada Business Corporations Act."));
assert.ok(corpAdoption.includes("hereby adopts")); // single director → singular verb

console.log("OK document-binding");
