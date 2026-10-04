/** Mixed-resource projections through production exports and real broker JWTs. */
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
  const auth = await fetch(`${config.authUrl}/api/auth/token`, { headers: { Cookie: cookies } });
  assert.equal(auth.ok, true); const { token } = await auth.json(); assert.ok(token);
  const client = new ConvexHttpClient(config.convexUrl, { logger: false }); client.setAuth(token); clients[account.key] = client;
}
clients.anonymous = new ConvexHttpClient(config.convexUrl, { logger: false });
const operator = new ConvexHttpClient(config.convexUrl, { logger: false }); operator.setAdminAuth(config.adminKey);
// Bounded binder previews must be qualified in an empty disposable workspace,
// otherwise newly seeded records can be outside the legitimate preview limits.
const batch = await operator.function(ref("roleFixture:seedBatchSociety"), undefined, {
  issuer: config.issuer,
  identities: config.accounts.filter(account => account.key.endsWith("-a")).map(({ subject, email, role, status }) => ({ subject, email, role, status })),
});
const societyId = batch.societyId, marker = `qualification-${randomUUID()}`;
const fixture = await operator.function(ref("projectionFixture:seed"), undefined, { societyId, marker });
const query = (key, name) => clients[key].query(ref(name), { societyId });
const mutate = (key, name, args) => clients[key].mutation(ref(name), args);
const results = [], extra = [];
const denial = /permission|membership|not found|disabled|not active|authentication|authorized|principal/i;
async function check(name, body) {
  try { await body(); results.push({ name, passed: true }); console.log(`PASS ${name}`); }
  catch (error) { results.push({ name, passed: false, error: String(error) }); console.error(`FAIL ${name}: ${error}`); }
}
try {
  await check("Owner/Admin retain all native resource sections and inherited source access", async () => {
    for (const key of ["owner-a", "admin-a"]) {
      const binder = await query(key, "minuteBook:overview"), registers = await query(key, "evidenceRegisters:overview");
      assert.deepEqual(binder.restrictedResources, []);
      for (const [field, id] of [["financials", fixture.financial], ["filings", fixture.filing], ["proxies", fixture.proxy]]) assert.ok(binder[field].some(row => row._id === id), field);
      assert.ok(registers.boardRoleAssignments.some(row => row._id === fixture.assignment));
      for (const id of fixture.budgets) assert.ok(registers.budgetSnapshots.some(row => row._id === id));
    }
  });
  await check("Member minute-book/docs remain readable with forbidden resources and restricted source redacted", async () => {
    const binder = await query("member-a", "minuteBook:overview"), registers = await query("member-a", "evidenceRegisters:overview");
    assert.ok(binder.items.some(row => row._id === fixture.spine));
    assert.ok(binder.meetings.some(row => row._id === fixture.meeting));
    for (const field of ["financials", "filings", "proxies"]) assert.deepEqual(binder[field], [], field);
    for (const field of ["boardRoleAssignments", "boardRoleChanges", "budgetSnapshots", "budgetSnapshotLines"]) assert.deepEqual(registers[field], [], field);
    assert.ok(registers.sourceEvidence.some(row => row.sourceTitle === `${marker} readable evidence`));
    assert.ok(!JSON.stringify([binder, registers]).includes(`${marker} restricted source`));
    assert.ok(!JSON.stringify([binder, registers]).includes(`${marker} forbidden`));
    assert.ok(binder.restrictedResources.includes("financials")); assert.ok(registers.restrictedResources.includes("directors"));
    assert.ok(!binder.checks.some(row => row.key === "open_filings"));
  });
  await check("Viewer/Director retain finance reads while restricted document ledger and child lines remain hidden", async () => {
    for (const key of ["viewer-a", "director-a"]) {
      const registers = await query(key, "evidenceRegisters:overview");
      assert.ok(registers.budgetSnapshots.some(row => row._id === fixture.budgets[0]));
      assert.ok(!registers.budgetSnapshots.some(row => row._id === fixture.budgets[1]));
      assert.ok(!registers.budgetSnapshotLines.some(row => row._id === fixture.lines[1]));
      assert.ok(registers.financialStatementImports.some(row => row._id === fixture.statements[0]));
      assert.ok(!registers.financialStatementImportLines.some(row => row._id === fixture.statementLines[1]));
      assert.ok(!JSON.stringify(registers).includes(`${marker} restricted source`));
    }
  });
  await check("Director/Viewer/Member cannot promote operational directors or write financial imports", async () => {
    for (const key of ["director-a", "viewer-a", "member-a"]) {
      await assert.rejects(() => mutate(key, "evidenceRegisters:promoteBoardRoleToDirector", { assignmentId: fixture.assignment }), denial);
      await assert.rejects(() => mutate(key, "evidenceRegisters:updateReview", { table: "budgetSnapshots", id: fixture.budgets[0], status: "Verified" }), denial);
      await assert.rejects(() => mutate(key, "evidenceRegisters:finishFinancePaperlessReview", { societyId }), denial);
    }
    await assert.rejects(() => mutate("director-a", "evidenceRegisters:updateReview", { table: "sourceEvidence", id: fixture.evidence[1], notes: "Denied source edit" }), /not found/i);
    const registers = await query("owner-a", "evidenceRegisters:overview");
    assert.equal(registers.sourceEvidence.find(row => row._id === fixture.evidence[1]).notes, undefined);
    assert.equal(registers.boardRoleAssignments.find(row => row._id === fixture.assignment).directorId, undefined);
    assert.equal(registers.budgetSnapshots.find(row => row._id === fixture.budgets[0]).status, "NeedsReview");
  });
  await check("Owner/Admin operational writes and Director document-evidence review remain available", async () => {
    for (const key of ["owner-a", "admin-a"]) {
      extra.push(await mutate(key, "evidenceRegisters:promoteBoardRoleToDirector", { assignmentId: fixture.assignment }));
      await mutate(key, "evidenceRegisters:updateReview", { table: "budgetSnapshots", id: fixture.budgets[0], status: "Verified" });
    }
    const evidence = await mutate("director-a", "evidenceRegisters:createManual", { societyId, kind: "boardRoleAssignment", payload: { personName: `${marker} document review` } }); extra.push(evidence);
    await mutate("director-a", "evidenceRegisters:updateReview", { table: "boardRoleAssignments", id: evidence, notes: "Synthetic document review qualification" });
  });
  await check("Foreign/disabled/invited/anonymous reads and record writes denied", async () => {
    for (const key of ["owner-b", "disabled-a", "invited-a", "anonymous"]) {
      for (const name of ["minuteBook:overview", "evidenceRegisters:overview"]) await assert.rejects(() => query(key, name), denial);
      await assert.rejects(() => mutate(key, "evidenceRegisters:updateReview", { table: "budgetSnapshots", id: fixture.budgets[0], status: "Verified" }), denial);
    }
  });
} finally {
  try { await operator.function(ref("projectionFixture:cleanup"), undefined, { societyId, ids: [...fixture.created, ...extra] }); }
  finally { await operator.function(ref("roleFixture:cleanupBatchMemberships"), undefined, { societyId }); }
  const remaining = await operator.function(ref("roleFixture:inspect"), undefined, { societyId, table: "users" });
  assert.deepEqual(remaining, [], "Temporary workspace memberships must be removed before final browser qualification");
}
const report = { generatedAt: new Date().toISOString(), backend: "isolated production Convex exports", identity: "real Better Auth broker sessions", results, scope: "Fresh disposable workspace, temporary memberships removed. Role-resource projection and inherited source ACL. Batch finance success is native-oracle-only; live batch execution intentionally excludes unrelated demo rows. Service-scope projections are native-oracle-only." };
writeFileSync(new URL("../../artifacts/offline/live-register-projection-results.json", import.meta.url), JSON.stringify(report, null, 2) + "\n");
if (results.some(result => !result.passed)) process.exitCode = 1;
