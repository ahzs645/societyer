/** Actual-session regression: inaccessible binder evidence is unknown, never missing. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
const config = JSON.parse(readFileSync(new URL(".env.accounts.local", import.meta.url), "utf8"));
assert.equal(config.convexUrl, "http://127.0.0.1:43230");
assert.equal(config.authUrl, "http://127.0.0.1:43487");
const accounts = config.accounts.filter(account => ["owner-a", "viewer-a"].includes(account.key));
const clients = {};
for (const account of accounts) {
  const login = await fetch(`${config.authUrl}/api/auth/sign-in/email`, { method: "POST", headers: { "Content-Type": "application/json", Origin: config.issuer }, body: JSON.stringify({ email: account.email, password: account.password }) });
  assert.equal(login.ok, true);
  const cookies = login.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
  const auth = await fetch(`${config.authUrl}/api/auth/token`, { headers: { Cookie: cookies } });
  assert.equal(auth.ok, true); const { token } = await auth.json(); assert.ok(token);
  const client = new ConvexHttpClient(config.convexUrl, { logger: false }); client.setAuth(token); clients[account.key] = client;
}
const ref = makeFunctionReference;
const operator = new ConvexHttpClient(config.convexUrl, { logger: false }); operator.setAdminAuth(config.adminKey);
const { societyId } = await operator.function(ref("roleFixture:seedBatchSociety"), undefined, { issuer: config.issuer, identities: accounts.map(({ subject, email, role, status }) => ({ subject, email, role, status })) });
const marker = `qualification-${randomUUID()}`;
const created = [], results = [];
async function check(name, body) {
  try { await body(); results.push({ name, passed: true }); console.log(`PASS ${name}`); }
  catch (error) { results.push({ name, passed: false }); console.error(`FAIL ${name}: ${error}`); }
}
try {
  const fixture = await operator.function(ref("projectionFixture:seed"), undefined, { societyId, marker }); created.push(...fixture.created);
  const privateTitle = `${marker} private core qualification`;
  const id = await clients["owner-a"].mutation(ref("documents:create"), { societyId, title: privateTitle, category: "Constitution", tags: [] }); created.push(id);
  await check("Owner retains private Constitution and full core completeness checks", async () => {
    const binder = await clients["owner-a"].query(ref("minuteBook:overview"), { societyId });
    assert.deepEqual(binder.restrictedResources, []); assert.equal(binder.documentCoverageLimited, false);
    assert.ok(binder.documents.some(row => row._id === id));
    const core = binder.checks.find(row => row.key === "missing_core_documents");
    assert.equal(core.count, 1); assert.equal(core.detail, "Bylaws"); assert.equal(core.status, undefined);
  });
  await check("Viewer document ACL yields unknown checks and limited bundle coverage without private metadata", async () => {
    const binder = await clients["viewer-a"].query(ref("minuteBook:overview"), { societyId });
    assert.deepEqual(binder.restrictedResources, []); assert.equal(binder.documentCoverageLimited, true);
    assert.ok(!JSON.stringify(binder).includes(privateTitle)); assert.ok(!JSON.stringify(binder).includes(id));
    const core = binder.checks.find(row => row.key === "missing_core_documents");
    assert.equal(core.label, "Core document completeness"); assert.equal(core.status, "unknown"); assert.equal(core.count, null); assert.equal(core.ok, null); assert.equal(core.severity, "info");
    for (const check of binder.checks.filter(row => ["missing_core_documents", "missing_signatures", "policy_adoption_gaps", "paper_archive_gap", "policy_review_gaps"].includes(row.key))) assert.equal(check.status, "unknown");
    assert.ok(binder.documents.some(row => row._id === fixture.publicDocument));
    for (const bundle of binder.recordBundles) {
      assert.equal(bundle.documentCoverageLimited, true);
      for (const gap of bundle.gaps.filter(row => ["minutes_source_gap", "materials_gap", "filing_evidence_gap", "policy_document_gap", "policy_review_gap", "policy_signature_gap", "written_resolution_signature_gap", "financials_statement_gap"].includes(row.key))) { assert.equal(gap.status, "unknown"); assert.equal(gap.severity, "info"); }
    }
  });
} finally {
  try { await operator.function(ref("projectionFixture:cleanup"), undefined, { societyId, ids: created }); }
  finally { await operator.function(ref("roleFixture:cleanupBatchMemberships"), undefined, { societyId }); }
  assert.deepEqual(await operator.function(ref("roleFixture:inspect"), undefined, { societyId, table: "users" }), []);
}
writeFileSync(new URL("../../artifacts/offline/live-document-coverage-results.json", import.meta.url), JSON.stringify({ generatedAt: new Date().toISOString(), backend: "isolated production Convex exports", identity: "real Better Auth broker sessions", results, scope: "Private Constitution created through actual Owner document API in a fresh disposable workspace. Supporting ACL-filtered evidence yields conservative unknown coverage. Synthetic records and temporary memberships removed; no private document titles, IDs, credentials or tokens in this artifact." }, null, 2) + "\n");
if (results.some(result => !result.passed)) process.exitCode = 1;
