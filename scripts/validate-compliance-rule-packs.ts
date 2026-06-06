import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { JURISDICTION_GUIDE_PACK_JSON } from "../src/lib/jurisdictionGuidePackRegistry";
import { jurisdictionGuidePackSchema } from "../src/lib/jurisdictionGuideSchema";
import { COMPLIANCE_RULE_PACK_JSON } from "../src/lib/compliance/registry";
import { complianceRulePackSchema, complianceRulePacksSchema } from "../src/lib/compliance/rulePackSchema";

const packsDir = join(process.cwd(), "src/lib/compliance/rulePacks");
const files = readdirSync(packsDir).filter((file) => file.endsWith(".json")).sort();
assert.ok(files.length > 0, "At least one compliance rule pack is required.");

const packs = files.map((file) => {
  const fullPath = join(packsDir, file);
  return complianceRulePackSchema.parse(JSON.parse(readFileSync(fullPath, "utf8")));
});

complianceRulePacksSchema.parse(packs);

const registeredPacks = COMPLIANCE_RULE_PACK_JSON.map((raw) => complianceRulePackSchema.parse(raw));
assert.deepEqual(
  registeredPacks.map((pack) => pack.packId).sort(),
  packs.map((pack) => pack.packId).sort(),
  "Every compliance rule JSON file must be registered in compliance/registry.ts",
);

const guidePacksById = new Map(
  JURISDICTION_GUIDE_PACK_JSON.map((raw) => {
    const guidePack = jurisdictionGuidePackSchema.parse(raw);
    return [guidePack.packId, guidePack];
  }),
);

for (const pack of packs) {
  const guidePack = guidePacksById.get(pack.sourceGuidePackId);
  assert.ok(guidePack, `${pack.packId}: sourceGuidePackId must reference an existing jurisdiction guide pack`);
  assert.equal(pack.jurisdictionCode, guidePack.jurisdiction.code, `${pack.packId}: jurisdiction must match source guide pack`);

  const guideRuleIds = new Set(guidePack.rules.map((rule) => rule.ruleId));
  for (const rule of pack.rules) {
    assert.ok(rule.authority.guideRuleIds.length > 0, `${rule.ruleId}: guideRuleIds are required`);
    for (const guideRuleId of rule.authority.guideRuleIds) {
      assert.ok(
        guideRuleIds.has(guideRuleId),
        `${rule.ruleId}: guideRuleId ${guideRuleId} must exist in ${pack.sourceGuidePackId}`,
      );
    }
  }
}

console.log(`Validated ${packs.length} compliance rule pack${packs.length === 1 ? "" : "s"}.`);
