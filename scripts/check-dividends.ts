import assert from "node:assert/strict";
import {
  computeDividend,
  validateDividend,
  totalDeclaredByClass,
  totalDeclaredByCurrency,
  dividendsInPeriod,
  type DividendDeclaration,
} from "../shared/dividends";

// computeDividend: 250 cents x 1000 shares = 250000 cents.
{
  const decl: DividendDeclaration = {
    declaredOn: "2026-01-15",
    shareClass: "Class A",
    perShareCents: 250,
    sharesOutstanding: 1000,
    currency: "USD",
  };
  const computed = computeDividend(decl);
  assert.equal(computed.totalCents, 250000);
  // spread carries through the original fields
  assert.equal(computed.shareClass, "Class A");
  assert.equal(computed.currency, "USD");
}

// computeDividend: zero edge cases stay integer.
{
  assert.equal(
    computeDividend({
      declaredOn: "2026-02-01",
      shareClass: "Class B",
      perShareCents: 0,
      sharesOutstanding: 5000,
      currency: "USD",
    }).totalCents,
    0,
  );
}

// validateDividend: a fully valid declaration passes.
{
  const res = validateDividend({
    declaredOn: "2026-03-31",
    shareClass: "Class A",
    perShareCents: 125,
    sharesOutstanding: 200,
    currency: "CAD",
  });
  assert.equal(res.ok, true);
  assert.deepEqual(res.errors, []);
}

// validateDividend: missing shareClass.
{
  const res = validateDividend({
    declaredOn: "2026-03-31",
    shareClass: "",
    perShareCents: 125,
    sharesOutstanding: 200,
    currency: "CAD",
  });
  assert.equal(res.ok, false);
  assert.ok(res.errors.some((e) => e.includes("shareClass")));
}

// validateDividend: missing currency.
{
  const res = validateDividend({
    declaredOn: "2026-03-31",
    shareClass: "Class A",
    perShareCents: 125,
    sharesOutstanding: 200,
    currency: "",
  });
  assert.equal(res.ok, false);
  assert.ok(res.errors.some((e) => e.includes("currency")));
}

// validateDividend: negative perShareCents.
{
  const res = validateDividend({
    declaredOn: "2026-03-31",
    shareClass: "Class A",
    perShareCents: -1,
    sharesOutstanding: 200,
    currency: "CAD",
  });
  assert.equal(res.ok, false);
  assert.ok(res.errors.some((e) => e.includes("perShareCents")));
}

// validateDividend: negative sharesOutstanding.
{
  const res = validateDividend({
    declaredOn: "2026-03-31",
    shareClass: "Class A",
    perShareCents: 100,
    sharesOutstanding: -5,
    currency: "CAD",
  });
  assert.equal(res.ok, false);
  assert.ok(res.errors.some((e) => e.includes("sharesOutstanding")));
}

// validateDividend: non-integer cents and shares.
{
  const res = validateDividend({
    declaredOn: "2026-03-31",
    shareClass: "Class A",
    perShareCents: 12.5,
    sharesOutstanding: 10.1,
    currency: "CAD",
  });
  assert.equal(res.ok, false);
  assert.ok(res.errors.some((e) => e.includes("perShareCents") && e.includes("integer")));
  assert.ok(res.errors.some((e) => e.includes("sharesOutstanding") && e.includes("integer")));
}

// validateDividend: bad declaredOn.
{
  const res = validateDividend({
    declaredOn: "not-a-date",
    shareClass: "Class A",
    perShareCents: 100,
    sharesOutstanding: 10,
    currency: "CAD",
  });
  assert.equal(res.ok, false);
  assert.ok(res.errors.some((e) => e.includes("declaredOn")));
}

// Aggregation across mixed declarations.
{
  const decls: DividendDeclaration[] = [
    { declaredOn: "2026-01-01", shareClass: "Class A", perShareCents: 250, sharesOutstanding: 1000, currency: "USD" }, // 250000
    { declaredOn: "2026-02-01", shareClass: "Class A", perShareCents: 100, sharesOutstanding: 500, currency: "CAD" },  // 50000
    { declaredOn: "2026-03-01", shareClass: "Class B", perShareCents: 50, sharesOutstanding: 2000, currency: "USD" },  // 100000
  ];

  const byClass = totalDeclaredByClass(decls);
  assert.deepEqual(byClass, { "Class A": 300000, "Class B": 100000 });

  const byCurrency = totalDeclaredByCurrency(decls);
  assert.deepEqual(byCurrency, { USD: 350000, CAD: 50000 });
}

// Period filter, inclusive of boundaries.
{
  const decls: DividendDeclaration[] = [
    { declaredOn: "2025-12-31", shareClass: "Class A", perShareCents: 1, sharesOutstanding: 1, currency: "USD" },
    { declaredOn: "2026-01-01", shareClass: "Class A", perShareCents: 1, sharesOutstanding: 1, currency: "USD" }, // from boundary
    { declaredOn: "2026-06-15", shareClass: "Class A", perShareCents: 1, sharesOutstanding: 1, currency: "USD" },
    { declaredOn: "2026-12-31", shareClass: "Class A", perShareCents: 1, sharesOutstanding: 1, currency: "USD" }, // to boundary
    { declaredOn: "2027-01-01", shareClass: "Class A", perShareCents: 1, sharesOutstanding: 1, currency: "USD" },
  ];

  const inPeriod = dividendsInPeriod(decls, "2026-01-01", "2026-12-31");
  assert.equal(inPeriod.length, 3);
  assert.deepEqual(
    inPeriod.map((d) => d.declaredOn),
    ["2026-01-01", "2026-06-15", "2026-12-31"],
  );
}

console.log("OK dividends");
