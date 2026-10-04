/** Actual Better Auth/native Convex composite-resource qualification; no fixture changes. */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { ConvexHttpClient } from 'convex/browser';
import { getFunctionName, makeFunctionReference } from 'convex/server';
const config = JSON.parse(readFileSync(new URL('.env.accounts.local', import.meta.url), 'utf8'));
if (config.convexUrl !== 'http://127.0.0.1:43230') throw new Error('Isolated qualification required.');
const counts = { queries: 0, mutations: 0, completed: 0, rejected: 0, brokerRequests: 0, operatorFixtureCalls: 0, byEndpoint: {} };
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
const admin = new ConvexHttpClient(config.convexUrl,{logger:false}); admin.setAdminAuth(config.adminKey);
const internal = (name,args)=>{counts.operatorFixtureCalls++;return admin.function(makeFunctionReference(name),undefined,args);};
const [owner,viewer,member,foreign] = await Promise.all(['owner-a','viewer-a','member-a','owner-b'].map(actor));
const fixture = await internal('roleFixture:seedStructuredRegisters',{issuer:config.issuer,identities:['owner-a','viewer-a','member-a'].map(key=>{const account=config.accounts.find(row=>row.key===key);return {subject:account.subject,email:account.email,role:account.role};})});
const args = {societyId:fixture.societyId}, results=[];
async function check(name,fn){await fn();results.push({name,passed:true});console.log(`PASS ${name}`);}
try {
  await check('Real Owner and Viewer retain structured legal registers and deleted/transitioned history',async()=>{
    const full = await owner('legalOperations:listRoleHolders',args);assert.equal(full.length,6);assert.deepEqual(await viewer('legalOperations:listRoleHolders',args),full);
    assert.equal((await owner('roleHolderHistory:revisionHistory',{roleHolderId:fixture.rows.deleted})).length,1);
    assert.equal((await viewer('roleHolderHistory:revisionHistory',{roleHolderId:fixture.rows.changed})).length,2);
  });
  await check('Member current and historical projections omit director/officer/controller structured records',async()=>{
    const current = await member('legalOperations:listRoleHolders',args);assert.deepEqual(current.map(row=>row.roleType).sort(),['member','other','other']); assert.equal(current.find(row=>row._id===fixture.rows.changed)?.historyReadable,false); assert.equal(current.find(row=>row._id===fixture.rows.member)?.historyReadable,true);
    const old = await member('roleHolderHistory:registerAsOf',{...args,asOfISO:'2025-06-01T00:00:00Z'});assert.equal(old.length,2);assert.ok(!JSON.stringify(old).includes('Forbidden'));
    const diff = await member('roleHolderHistory:changesBetween',{...args,fromISO:'2025-06-01T00:00:00Z',toISO:'2026-06-01T00:00:00Z'});assert.equal(diff.length,2);assert.ok(diff.every(row=>/member|other/.test(row.name)));
    assert.equal((await member('roleHolderHistory:revisionHistory',{roleHolderId:fixture.rows.member})).length,2);
  });
  await check('Member cannot bypass restricted prior snapshots through direct, transitioned or deleted history IDs',async()=>{
    for(const key of ['director','officer','controller','changed','deleted']) await assert.rejects(()=>member('roleHolderHistory:revisionHistory',{roleHolderId:fixture.rows[key]}),/Permission (directors|settings):read required/);
  });
  await check('Foreign real Owner cannot read any structured register or history projection',async()=>{
    for(const [name,input] of [['legalOperations:listRoleHolders',args],['roleHolderHistory:revisionHistory',{roleHolderId:fixture.rows.member}],['roleHolderHistory:registerAsOf',{...args,asOfISO:'2025-06-01T00:00:00Z'}],['roleHolderHistory:changesBetween',{...args,fromISO:'2025-06-01T00:00:00Z',toISO:'2026-06-01T00:00:00Z'}]]) await assert.rejects(()=>foreign(name,input),/membership|not authorized|not found|role/i);
  });
} finally {await internal('roleFixture:cleanupStructuredRegisters',args);}
writeFileSync('artifacts/offline/live-role-holder-resource-results.json',JSON.stringify({completedAt:new Date().toISOString(),endpoint:config.convexUrl,passed:results.length,results,nativePublicAttemptCount:counts.queries+counts.mutations,nativeAttempts:counts,qualification:'Actual Better Auth broker JWTs and production native Convex exports; separate guarded disposable register fixture with all extra account memberships removed afterward; A unchanged'},null,2)+'\n');
console.log(`${results.length} structured register scenarios passed; ${counts.queries} exact native attempts.`);
