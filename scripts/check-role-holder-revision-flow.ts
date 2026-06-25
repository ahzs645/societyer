// End-to-end edit-history flow through the static mirror (the same code path the
// app uses offline). Verifies that upsert/remove append revisions and that the
// roleHolderHistory queries reconstruct the timeline, as-of register, and diff.

import { StaticConvexClient } from "../src/lib/staticConvex";

function expectEqual(label: string, actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label} mismatch: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}.`);
  }
}

const client = new StaticConvexClient({
  databaseName: `societyer-static-rh-history-${Date.now()}`,
  seed: { societies: [] },
});

const created = await client.mutation("society:createWorkspace", {
  name: "History Test Society",
  entityType: "society",
});
const societyId = created.societyId;

// Create a director.
const id = await client.mutation("legalOperations:upsertRoleHolder", {
  societyId,
  roleType: "director",
  status: "current",
  fullName: "Jane Doe",
  actorUserId: "alice",
});

// No revisions yet — only the live (open) version.
let history = await client.query("roleHolderHistory:revisionHistory", { roleHolderId: id });
expectEqual("history length after create", history.length, 1);
expectEqual("create version is current", history[0].isCurrent, true);

// Edit: add an officer title + gender. This appends one closed revision.
await client.mutation("legalOperations:upsertRoleHolder", {
  id,
  societyId,
  roleType: "director",
  status: "current",
  fullName: "Jane Doe",
  officerTitle: "president",
  gender: "F",
  actorUserId: "bob",
});

history = await client.query("roleHolderHistory:revisionHistory", { roleHolderId: id });
expectEqual("history length after edit", history.length, 2);
expectEqual("prior version closed", history[0].isCurrent, false);
expectEqual("current version open", history[1].isCurrent, true);
expectEqual("current edited by", history[1].enteredByUserId, "bob");
const editedFields = new Set(history[1].changes.map((c: any) => c.field));
if (!editedFields.has("officerTitle") || !editedFields.has("gender")) {
  throw new Error(`expected officerTitle + gender changes, got ${[...editedFields].join(", ")}`);
}

// Remove: appends a final closed revision; live row is gone.
await client.mutation("legalOperations:removeRoleHolder", { id, actorUserId: "carol" });
history = await client.query("roleHolderHistory:revisionHistory", { roleHolderId: id });
expectEqual("history length after remove", history.length, 2, "two closed revisions, no live row");
expectEqual("no current version after remove", history.some((v: any) => v.isCurrent), false);

// changesBetween: from before any edits (epoch) to now — the holder was created
// then deleted, so net it is absent in both endpoints (no spurious row).
const diff = await client.query("roleHolderHistory:changesBetween", {
  societyId,
  fromISO: "2000-01-01T00:00:00",
  toISO: "2099-01-01T00:00:00",
});
expectEqual("no net change across full window for created-then-deleted holder", diff.length, 0);

console.log("Role-holder revision flow checks passed.");
