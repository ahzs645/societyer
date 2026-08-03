import { transactionBackfillSides, validateBalancedJournalLines } from "../convex/lib/accountingCore";
import { StaticConvexClient } from "../src/lib/staticConvex";

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

async function expectRejects(label: string, fn: () => Promise<unknown>) {
  try {
    await fn();
  } catch {
    return;
  }
  throw new Error(`${label} should have rejected.`);
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

const societyId = "accounting-idempotency-society";
const actorId = "accounting-idempotency-actor";
const cashAccountId = "accounting-idempotency-cash";
const offsetAccountId = "accounting-idempotency-offset";
const candidateId = "accounting-idempotency-candidate";
const allocationCandidateId = "accounting-idempotency-allocation-candidate";
const client = new StaticConvexClient({
  databaseName: `societyer-static-accounting-${Date.now()}`,
  seed: {
    societies: [{ _id: societyId, name: "Accounting idempotency test" }],
    users: [{ _id: actorId, societyId, role: "Admin", status: "Active" }],
    financialAccounts: [
      { _id: cashAccountId, societyId, name: "Cash" },
      { _id: offsetAccountId, societyId, name: "Revenue" },
    ],
    transactionCandidates: [
      {
        _id: candidateId,
        societyId,
        transactionDate: "2026-01-10",
        description: "Membership income",
        amountCents: 2500,
        status: "NeedsReview",
      },
      {
        _id: allocationCandidateId,
        societyId,
        transactionDate: "2026-01-11",
        description: "Allocated income",
        amountCents: 2500,
        status: "NeedsReview",
      },
    ],
  },
});

await client.mutation("accounting:postTransactionCandidate", {
  transactionCandidateId: candidateId,
  cashAccountId,
  offsetAccountId,
  actingUserId: actorId,
});
await expectRejects("duplicate simple candidate post", () =>
  client.mutation("accounting:postTransactionCandidate", {
    transactionCandidateId: candidateId,
    cashAccountId,
    offsetAccountId,
    actingUserId: actorId,
  }),
);

await client.mutation("accounting:postTransactionCandidateAllocation", {
  transactionCandidateId: allocationCandidateId,
  cashAccountId,
  allocations: [{ accountId: offsetAccountId, amountCents: 2500 }],
  actingUserId: actorId,
});
await expectRejects("duplicate allocated candidate post", () =>
  client.mutation("accounting:postTransactionCandidateAllocation", {
    transactionCandidateId: allocationCandidateId,
    cashAccountId,
    allocations: [{ accountId: offsetAccountId, amountCents: 2500 }],
    actingUserId: actorId,
  }),
);

console.log("Accounting core checks passed.");
