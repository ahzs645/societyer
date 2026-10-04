/** Prepare fresh actual-broker browser voters/elections; not an additional native qualification run. */
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
const ownerAccount = config.accounts.find(row=>row.key==='owner-a');
const owner = await signIn(ownerAccount);
const fixture = await internal('roleFixture:seedEligibleMemberElection',{issuer:config.issuer,owner:{subject:ownerAccount.subject,email:ownerAccount.email},member:{subject:account.subject,email:account.email}});
const rows = {};
try {
  for(const key of ['narrow-phone','phone','tablet','desktop']) {
    const now = Date.now();
    const electionId = await owner.mutation(ref('elections:create'),{societyId:fixture.societyId,title:`Eligible member ${key} qualification`,opensAtISO:new Date(now-3600000).toISOString(),closesAtISO:new Date(now+86400000).toISOString(),nominationsOpenAtISO:new Date(now-3600000).toISOString(),nominationsCloseAtISO:new Date(now+86400000).toISOString()});
    const questionId = await owner.mutation(ref('elections:addQuestion'),{electionId,title:'Choose a candidate',maxSelections:1,options:[{id:'candidate-a',label:'Candidate Alpha',memberId:fixture.memberId},{id:'candidate-b',label:'Candidate Beta'}]});
    assert.deepEqual(await owner.mutation(ref('elections:snapshotEligibleVoters'),{electionId}),{eligibleCount:1});
    rows[key] = {electionId,questionId};
  }
  writeFileSync(new URL('.env.election-browser.local',import.meta.url),JSON.stringify({appUrl:config.issuer,societyId:fixture.societyId,account,rows},null,2),{mode:0o600});
} finally { await internal('roleFixture:cleanupElectionOperator',{societyId:fixture.societyId,ownerUserId:fixture.ownerUserId}); }
writeFileSync('artifacts/offline/live-election-browser-preparation.json',JSON.stringify({preparedAt:new Date().toISOString(),endpoint:config.convexUrl,societyId:fixture.societyId,browserElectionIds:rows,nativePublicAttemptCount:counts.queries+counts.mutations,nativeAttempts:counts,qualification:'Browser fixture preparation only: actual Owner create/questions/snapshot APIs and new real broker Member. No rerun of unchanged native participation assertions. Temporary Owner membership removed; A unchanged.'},null,2)+'\n');
console.log('Prepared four fresh eligible-Member browser elections using 12 actual Owner setup mutations.');
