/** Native vault endpoints using real Better Auth sessions on the isolated backend. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";

const config = JSON.parse(readFileSync(new URL(".env.accounts.local", import.meta.url), "utf8"));
if (config.convexUrl !== "http://127.0.0.1:43230" || config.authUrl !== "http://127.0.0.1:43487") throw new Error("Isolated qualification endpoints required.");
const ref = name => makeFunctionReference(name);
const clients = {};
for (const account of config.accounts) {
  const response = await fetch(`${config.authUrl}/api/auth/sign-in/email`, { method: "POST", headers: { "Content-Type": "application/json", Origin: config.issuer }, body: JSON.stringify({ email: account.email, password: account.password }) });
  assert.equal(response.ok, true, `Real login for ${account.key}`);
  const cookies = response.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
  assert.ok(cookies, `Real session for ${account.key}`);
  const authResponse = await fetch(`${config.authUrl}/api/auth/token`, { headers: { Cookie: cookies } });
  assert.equal(authResponse.ok, true, `Broker-issued JWT for ${account.key}`);
  const { token } = await authResponse.json();
  assert.ok(token);
  const client = new ConvexHttpClient(config.convexUrl, { logger: false });
  client.setAuth(token); clients[account.key] = client;
}
clients.anonymous = new ConvexHttpClient(config.convexUrl, { logger: false });
const owner = clients["owner-a"], admin = clients["admin-a"];
const societyId = config.fixture.societyA;
const actorId = key => config.fixture.users[key];
const run = randomUUID();
const firstValue = `synthetic-vault-${randomUUID()}`;
const nextValue = `synthetic-rotated-${randomUUID()}`;
const results = [];
const createdIds = [];
const mutation = (client, name, args) => client.mutation(ref(name), args);
const query = (client, name, args) => client.query(ref(name), args);
const denial = /permission|membership|not found|disabled|not active|authentication|authorized|principal|owner role/i;
async function check(name, body) {
  try { await body(); results.push({ name, passed: true }); console.log(`PASS ${name}`); }
  catch (error) { results.push({ name, passed: false, error: String(error) }); console.error(`FAIL ${name}: ${error}`); }
}
async function mustDeny(key, name, args) { await assert.rejects(() => mutation(clients[key], name, args), denial); }
const createArgs = { societyId, name: `Native vault qualification ${run}`, service: "Synthetic fixture only", credentialType: "api_key", storageMode: "stored_encrypted", secretValue: firstValue };
let defaultId, ownerOnlyId;
await check("Owner and Admin encrypted create, metadata redaction and default Admin reveal grant", async () => {
  defaultId = await mutation(owner, "secrets:create", { ...createArgs, actingUserId: actorId("owner-a") }); createdIds.push(defaultId);
  const adminCreated = await mutation(admin, "secrets:create", { ...createArgs, name: `${createArgs.name} Admin`, actingUserId: actorId("admin-a") }); createdIds.push(adminCreated);
  const rows = await query(owner, "secrets:list", { societyId });
  for (const id of [defaultId, adminCreated]) {
    const row = rows.find(item => item._id === id);
    assert.ok(row?.hasSecretValue); assert.equal(row.storageMode, "stored_encrypted");
    assert.equal(row.revealPolicy, "owner_admin_custodian");
    assert.equal("secretEncrypted" in row, false); assert.equal("secretValue" in row, false);
    assert.equal(JSON.stringify(row).includes(firstValue), false, "Public metadata must not contain plaintext");
    const result = await mutation(admin, "secrets:revealSecret", { id, actingUserId: actorId("admin-a") });
    assert.ok(result.value === firstValue, "Authorized decrypt must return the original synthetic bytes");
    assert.ok(result.revealedAtISO);
  }
});
await check("Encrypted rotation and metadata updates derive scope from the bound row", async () => {
  assert.ok(defaultId);
  await mutation(admin, "secrets:update", { id: defaultId, actingUserId: actorId("admin-a"), patch: { secretValue: nextValue, service: "Rotated synthetic fixture" } });
  const result = await mutation(owner, "secrets:revealSecret", { id: defaultId, actingUserId: actorId("owner-a") });
  assert.ok(result.value === nextValue, "Rotation must decrypt the updated synthetic value");
  const row = (await query(owner, "secrets:list", { societyId })).find(item => item._id === defaultId);
  assert.equal(row.service, "Rotated synthetic fixture"); assert.equal(row.secretUpdatedByUserId, actorId("admin-a"));
  assert.equal(row.secretLastRevealedByUserId, actorId("owner-a"));
  assert.equal(JSON.stringify(row).includes(nextValue), false);
});
await check("Owner-only record restricts Admin reveal while Owner remains authorized", async () => {
  ownerOnlyId = await mutation(owner, "secrets:create", { ...createArgs, name: `${createArgs.name} Owner only`, revealPolicy: "owner_only", custodianUserId: actorId("owner-a"), authorizedUserIds: [actorId("owner-a")] }); createdIds.push(ownerOnlyId);
  await mustDeny("admin-a", "secrets:revealSecret", { id: ownerOnlyId, actingUserId: actorId("admin-a") });
  const result = await mutation(owner, "secrets:revealSecret", { id: ownerOnlyId, actingUserId: actorId("owner-a") });
  assert.ok(result.value === firstValue);
});
await check("Admin cannot weaken owner-only ACL or replace its stored value; unchanged metadata remains editable", async () => {
  const rowBefore = (await query(owner, "secrets:list", { societyId })).find(row => row._id === ownerOnlyId);
  const protectedState = row => ({ revealPolicy: row.revealPolicy, custodianUserId: row.custodianUserId, authorizedUserIds: row.authorizedUserIds, secretUpdatedAtISO: row.secretUpdatedAtISO, secretUpdatedByUserId: row.secretUpdatedByUserId });
  for (const patch of [
    { revealPolicy: "owner_admin" },
    { custodianUserId: actorId("admin-a") },
    { authorizedUserIds: [actorId("admin-a")] },
    { secretValue: nextValue },
  ]) {
    await mustDeny("admin-a", "secrets:update", { id: ownerOnlyId, actingUserId: actorId("admin-a"), patch });
    const rowAfter = (await query(owner, "secrets:list", { societyId })).find(row => row._id === ownerOnlyId);
    assert.deepEqual(protectedState(rowAfter), protectedState(rowBefore), "Rejected owner-only change preserves ACL and encrypted-value metadata");
    const result = await mutation(owner, "secrets:revealSecret", { id: ownerOnlyId, actingUserId: actorId("owner-a") });
    assert.ok(result.value === firstValue, "Rejected update leaves the stored synthetic value unchanged");
  }
  await mutation(admin, "secrets:update", { id: ownerOnlyId, actingUserId: actorId("admin-a"), patch: { service: "Admin ordinary metadata", revealPolicy: rowBefore.revealPolicy, custodianUserId: rowBefore.custodianUserId, authorizedUserIds: rowBefore.authorizedUserIds } });
  const rowAfter = (await query(owner, "secrets:list", { societyId })).find(row => row._id === ownerOnlyId);
  assert.equal(rowAfter.service, "Admin ordinary metadata");
  assert.deepEqual(protectedState(rowAfter), protectedState(rowBefore));
  await mustDeny("admin-a", "secrets:revealSecret", { id: ownerOnlyId, actingUserId: actorId("admin-a") });
});
await check("Authenticated Owner can rotate owner-only value and update its access policy", async () => {
  await mutation(owner, "secrets:update", { id: ownerOnlyId, actingUserId: actorId("owner-a"), patch: { secretValue: nextValue, custodianUserId: actorId("admin-a"), authorizedUserIds: [actorId("admin-a")], revealPolicy: "owner_admin" } });
  const adminResult = await mutation(admin, "secrets:revealSecret", { id: ownerOnlyId, actingUserId: actorId("admin-a") });
  assert.ok(adminResult.value === nextValue, "Owner policy change grants Admin access intentionally");
  await mutation(owner, "secrets:update", { id: ownerOnlyId, patch: { secretValue: firstValue, revealPolicy: "owner_only", custodianUserId: actorId("owner-a"), authorizedUserIds: [actorId("owner-a")] } });
  await mustDeny("admin-a", "secrets:revealSecret", { id: ownerOnlyId, actingUserId: actorId("admin-a") });
});
await check("Forged actingUserId cannot impersonate another principal during create/update/reveal", async () => {
  await mustDeny("admin-a", "secrets:create", { ...createArgs, actingUserId: actorId("owner-a") });
  await mustDeny("admin-a", "secrets:update", { id: defaultId, actingUserId: actorId("owner-a"), patch: { service: "Forged" } });
  await mustDeny("admin-a", "secrets:revealSecret", { id: ownerOnlyId, actingUserId: actorId("owner-a") });
  await mustDeny("owner-a", "secrets:revealSecret", { id: defaultId, actingUserId: actorId("admin-a") });
});
await check("Foreign workspace cannot create against or mutate/reveal guessed vault records", async () => {
  await mustDeny("owner-b", "secrets:create", createArgs);
  await mustDeny("owner-a", "secrets:create", { ...createArgs, societyId: config.fixture.societyB });
  for (const name of ["secrets:update", "secrets:revealSecret", "secrets:remove"]) {
    const args = { id: defaultId, actingUserId: actorId("owner-b"), ...(name === "secrets:update" ? { patch: { service: "Foreign" } } : {}) };
    await mustDeny("owner-b", name, args);
  }
  await assert.rejects(() => query(clients["owner-b"], "secrets:list", { societyId }), denial);
  await assert.rejects(() => mutation(owner, "secrets:create", { ...createArgs, authorizedUserIds: [actorId("owner-b")] }), denial);
});
await check("Lower roles and disabled/invited/anonymous principals cannot create/update/reveal/delete", async () => {
  for (const key of ["director-a", "member-a", "viewer-a", "disabled-a", "invited-a", "anonymous"]) {
    await mustDeny(key, "secrets:create", createArgs);
    await mustDeny(key, "secrets:update", { id: defaultId, patch: { service: "Denied" } });
    await mustDeny(key, "secrets:revealSecret", { id: defaultId, actingUserId: key === "anonymous" ? actorId("owner-a") : actorId(key) });
    await mustDeny(key, "secrets:remove", { id: defaultId });
  }
});
await check("Own fixture records delete successfully without touching concurrent browser fixtures", async () => {
  for (const id of createdIds) await mutation(owner, "secrets:remove", { id, actingUserId: actorId("owner-a") });
  const rows = await query(owner, "secrets:list", { societyId });
  assert.ok(createdIds.every(id => !rows.some(row => row._id === id)));
});
const failed = results.filter(row => !row.passed).length;
writeFileSync(new URL("../../artifacts/offline/live-vault-results.json", import.meta.url), JSON.stringify({ completedAt: new Date().toISOString(), endpoint: config.convexUrl, auth: "Real Better Auth email sessions and broker JWTs verified by actual self-hosted Convex", passed: results.length - failed, failed, resolvedFindings: [{ finding: "Real Better Auth update/reveal rejected because the JWT has no default workspace", resolution: "Derive the workspace from the authorized vault row." }, { finding: "Admin could replace owner_only with owner_admin and then reveal", resolution: "Existing owner_only ACL or stored-value changes now require authenticated Owner; unchanged metadata remains editable." }], results, limitations: ["Synthetic values only; no production credentials or external secret systems used.", "Public metadata redaction and native encrypt/decrypt/rotate handlers exercised; raw ciphertext and encryption keys never exported.", "Clerk principal binding is qualified separately by the native authorization oracle.", "Browser viewport, role controls and reload behavior are qualified separately."] }, null, 2) + "\n");
if (failed) process.exitCode = 1;
