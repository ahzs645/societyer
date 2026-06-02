import { transactionBackfillSides, validateBalancedJournalLines } from "../convex/lib/accountingCore";

function expectThrows(label: string, fn: () => unknown) {
  try {
    fn();
  } catch {
    return;
  }
  throw new Error(`${label} should have thrown.`);
}

function expectEqual(label: string, actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label} mismatch: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}.`);
  }
}

validateBalancedJournalLines([
  { amountCents: 12500, side: "debit" },
  { amountCents: 12500, side: "credit" },
]);

expectThrows("unbalanced journal", () => validateBalancedJournalLines([
  { amountCents: 12500, side: "debit" },
  { amountCents: 12000, side: "credit" },
]));

expectThrows("negative amount", () => validateBalancedJournalLines([
  { amountCents: -100, side: "debit" },
  { amountCents: -100, side: "credit" },
]));

expectThrows("invalid side", () => validateBalancedJournalLines([
  { amountCents: 100, side: "left" },
  { amountCents: 100, side: "credit" },
]));

expectEqual("positive transaction backfill", transactionBackfillSides(5000), {
  cashSide: "debit",
  offsetSide: "credit",
  absoluteAmountCents: 5000,
  offsetKind: "income",
});

expectEqual("negative transaction backfill", transactionBackfillSides(-4200), {
  cashSide: "credit",
  offsetSide: "debit",
  absoluteAmountCents: 4200,
  offsetKind: "expense",
});

expectThrows("zero transaction", () => transactionBackfillSides(0));

console.log("Accounting core checks passed.");
