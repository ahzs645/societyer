/** Actual Better Auth/native Convex composite-resource qualification; no fixture changes. */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { ConvexHttpClient } from 'convex/browser';
import { getFunctionName, makeFunctionReference } from 'convex/server';
const config = JSON.parse(readFileSync(new URL('.env.accounts.local', import.meta.url), 'utf8'));
if (config.convexUrl !== 'http://127.0.0.1:43230') throw new Error('Isolated qualification required.');
const counts = { queries: 0, mutations: 0, completed: 0, rejected: 0, brokerRequests: 0, byEndpoint: {} };
async function actor(key) {
  const account = config.accounts.find(row => row.key === key); assert.ok(account);
  counts.brokerRequests++;
  const login = await fetch(`${config.authUrl}/api/auth/sign-in/email`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: config.issuer }, body: JSON.stringify({email: account.email, password: account.password}) }); assert.ok(login.ok);
  const cookies = login.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
  counts.brokerRequests++;
  const response = await fetch(`${config.authUrl}/api/auth/token`, { headers: { Cookie: cookies } }); assert.ok(response.ok);
  const {token} = await response.json(); assert.ok(token);
  const client = new ConvexHttpClient(config.convexUrl, {logger: false}); client.setAuth(token);
  return async (endpoint, args) => {
    counts.queries++;
    const ref = makeFunctionReference(endpoint), name = getFunctionName(ref), row = counts.byEndpoint[name] ??= { attempted: 0, completed: 0, rejected: 0 }; row.attempted++;
    try { const value = await client.query(ref,args); counts.completed++; row.completed++; return value; }
    catch(error) {counts.rejected++; row.rejected++; throw error;}
  };
}
const [owner,viewer,member,foreign,disabled] = await Promise.all(['owner-a','viewer-a','member-a','owner-b','disabled-a'].map(actor));
const args = {societyId: config.fixture.societyA}, results = [];
async function check(name, fn) { await fn(); results.push({name,passed:true}); console.log(`PASS ${name}`); }
await check('Actual Owner and Viewer retain declared full resource reads', async () => {
  const full = await owner('dashboard:summary', args), readOnly = await viewer('dashboard:summary', args);
  assert.deepEqual(readOnly,full); assert.ok(full.readAccess.includes('directors:read')); assert.ok(full.readAccess.includes('filings:read')); assert.ok(full.board.length);
});
await check('Actual Member receives authorized data and no restricted board, filing, goal or proof projection', async () => {
  const projection = await member('dashboard:summary',args); assert.ok(projection.readAccess.includes('members:read')); assert.ok(projection.readAccess.includes('meetings:read'));
  for(const resource of ['directors','filings','deadlines','conflicts','committees','commitments','users','audit','settings']) assert.ok(!projection.readAccess.includes(`${resource}:read`),resource);
  for(const field of ['board','upcomingFilings','overdueFilings','goals','evidenceChains']) assert.deepEqual(projection[field],[],field);
  for(const field of ['directors','bcResidents','overdueFilings','openDeadlines','openConflicts','committees','openGoals']) assert.equal(projection.counts[field],0,field);
  assert.ok(!projection.complianceFlags.some(row => row.ruleId.startsWith('BC-SOC-DIRECTOR') || row.ruleId === 'DASHBOARD-COMPLIANCE-OK'));
  const badges = await member('dashboard:navCounts',args); assert.equal(badges.directors,0); assert.equal(badges.openDeadlines,0); assert.equal(badges.members,projection.counts.members);
});
await check('Foreign and disabled principals cannot read either dashboard composite', async () => {
  for(const query of [foreign,disabled]) for(const name of ['dashboard:summary','dashboard:navCounts']) await assert.rejects(() => query(name,args),/membership|not authorized|disabled|active|access|role/i);
});
writeFileSync('artifacts/offline/live-dashboard-resource-results.json',JSON.stringify({completedAt:new Date().toISOString(),endpoint:config.convexUrl,passed:results.length,results,nativePublicAttemptCount:counts.queries+counts.mutations,nativeAttempts:counts,qualification:'Actual Better Auth broker JWTs and production native Convex exports; no fixture/membership/module mutations',limitations:['Service-scope behavior and populated private evidence markers are verified by the native convex-test production-wrapper regression, separately from this live role projection check.']},null,2)+'\n');
console.log(`${results.length} live dashboard resource scenarios passed; ${counts.queries} exact native attempts.`);
