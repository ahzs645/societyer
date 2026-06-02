import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";

import {
  jurisdictionGuidePackSchema,
  jurisdictionGuidePacksSchema,
} from "../src/lib/jurisdictionGuideSchema";

const packsDir = join(process.cwd(), "src/lib/jurisdictionGuidePacks");
const files = readdirSync(packsDir).filter((file) => file.endsWith(".json")).sort();
assert.ok(files.length > 0, "At least one jurisdiction guide pack is required.");

const packs = files.map((file) => {
  const fullPath = join(packsDir, file);
  const raw = JSON.parse(readFileSync(fullPath, "utf8"));
  const pack = jurisdictionGuidePackSchema.parse(raw);
  const expectedFilename = `${pack.jurisdiction.code.toLowerCase()}.json`;
  assert.equal(
    basename(file),
    expectedFilename,
    `${file}: filename must match jurisdiction code (${expectedFilename})`,
  );
  return pack;
});

jurisdictionGuidePacksSchema.parse(packs);

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

console.log(`Validated ${packs.length} jurisdiction guide pack${packs.length === 1 ? "" : "s"}.`);
