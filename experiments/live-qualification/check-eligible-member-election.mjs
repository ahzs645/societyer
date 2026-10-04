/** Real eligible-member production election APIs; isolated qualification only. */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { ConvexHttpClient } from "convex/browser";
import { getFunctionName, makeFunctionReference } from "convex/server";
const config = JSON.parse(readFileSync(new URL(".env.accounts.local", import.meta.url), "utf8"));
if (config.convexUrl !== "http://127.0.0.1:43230" || config.authUrl !== "http://127.0.0.1:43487") throw new Error("Isolated qualification endpoints required.");
const ref = makeFunctionReference;
const counts = { queries: 0, mutations: 0, completed: 0, rejected: 0, brokerRequests: 0, operatorFixtureCalls: 0, byEndpoint: {} };
const admin = new ConvexHttpClient(config.convexUrl, { logger: false }); admin.setAdminAuth(config.adminKey);
const internal = (name, args) => { counts.operatorFixtureCalls++; return admin.function(ref(name), undefined, args); };
const account = { email: `eligible-member-${randomBytes(8).toString("hex")}@qualification.example.test`, password: `Pilot-${randomBytes(20).toString("hex")}` };
counts.brokerRequests++;
const signup = await fetch(`${config.authUrl}/api/auth/sign-up/email`, { method: "POST", headers: { "Content-Type": "application/json", Origin: config.issuer }, body: JSON.stringify({ ...account, name: "Eligible election member" }) });
assert.ok(signup.ok, `New real Better Auth member signup ${signup.status}`);
account.subject = (await signup.json()).user.id;
writeFileSync(new URL(".env.election-account.local", import.meta.url), JSON.stringify(account, null, 2), { mode: 0o600 });
async function signIn(credentials) {
  counts.brokerRequests++;
  const response = await fetch(`${config.authUrl}/api/auth/sign-in/email`, { method: "POST", headers: { "Content-Type": "application/json", Origin: config.issuer }, body: JSON.stringify({ email: credentials.email, password: credentials.password }) });
  assert.ok(response.ok);
  const cookies = response.headers.getSetCookie().map(value => value.split(";")[0]).join("; "); assert.ok(cookies);
  counts.brokerRequests++;
  const auth = await fetch(`${config.authUrl}/api/auth/token`, { headers: { Cookie: cookies } }); assert.ok(auth.ok);
  const { token } = await auth.json(); assert.ok(token);
  const client = new ConvexHttpClient(config.convexUrl, { logger: false }); client.setAuth(token);
  for (const kind of ["query", "mutation"]) {
    const method = client[kind].bind(client);
    client[kind] = (reference, args) => {
      counts[kind === "query" ? "queries" : "mutations"]++;
      const name = getFunctionName(reference), row = counts.byEndpoint[name] ??= { kind, attempted: 0, completed: 0, rejected: 0 }; row.attempted++;
      return method(reference, args).then(value => { counts.completed++; row.completed++; return value; }, error => { counts.rejected++; row.rejected++; throw error; });
    };
  }
  return client;
}
const ownerAccount = config.accounts.find(row => row.key === "owner-a");
const [owner, member, foreign] = await Promise.all([signIn(ownerAccount), signIn(account), signIn(config.accounts.find(row => row.key === "owner-b"))]);
const fixture = await internal("roleFixture:seedEligibleMemberElection", { issuer: config.issuer, owner: { subject: ownerAccount.subject, email: ownerAccount.email }, member: { subject: account.subject, email: account.email } });
const rows = {}, results = [];
async function check(name, body) { try { await body(); results.push({ name, passed: true }); console.log(`PASS ${name}`); } catch (error) { results.push({ name, passed: false, error: String(error) }); console.error(`FAIL ${name}: ${error}`); } }
const deny = (client, kind, name, args, match = /Permission|principal|membership|not found|not authorized|Role .*required/i) => assert.rejects(() => client[kind](ref(name), args), match);
const call = (client, name, args) => client.mutation(ref(name), args);
const query = (client, name, args) => client.query(ref(name), args);
try {
  await check("Actual Owner creates and snapshots one eligible member for native and four browser elections", async () => {
    for (const key of ["native", "narrow-phone", "phone", "tablet", "desktop"]) {
      const now = Date.now();
      const electionId = await call(owner, "elections:create", { societyId: fixture.societyId, title: `Eligible member ${key} qualification`, opensAtISO: new Date(now - 3600000).toISOString(), closesAtISO: new Date(now + 86400000).toISOString(), nominationsOpenAtISO: new Date(now - 3600000).toISOString(), nominationsCloseAtISO: new Date(now + 86400000).toISOString() });
      const questionId = await call(owner, "elections:addQuestion", { electionId, title: "Choose a candidate", maxSelections: 1, options: [{ id: "candidate-a", label: "Candidate Alpha", memberId: fixture.memberId }, { id: "candidate-b", label: "Candidate Beta" }] });
      assert.deepEqual(await call(owner, "elections:snapshotEligibleVoters", { electionId }), { eligibleCount: 1 });
      rows[key] = { electionId, questionId };
    }
  });
  const current = rows.native;
  await check("Eligible Member sees own eligibility and successfully submits a nomination without administration grants", async () => {
    const bundle = await query(member, "elections:get", { id: current.electionId });
    assert.equal(bundle.canSeeSensitive, false); assert.equal(bundle.eligible.length, 1); assert.equal(bundle.eligible[0].memberId, fixture.memberId); assert.deepEqual(bundle.ballots, []); assert.deepEqual(bundle.audit, []);
    assert.equal((await query(member, "elections:listMine", { societyId: fixture.societyId, userId: fixture.memberUserId })).length, 5);
    const nominationId = await call(member, "elections:submitNomination", { electionId: current.electionId, questionId: current.questionId, nomineeName: "Native eligible candidate", statement: "Real confirmed member nomination" });
    const nominations = await query(member, "elections:listNominations", { electionId: current.electionId });
    const nomination = nominations.find(row => row._id === nominationId); assert.ok(nomination); assert.equal(nomination.memberId, fixture.memberId); assert.equal(nomination.submittedByUserId, fixture.memberUserId);
  });
  await check("Actor substitution and foreign election/question access fail before nomination or ballot writes", async () => {
    await deny(member, "mutation", "elections:submitNomination", { electionId: current.electionId, nomineeName: "Forged actor", actingUserId: fixture.ownerUserId });
    await deny(member, "mutation", "elections:castBallot", { electionId: current.electionId, choices: [{ questionId: current.questionId, optionIds: ["candidate-a"] }], actingUserId: fixture.ownerUserId });
    await deny(foreign, "mutation", "elections:submitNomination", { electionId: current.electionId, nomineeName: "Foreign caller" });
    await deny(foreign, "mutation", "elections:castBallot", { electionId: current.electionId, choices: [{ questionId: current.questionId, optionIds: ["candidate-a"] }] });
    await deny(member, "mutation", "elections:submitNomination", { electionId: fixture.foreignElectionId, nomineeName: "Foreign election" });
    await deny(member, "mutation", "elections:submitNomination", { electionId: current.electionId, questionId: fixture.foreignQuestionId, nomineeName: "Foreign question" });
    await deny(member, "query", "elections:get", { id: fixture.foreignElectionId });
    assert.equal((await query(member, "elections:listNominations", { electionId: current.electionId })).length, 1);
    assert.equal((await query(owner, "elections:get", { id: current.electionId })).ballots.length, 0);
  });
  await check("Eligible Member participation cannot create, configure, snapshot, close or publish elections", async () => {
    await deny(member, "mutation", "elections:create", { societyId: fixture.societyId, title: "Forbidden", opensAtISO: new Date().toISOString(), closesAtISO: new Date(Date.now() + 86400000).toISOString() });
    await deny(member, "mutation", "elections:addQuestion", { electionId: current.electionId, title: "Forbidden", maxSelections: 1, options: [] });
    await deny(member, "mutation", "elections:snapshotEligibleVoters", { electionId: current.electionId });
    await deny(member, "mutation", "elections:close", { electionId: current.electionId });
    await deny(member, "mutation", "elections:tallyElection", { electionId: current.electionId });
  });
  await check("Invalid question/options are rejected, real ballot succeeds once and duplicate ballot is rejected", async () => {
    await deny(member, "mutation", "elections:castBallot", { electionId: current.electionId, choices: [{ questionId: fixture.foreignQuestionId, optionIds: ["foreign"] }] }, /not found|permission|membership/i);
    await deny(member, "mutation", "elections:castBallot", { electionId: current.electionId, choices: [{ questionId: current.questionId, optionIds: ["unknown"] }] }, /Invalid ballot selection/);
    await deny(member, "mutation", "elections:castBallot", { electionId: current.electionId, choices: [{ questionId: current.questionId, optionIds: ["candidate-a", "candidate-b"] }] }, /at most 1/);
    const ballotId = await call(member, "elections:castBallot", { electionId: current.electionId, choices: [{ questionId: current.questionId, optionIds: ["candidate-a"] }] }); assert.ok(ballotId);
    await deny(member, "mutation", "elections:castBallot", { electionId: current.electionId, choices: [{ questionId: current.questionId, optionIds: ["candidate-b"] }] }, /already been cast/);
    const bundle = await query(member, "elections:get", { id: current.electionId }); assert.equal(bundle.eligible[0].status, "Voted"); assert.equal(bundle.ballotCount, 1); assert.deepEqual(bundle.ballots, []);
  });
  await check("Owner tallies exactly one anonymous ballot; Member sees published totals and no voter/ballot linkage", async () => {
    assert.deepEqual(await query(member, "elections:tally", { electionId: current.electionId }), []);
    const totals = await query(owner, "elections:tally", { electionId: current.electionId }); assert.equal(totals[0].totals.find(row => row.id === "candidate-a").votes, 1); assert.equal(totals[0].totals.find(row => row.id === "candidate-b").votes, 0);
    const bundle = await query(owner, "elections:get", { id: current.electionId }); assert.equal(bundle.ballots.length, 1); assert.equal(bundle.ballots[0].memberId, undefined); assert.equal(bundle.ballots[0].userId, undefined); assert.match(bundle.ballots[0].receiptCode, /^BAL-/);
    await call(owner, "elections:close", { electionId: current.electionId }); await call(owner, "elections:tallyElection", { electionId: current.electionId, resultsSummary: "One verified eligible-member ballot" });
    assert.deepEqual(await query(member, "elections:tally", { electionId: current.electionId }), totals);
    const published = await query(member, "elections:get", { id: current.electionId }); assert.equal(published.election.status, "Tallied"); assert.deepEqual(published.ballots, []); assert.deepEqual(published.audit, []);
  });
  const privateFixture = { appUrl: config.issuer, societyId: fixture.societyId, account, rows: Object.fromEntries(Object.entries(rows).filter(([key]) => key !== "native")) };
  writeFileSync(new URL(".env.election-browser.local", import.meta.url), JSON.stringify(privateFixture, null, 2), { mode: 0o600 });
} finally {
  await internal("roleFixture:cleanupElectionOperator", { societyId: fixture.societyId, ownerUserId: fixture.ownerUserId });
  const artifact = { completedAt: new Date().toISOString(), endpoint: config.convexUrl, auth: "Actual Better Auth eligible Member; verified broker JWT", societyId: fixture.societyId, passed: results.filter(row => row.passed).length, failed: results.filter(row => !row.passed).length, nativePublicAttemptCount: counts.queries + counts.mutations, nativeAttempts: counts, results, browserElectionIds: Object.fromEntries(Object.entries(rows).filter(([key]) => key !== "native")) };
  writeFileSync("artifacts/offline/live-eligible-member-election-results.json", JSON.stringify(artifact, null, 2) + "\n");
}
console.log(`${results.filter(row => row.passed).length}/${results.length} live eligible-member election scenarios passed.`);
if (results.some(row => !row.passed)) process.exitCode = 1;
