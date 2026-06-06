import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  jurisdictionGuidePackSchema,
  jurisdictionGuidePacksSchema,
} from "../src/lib/jurisdictionGuideSchema";
import { JURISDICTION_GUIDE_PACK_JSON } from "../src/lib/jurisdictionGuidePackRegistry";

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
      rule.validity.effectiveFrom.length,
      10,
      `${rule.ruleId}: effectiveFrom must be YYYY-MM-DD`,
    );
    if (rule.validity.effectiveTo) {
      assert.equal(
        rule.validity.effectiveTo.length,
        10,
        `${rule.ruleId}: effectiveTo must be YYYY-MM-DD`,
      );
    }
  }
}

const parameterKeys = new Set(
  packs.flatMap((pack) =>
    pack.rules.flatMap((rule) => (rule.parameters ?? []).map((parameter) => parameter.key)),
  ),
);
for (const requiredParameter of [
  "shareholder_vote.special_resolution.min_fraction",
  "general_meeting_notice.min_days",
  "directors_quorum.default_formula",
]) {
  assert.ok(parameterKeys.has(requiredParameter), `Missing expected parameter ${requiredParameter}`);
}

console.log(`Validated ${packs.length} jurisdiction guide pack${packs.length === 1 ? "" : "s"}.`);
