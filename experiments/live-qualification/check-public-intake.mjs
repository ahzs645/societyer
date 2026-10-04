import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { ConvexHttpClient } from "convex/browser";
import { getFunctionName, makeFunctionReference } from "convex/server";
const config = JSON.parse(readFileSync(new URL(".env.accounts.local", import.meta.url), "utf8"));
if (config.convexUrl !== "http://127.0.0.1:43230") throw new Error("Isolated live qualification required.");
const admin = new ConvexHttpClient(config.convexUrl, { logger: false }); admin.setAdminAuth(config.adminKey);
const anonymous = new ConvexHttpClient(config.convexUrl, { logger: false });
const ref = name => makeFunctionReference(name);
const nativeAttempts = { queries: 0, mutations: 0, completed: 0, rejected: 0, operatorFixtureCalls: 0, byEndpoint: {} };
const internal = (name, args) => { nativeAttempts.operatorFixtureCalls++; return admin.function(ref(name), undefined, args); };
for (const kind of ["query", "mutation"]) {
  const method = anonymous[kind].bind(anonymous);
  anonymous[kind] = (...args) => {
    nativeAttempts[kind === "query" ? "queries" : "mutations"]++;
    const endpoint = getFunctionName(args[0]);
    const row = nativeAttempts.byEndpoint[endpoint] ??= { kind, attempted: 0, completed: 0, rejected: 0 };
    row.attempted++;
    return method(...args).then(value => { row.completed++; nativeAttempts.completed++; return value; }, error => { row.rejected++; nativeAttempts.rejected++; throw error; });
  };
}
const ids = await internal("roleFixture:seedPublicIntake", {});
const volunteer = { societyId: ids.societyId, firstName: "Public", lastName: "Applicant", email: "public@example.test", interests: [] };
const grant = { societyId: ids.societyId, applicantName: "Public applicant", email: "public@example.test", projectTitle: "Public proposal", projectSummary: "Proposal", grantId: ids.publicGrantId };
const baseline = { societyId: ids.societyId, disabledModules: [], published: true, volunteerEnabled: true, grantEnabled: true, opportunitiesOpen: true };
const results = [];
async function check(name, body) { await body(); results.push({ name, passed: true }); console.log(`PASS ${name}`); }
await check("Published public intake contexts and anonymous native application submissions work", async () => {
  assert.ok(await anonymous.query(ref("publicPortal:volunteerIntakeContext"), { slug: ids.slug }));
  assert.ok(await anonymous.query(ref("publicPortal:grantIntakeContext"), { slug: ids.slug }));
  const volunteerId = await anonymous.mutation(ref("volunteers:submitApplication"), { ...volunteer, source: "forged-internal" });
  assert.ok(volunteerId);
  assert.ok(await anonymous.mutation(ref("grants:submitApplication"), grant));
  assert.ok(await anonymous.mutation(ref("grants:submitApplication"), { ...grant, grantId: undefined }));
});
await check("Public applicants cannot enumerate rosters or substitute private member/grant identities", async () => {
  await assert.rejects(() => anonymous.query(ref("volunteers:list"), { societyId: ids.societyId }), /Authentication/);
  await assert.rejects(() => anonymous.query(ref("grants:list"), { societyId: ids.societyId }), /Authentication/);
  await assert.rejects(() => anonymous.mutation(ref("volunteers:submitApplication"), { ...volunteer, memberId: ids.memberId }), /cannot assign a workspace member/);
  await assert.rejects(() => anonymous.mutation(ref("grants:submitApplication"), { ...grant, grantId: ids.privateGrantId }), /unavailable/);
});
await check("Unpublished workspaces reject public applications", async () => {
  await assert.rejects(() => anonymous.mutation(ref("volunteers:submitApplication"), { ...volunteer, societyId: ids.privateSocietyId }), /unavailable/);
  await assert.rejects(() => anonymous.mutation(ref("grants:submitApplication"), { ...grant, societyId: ids.privateSocietyId }), /unavailable/);
});
try {
  await check("Disabled modules reject anonymous intake and remove public contexts", async () => {
    await internal("roleFixture:configurePublicIntake", { ...baseline, disabledModules: ["volunteers", "grants"] });
    assert.equal(await anonymous.query(ref("publicPortal:volunteerIntakeContext"), { slug: ids.slug }), null);
    assert.equal(await anonymous.query(ref("publicPortal:grantIntakeContext"), { slug: ids.slug }), null);
    await assert.rejects(() => anonymous.mutation(ref("volunteers:submitApplication"), volunteer), /disabled/);
    await assert.rejects(() => anonymous.mutation(ref("grants:submitApplication"), grant), /disabled/);
  });
  await check("Publication and intake flags each deny direct API submissions", async () => {
    await internal("roleFixture:configurePublicIntake", { ...baseline, published: false });
    await assert.rejects(() => anonymous.mutation(ref("volunteers:submitApplication"), volunteer), /unavailable/);
    await internal("roleFixture:configurePublicIntake", { ...baseline, volunteerEnabled: false, grantEnabled: false });
    await assert.rejects(() => anonymous.mutation(ref("volunteers:submitApplication"), volunteer), /unavailable/);
    await assert.rejects(() => anonymous.mutation(ref("grants:submitApplication"), grant), /unavailable/);
  });
  await check("General grant intake closes when no opportunity accepts public applications", async () => {
    await internal("roleFixture:configurePublicIntake", { ...baseline, opportunitiesOpen: false });
    await assert.rejects(() => anonymous.mutation(ref("grants:submitApplication"), { ...grant, grantId: undefined }), /unavailable/);
  });
} finally {
  // Leave the separate test-only workspace unpublished. Its records do not
  // create memberships or alter the shared Owner/Admin browser fixture.
  await internal("roleFixture:configurePublicIntake", { ...baseline, published: false });
}
writeFileSync(new URL("../../artifacts/offline/live-public-intake-results.json", import.meta.url), JSON.stringify({ completedAt: new Date().toISOString(), endpoint: config.convexUrl, passed: results.length, results, nativePublicAttemptCount: nativeAttempts.queries + nativeAttempts.mutations, nativeAttempts, qualification: "Actual anonymous Convex HTTP mutations and public context queries; private operator-only disposable fixtures; no role/membership or main UI fixture changes", limitations: ["This qualifies native public APIs; browser form usability is tested separately."] }, null, 2) + "\n");
console.log(`${results.length} live public intake scenarios passed.`);
