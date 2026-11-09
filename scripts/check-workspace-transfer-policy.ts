/**
 * Every schema table has exactly one reviewed workspace-transfer policy, so a
 * new table can't be copied or silently skipped without a decision; and the
 * schema walker finds the references we know about.
 */
import assert from "node:assert/strict";
import schema from "../convex/schema";
import { TRANSFER_COPY_TABLES, TRANSFER_POLICY } from "../shared/workspaceTransfer/policy";
import { idPaths, matches, rewriteIdTokens, societyField, societyIndexes, tableValidators, transformValue, validateDocument } from "../shared/workspaceTransfer/validators";

const validators = tableValidators(schema);
const tables = [...validators.keys()];
const missing = tables.filter((table) => !(table in TRANSFER_POLICY));
const stale = Object.keys(TRANSFER_POLICY).filter((table) => !validators.has(table));
assert.deepEqual(missing, [], `Tables without a transfer policy (add them to shared/workspaceTransfer/policy.ts): ${missing.join(", ")}`);
assert.deepEqual(stale, [], `Transfer policy names tables the schema doesn't define: ${stale.join(", ")}`);
const copyList = [...TRANSFER_COPY_TABLES] as string[];
assert.equal(new Set(copyList).size, copyList.length, "A table is listed twice in TRANSFER_COPY_TABLES.");
const policyEntries = Object.entries(TRANSFER_POLICY);
for (const [table, policy] of policyEntries) {
  assert.ok(policy.reason.trim().length > 8, `${table}: give the policy a reason.`);
  if (copyList.includes(table)) assert.equal(policy.reason, "Workspace record.", `${table} is in TRANSFER_COPY_TABLES and also has its own entry.`);
  if (policy.mode === "copy-disabled") assert.ok(policy.set && Object.keys(policy.set).length, `${table}: copy-disabled must switch something off.`);
  for (const field of [...policy.strip ?? [], ...Object.keys(policy.set ?? {})]) {
    const shape = validators.get(table);
    assert.ok(shape?.type === "object" && field in (shape.value as Record<string, unknown>), `${table}: policy field ${field} is not in the schema.`);
  }
}
// Credentials and per-deployment state must stay skipped.
for (const table of ["apiTokens", "apiClients", "agentGrants", "mcpOAuthTokens", "invitations", "workspaceDomains", "workspaceSignInPolicies",
  "workspaceStoragePolicies", "personAccounts", "personIdentityLinks", "externalIdentities", "authRateLimits", "webhookSubscriptions",
  "integrationSyncStates", "storageOwnership", "workspaceTransferRuns", "workspaceTransferIdMap"]) {
  assert.equal(TRANSFER_POLICY[table]?.mode, "skip", `${table} must be skipped by a workspace transfer.`);
}

// Walker: known references, including nested, array, optional and required ones.
const paths = (table: string) => idPaths(validators.get(table)!);
assert.deepEqual(paths("journalLines").find((p) => p.path === "journalEntryId"), { path: "journalEntryId", target: "journalEntries", required: true });
assert.deepEqual(paths("journalLines").find((p) => p.path === "accountId"), { path: "accountId", target: "financialAccounts", required: true });
assert.deepEqual(paths("societies").find((p) => p.path === "postIncorporationEvidence[].documentId"), { path: "postIncorporationEvidence[].documentId", target: "documents", required: false });
assert.deepEqual(paths("societies").find((p) => p.path === "logoStorageId"), { path: "logoStorageId", target: "_storage", required: false });
assert.deepEqual(paths("financialTransactions").find((p) => p.path === "billPaymentRelease.journalEntryIds[]"), { path: "billPaymentRelease.journalEntryIds[]", target: "journalEntries", required: false });
assert.deepEqual(paths("workflows").find((p) => p.path === "scheduleAuthorization.authorizerUserId"), { path: "scheduleAuthorization.authorizerUserId", target: "users", required: false });
assert.ok(paths("meetingSourceText").some((p) => p.path === "sourceId" && p.required), "child table reference found");
assert.equal(paths("activity").length, 1, "activity holds its subject only as a string (plus societyId)");
assert.equal(societyField(validators.get("users")!), "required");
assert.equal(societyField(validators.get("peopleDirectory")!), "optional");
assert.equal(societyField(validators.get("meetingSourceText")!), "none");
assert.equal(societyIndexes(schema).get("users"), "by_society");
const total = tables.reduce((sum, table) => sum + paths(table).length, 0);
assert.ok(total > 900, `the walker found only ${total} typed references`);

// Transform: unresolved optional refs are omitted, array elements dropped, required refs fail the row.
const userShape = validators.get("users")!;
const pass1 = transformValue(userShape, { societyId: "S", email: "a@b", displayName: "A", role: "Owner", status: "Active", createdAtISO: "x", memberId: "M" },
  (target, id) => target === "societies" ? `dest-${id}` : null, (s) => s);
assert.deepEqual(pass1, { ok: true, value: { societyId: "dest-S", email: "a@b", displayName: "A", role: "Owner", status: "Active", createdAtISO: "x" } });
assert.deepEqual(transformValue(userShape, { societyId: "S" }, () => null, (s) => s), { ok: false, path: "societyId" });
const spend = transformValue(validators.get("spendBudgets")!, { memberUserIds: ["u1", "u2"] }, (_t, id) => id === "u1" ? "d1" : null, (s) => s);
assert.deepEqual(spend, { ok: true, value: { memberUserIds: ["d1"] } });
assert.equal(matches({ type: "union", value: [{ type: "literal", value: "a" }, { type: "id", tableName: "users" }] }, "x"), true);
assert.ok(validateDocument(userShape, { email: "a" }).some((error) => error.includes("required")));
assert.deepEqual(rewriteIdTokens(`{"id":"${"k".repeat(31)}a","x":"pre_${"k".repeat(31)}a"}`, (token) => token === `${"k".repeat(31)}a` ? "NEW" : undefined),
  { value: `{"id":"NEW","x":"pre_NEW"}`, count: 2 });

console.log(`workspace transfer policy: ${tables.length} tables classified (${policyEntries.filter(([, p]) => p.mode === "copy").length} copy, ${policyEntries.filter(([, p]) => p.mode === "copy-disabled").length} copy-disabled, ${policyEntries.filter(([, p]) => p.mode === "skip").length} skip); ${total} typed references walked`);
