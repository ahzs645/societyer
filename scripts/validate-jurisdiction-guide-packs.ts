import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  jurisdictionGuidePackSchema,
  jurisdictionGuidePacksSchema,
} from "../src/lib/jurisdictionGuideSchema";
import { JURISDICTION_GUIDE_PACK_JSON } from "../src/lib/jurisdictionGuidePackRegistry";
import { legalSourceById } from "../shared/legalSources";

const packsDir = join(process.cwd(), "src/lib/jurisdictionGuidePacks");
const files = readdirSync(packsDir).filter((file) => file.endsWith(".json")).sort();
assert.ok(files.length > 0, "At least one jurisdiction guide pack is required.");

const packs = files.map((file) => {
  const fullPath = join(packsDir, file);
  const raw = JSON.parse(readFileSync(fullPath, "utf8"));
  const pack = jurisdictionGuidePackSchema.parse(raw);
  return pack;
});

jurisdictionGuidePacksSchema.parse(packs);

const registeredPacks = JURISDICTION_GUIDE_PACK_JSON.map((raw) => jurisdictionGuidePackSchema.parse(raw));
assert.deepEqual(
  registeredPacks.map((pack) => pack.packId).sort(),
  packs.map((pack) => pack.packId).sort(),
  "Every jurisdiction guide JSON file must be registered in jurisdictionGuidePackRegistry.ts",
);

for (const pack of packs) {
  const sourceIds = new Set(pack.sources.map((source) => source.sourceId));
  for (const rule of pack.rules) {
    assert.ok(
      sourceIds.has(rule.authority.sourceId),
      `${rule.ruleId}: authority.sourceId must refer to a source in ${pack.packId}`,
    );
    assert.equal(
      (rule.validity.effectiveFrom ?? rule.validity.currentAsOf)?.length,
      10,
      `${rule.ruleId}: commencement or current snapshot date must be YYYY-MM-DD`,
    );
    if (rule.validity.effectiveTo) {
      assert.equal(
        rule.validity.effectiveTo.length,
        10,
        `${rule.ruleId}: effectiveTo must be YYYY-MM-DD`,
      );
    }
    for (const sourceId of rule.authority.registrySourceIds ?? []) {
      const source = legalSourceById.get(sourceId);
      assert.ok(source, `${rule.ruleId}: unknown shared legal source ${sourceId}`);
      assert.notEqual(source.status, "proposed", `${rule.ruleId}: proposals cannot supply operative guide rules`);
      assert.ok(rule.validity.currentAsOf, `${rule.ruleId}: current registry sources must not fabricate historical commencement`);
    }
  }
}

// Operative calculations come from reviewed profiles. Guide snapshots reference
// those same sources rather than maintaining a second set of numeric defaults.
const referencedSources = new Set(packs.flatMap((pack) => pack.rules.flatMap((rule) => rule.authority.registrySourceIds ?? [])));
for (const sourceId of ["CBCA-RESOLUTIONS", "OBCA-RESOLUTIONS", "BC-BCA-RESOLUTIONS", "BC-SOC-MEETING-NOTICE"]) {
  assert.ok(referencedSources.has(sourceId), `Missing expected shared source ${sourceId}`);
}
const invalidBothDates = structuredClone(packs[0]);
invalidBothDates.rules[0].validity = { effectiveFrom: "2026-10-11", currentAsOf: "2026-10-11" };
assert.equal(jurisdictionGuidePackSchema.safeParse(invalidBothDates).success, false, "a review date is not a second commencement date");

console.log(`Validated ${packs.length} jurisdiction guide pack${packs.length === 1 ? "" : "s"}.`);
