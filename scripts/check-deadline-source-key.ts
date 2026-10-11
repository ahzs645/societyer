import assert from "node:assert/strict";

import { StaticConvexClient } from "../src/lib/staticConvex";
import { complianceDeadlineAlreadyTracked, complianceDeadlineSourceKey } from "../shared/corporationSettings";

/**
 * Generated compliance deadlines store their stable identity, so "Add
 * deadlines" recognises them again after titles or due dates change, and
 * agreement keys cannot be forged through the generic create mutation.
 */
const SRC = "soc-key";
const client = new StaticConvexClient({
  databaseName: `societyer-deadline-key-${Date.now()}`,
  seed: { societies: [{ _id: SRC, name: "Key Society", entityType: "society", jurisdictionCode: "CA-BC" }] } as never,
});

const derived = { key: "annual-report", cycleYear: 2026, dueDate: "2027-01-31" } as const;
const sourceKey = complianceDeadlineSourceKey(derived as never);
assert.equal(sourceKey, "compliance:annual-report:2026");

await client.mutation("deadlines:create", { societyId: SRC, title: "Annual report", dueDate: derived.dueDate, category: "Governance", sourceKey });
await assert.rejects(
  () => client.mutation("deadlines:create", { societyId: SRC, title: "Forged", dueDate: "2027-01-31", category: "Governance", sourceKey: "agreement:x:renewal" }),
  /Unsupported deadline source key/,
);

const rows = (client as unknown as { exportLocalWorkspaceSnapshot(): { tables: Record<string, any[]> } })
  .exportLocalWorkspaceSnapshot().tables.deadlines ?? [];
assert.equal(rows.length, 1, "only the valid deadline was stored");
assert.equal(rows[0].sourceKey, sourceKey, "the source key is stored");
// A later regeneration with a different title and due date still matches by key.
assert.ok(complianceDeadlineAlreadyTracked({ ...derived, title: "Annual report (Societies Act)", dueDate: "2027-02-01" } as never,
  [{ title: "Something renamed", dueDate: "2027-01-31", category: "Governance", sourceKey }], { jurisdictionCode: "CA-BC", entityType: "society" } as never));
console.log("Deadline source key passed: generated deadlines store a validated compliance key and are recognised after renames.");
