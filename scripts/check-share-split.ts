import assert from "node:assert/strict";
import {
  applyRatio,
  applyRatioToHoldings,
  describeRatio,
  validateRatio,
  type SplitRatio,
} from "../shared/shareSplit";

// applyRatio: 2-for-1 split doubles shares.
{
  assert.equal(applyRatio(100, { numerator: 2, denominator: 1 }), 200);
}

// applyRatio: 1-for-3 consolidation thirds shares.
{
  assert.equal(applyRatio(300, { numerator: 1, denominator: 3 }), 100);
}

// applyRatio: floor on uneven consolidation. 101 / 3 = 33.66 -> 33.
{
  assert.equal(applyRatio(101, { numerator: 1, denominator: 3 }), 33);
}

// applyRatio: no-op ratio leaves shares unchanged.
{
  assert.equal(applyRatio(57, { numerator: 1, denominator: 1 }), 57);
}

// applyRatioToHoldings: maps each holder to new counts, preserving names.
{
  const ratio: SplitRatio = { numerator: 2, denominator: 1 };
  const out = applyRatioToHoldings(
    [
      { holderName: "Alice", shares: 100 },
      { holderName: "Bob", shares: 101 },
    ],
    ratio,
  );
  assert.deepEqual(out, [
    { holderName: "Alice", shares: 200 },
    { holderName: "Bob", shares: 202 },
  ]);
}

// applyRatioToHoldings: consolidation floors per-holder.
{
  const out = applyRatioToHoldings(
    [
      { holderName: "Alice", shares: 101 },
      { holderName: "Bob", shares: 300 },
    ],
    { numerator: 1, denominator: 3 },
  );
  assert.deepEqual(out, [
    { holderName: "Alice", shares: 33 },
    { holderName: "Bob", shares: 100 },
  ]);
}

// describeRatio: subdivision, consolidation, no change.
{
  assert.equal(describeRatio({ numerator: 2, denominator: 1 }), "2-for-1 subdivision");
  assert.equal(describeRatio({ numerator: 1, denominator: 3 }), "1-for-3 consolidation");
  assert.equal(describeRatio({ numerator: 1, denominator: 1 }), "no change");
}

// validateRatio: valid split passes.
{
  const result = validateRatio({ numerator: 2, denominator: 1 });
  assert.equal(result.ok, true);
  assert.deepEqual(result.errors, []);
}

// validateRatio: zero denominator fails.
{
  const result = validateRatio({ numerator: 2, denominator: 0 });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes("denominator")));
}

// validateRatio: negative numerator fails.
{
  const result = validateRatio({ numerator: -2, denominator: 1 });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes("numerator")));
}

// validateRatio: non-integer fails.
{
  const result = validateRatio({ numerator: 1.5, denominator: 2 });
  assert.equal(result.ok, false);
}

// validateRatio: 1/1 rejected by default, allowed when opted in.
{
  assert.equal(validateRatio({ numerator: 1, denominator: 1 }).ok, false);
  assert.equal(validateRatio({ numerator: 1, denominator: 1 }, { allowOneToOne: true }).ok, true);
}

console.log("OK share-split");
