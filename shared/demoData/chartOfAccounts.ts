/**
 * Demo sub-accounts, so the chart of accounts and the statements show the
 * account hierarchy (shared/accountHierarchy.ts): venue rental and utilities
 * sit under "5200 Facilities and utilities".
 *
 * Shared by the in-browser demo (src/lib/staticConvexFixtures.ts) and the
 * server seed (shared/functions/seed.ts); callers supply the ids. They carry
 * no bank transactions, so every bank balance is unchanged.
 *
 * Pure TypeScript: no Convex, DOM or Node imports.
 */

export type DemoSubAccountKey = "venue" | "utilities";

export const DEMO_SUB_ACCOUNTS: Array<{ key: DemoSubAccountKey; externalId: string; code: string; name: string; subtype: string }> = [
  { key: "venue", externalId: "facilities-venue", code: "5210", name: "Hall and venue rental", subtype: "facilities" },
  { key: "utilities", externalId: "facilities-utilities", code: "5220", name: "Hydro and utilities", subtype: "facilities" },
];

/** Account rows (without `_id`) for the demo sub-accounts under the facilities expense account. */
export function demoSubAccountRows(refs: { societyId: string; connectionId: string; facilitiesAccountId: string }) {
  return DEMO_SUB_ACCOUNTS.map((row) => ({
    key: row.key,
    doc: {
      societyId: refs.societyId,
      connectionId: refs.connectionId,
      externalId: row.externalId,
      code: row.code,
      name: row.name,
      currency: "CAD",
      accountType: "Expense",
      subtype: row.subtype,
      balanceCents: 0,
      isRestricted: false,
      sourceSystem: "societyer",
      normalBalance: "debit",
      parentAccountId: refs.facilitiesAccountId,
    },
  }));
}
