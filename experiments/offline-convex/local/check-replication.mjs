import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { ConvexHttpClient } from 'convex/browser';
import { makeFunctionReference as ref } from 'convex/server';
import { importJWK, SignJWT, generateKeyPair } from 'jose';
process.loadEnvFile(new URL('../.env.local', import.meta.url));
const endpoint = 'http://127.0.0.1:43220', issuer = 'http://127.0.0.1:43212';
if (process.env.CONVEX_SELF_HOSTED_URL !== 'http://127.0.0.1:43210' || !process.env.CONVEX_SELF_HOSTED_ADMIN_KEY?.startsWith('societyer-offline-pilot|')) throw Error('Isolated pilot required.');
const jwk = JSON.parse(readFileSync(new URL('../.env.signer.local', import.meta.url), 'utf8'));
const key = await importJWK(jwk, 'ES256'), run = randomUUID();
const admin = new ConvexHttpClient(process.env.CONVEX_SELF_HOSTED_URL, { logger: false }); admin.setAdminAuth(process.env.CONVEX_SELF_HOSTED_ADMIN_KEY);
const ids = await admin.function(ref('localPilotAdmin:seed'), undefined, { issuer, run });
async function jwt(actor, workspace, options = {}) {
  return new SignJWT({ society_id: workspace }).setProtectedHeader({ alg: 'ES256', kid: jwk.kid }).setIssuer(issuer)
    .setSubject(options.subject ?? `${issuer}|${actor}-${run}`).setAudience(options.audience ?? endpoint)
    .setIssuedAt().setExpirationTime(options.expiration ?? '5m').sign(options.key ?? key);
}
const owner = new ConvexHttpClient(process.env.CONVEX_SELF_HOSTED_URL, { logger: false });
owner.setAuth(await jwt('owner-a', ids.societyA, { subject: `owner-a-${run}`, audience: issuer }));
const keys = Object.fromEntries(['meeting', 'minutes', 'agenda', 'item', 'document', 'material'].map(name => [name, randomUUID()]));
const command = { version: 1, operationId: randomUUID(), meetingUuid: keys.meeting, baseRevision: 0, kind: 'create-meeting', keys,
  title: `Replication ${run}`, scheduledAt: '2026-11-15T10:00:00Z', notes: 'Actual Convex export', agendaTitle: 'Replication qualification' };
await owner.mutation(ref('offlineMeetings:applyCommand'), { societyId: ids.societyA, command });
const results = [];
async function check(name, body) { await body(); results.push({ name, passed: true }); console.log(`PASS ${name}`); }
async function stream(token, params = {}) {
  const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 12000), state = new Map(), lines = [];
  try {
    const response = await fetch(`${endpoint}/sync/stream`, { method: 'POST', signal: controller.signal,
      headers: { 'Content-Type': 'application/json', Accept: 'application/x-ndjson', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ buckets: [], client_id: randomUUID(), streams: { include_defaults: true, subscriptions: [] }, parameters: params }) });
    if (!response.ok) return { status: response.status, rows: [], error: await response.text() };
    let pending = '';
    for await (const chunk of response.body) {
      pending += Buffer.from(chunk).toString('utf8'); let at;
      while ((at = pending.indexOf('\n')) >= 0) {
        const raw = pending.slice(0, at); pending = pending.slice(at + 1); if (!raw.trim()) continue;
        const line = JSON.parse(raw); lines.push(line);
        for (const row of line.data?.data ?? []) {
          const object = `${row.object_type}:${row.object_id}`;
          if (row.op === 'PUT') state.set(object, { ...row, data: typeof row.data === 'string' ? JSON.parse(row.data) : row.data });
          else if (row.op === 'REMOVE') state.delete(object);
          else if (row.op === 'CLEAR') state.clear();
        }
        if (line.checkpoint_complete) { return { status: response.status, rows: [...state.values()], lines }; }
      }
    }
    return { status: response.status, rows: [...state.values()], lines };
  } finally { clearTimeout(timeout); }
}
async function replicated(token) {
  const deadline = Date.now() + 15000;
  let output;
  do {
    output = await stream(token);
    if (output.status !== 200 || output.rows.length) return output;
    await new Promise(resolve => setTimeout(resolve, 250));
  } while (Date.now() < deadline);
  return output;
}
async function settled(token, predicate) {
  const deadline = Date.now() + 15000;
  let output;
  do {
    output = await stream(token); assert.equal(output.status, 200, output.error);
    if (predicate(output.rows)) return output.rows;
    await new Promise(resolve => setTimeout(resolve, 250));
  } while (Date.now() < deadline);
  assert.fail('Timed out waiting for the actual replication predicate.');
}
await check('PowerSync readiness and liveness are healthy', async () => { for (const path of ['readiness', 'liveness']) assert.equal((await fetch(`${endpoint}/probes/${path}`)).status, 200); });
await check('Actual export stream delivers only owner-authorized meeting projection', async () => {
  const output = await replicated(await jwt('owner-a', ids.societyA)); assert.equal(output.status, 200, output.error);
  assert.equal(output.rows.length, 1, JSON.stringify(output.lines));
  assert.equal(output.rows[0].data.actor_key, `${issuer}|owner-a-${run}`); assert.equal(output.rows[0].data.society_id, ids.societyA);
  assert.equal(JSON.parse(output.rows[0].data.payload).title, command.title);
});
await check('Viewer receives a separate read-only projection with no privileged fields', async () => {
  const output = await stream(await jwt('viewer-a', ids.societyA)); assert.equal(output.status, 200, output.error); assert.equal(output.rows.length, 1);
  const snapshot = JSON.parse(output.rows[0].data.payload); assert.equal(snapshot.editable, false); assert.deepEqual(snapshot.files, []);
  assert.equal(output.rows[0].data.actor_key, `${issuer}|viewer-a-${run}`);
});
await check('A committed child update reaches a new independently authenticated stream', async () => {
  await owner.mutation(ref('offlineMeetings:applyCommand'), { societyId: ids.societyA, command: { version: 1, kind: 'edit-minutes',
    operationId: randomUUID(), meetingUuid: keys.meeting, baseRevision: 1, discussion: 'Replicated child edit' } });
  const deadline = Date.now() + 15000;
  let snapshot;
  do {
    const output = await stream(await jwt('viewer-a', ids.societyA));
    assert.equal(output.status, 200, output.error);
    snapshot = output.rows.length ? JSON.parse(output.rows[0].data.payload) : undefined;
    if (snapshot?.revision === 2) break;
    await new Promise(resolve => setTimeout(resolve, 250));
  } while (Date.now() < deadline);
  assert.equal(snapshot?.revision, 2); assert.equal(snapshot?.discussion, 'Replicated child edit');
});
await check('Foreign actor and workspace claim substitutions return no rows', async () => {
  for (const [actor, society] of [['owner-b', ids.societyA], ['owner-a', ids.societyB], ['nonmember', ids.societyA]]) {
    const output = await stream(await jwt(actor, society)); assert.equal(output.status, 200, output.error); assert.equal(output.rows.length, 0);
  }
});
await check('Client request parameters cannot override signed workspace claims', async () => {
  const output = await stream(await jwt('owner-b', ids.societyB), { society_id: ids.societyA }); assert.equal(output.status, 200, output.error); assert.equal(output.rows.length, 0);
});
await check('PowerSync rejects missing, expired, wrong audience and invalid signature credentials', async () => {
  const forged = (await generateKeyPair('ES256')).privateKey;
  for (const token of [undefined, await jwt('owner-a', ids.societyA, { expiration: Math.floor(Date.now()/1000)-120 }), await jwt('owner-a', ids.societyA, { audience: issuer }), await jwt('owner-a', ids.societyA, { key: forged })]) {
    const output = await stream(token); assert.equal(output.status, 401, output.error);
  }
});
await check('Role promotion and demotion automatically replicate write capabilities without explicit rebuild', async () => {
  const issued = await jwt('viewer-a', ids.societyA);
  await owner.mutation(ref('users:setRole'), { id: ids.users['viewer-a'], role: 'Director' });
  await settled(issued, rows => rows.length === 1 && JSON.parse(rows[0].data.payload).editable === true);
  await owner.mutation(ref('users:setRole'), { id: ids.users['viewer-a'], role: 'Viewer' });
  await settled(issued, rows => rows.length === 1 && JSON.parse(rows[0].data.payload).editable === false);
});
const upsertArgs = { id: ids.users['viewer-a'], societyId: ids.societyA, email: 'viewer-a@example.test', displayName: 'viewer-a', role: 'Viewer', status: 'Active' };
await check('Upsert suspension and reactivation automatically delete and restore replicated views', async () => {
  const issued = await jwt('viewer-a', ids.societyA);
  await owner.mutation(ref('users:upsert'), { ...upsertArgs, status: 'Suspended' });
  await settled(issued, rows => rows.length === 0);
  await owner.mutation(ref('users:upsert'), upsertArgs);
  await settled(issued, rows => rows.length === 1);
});
await check('Security disable automatically deletes projections for already issued credentials and denies Convex reads', async () => {
  const issued = await jwt('viewer-a', ids.societyA);
  const viewer = new ConvexHttpClient(process.env.CONVEX_SELF_HOSTED_URL, { logger: false });
  viewer.setAuth(await jwt('viewer-a', ids.societyA, { subject: `viewer-a-${run}`, audience: issuer }));
  await owner.mutation(ref('users:securityDisable'), { id: ids.users['viewer-a'], reason: 'Live replication revocation qualification' });
  await assert.rejects(() => viewer.query(ref('offlineMeetings:syncIdentity'), { societyId: ids.societyA }), /disabled/i);
  await settled(issued, rows => rows.length === 0);
});
await check('Membership removal automatically deletes a restored actor projection', async () => {
  const issued = await jwt('viewer-a', ids.societyA);
  await owner.mutation(ref('users:upsert'), upsertArgs);
  await settled(issued, rows => rows.length === 1);
  await owner.mutation(ref('users:remove'), { id: ids.users['viewer-a'] });
  await settled(issued, rows => rows.length === 0);
});
writeFileSync(new URL('../../../artifacts/offline/live-powersync-replication.json', import.meta.url), JSON.stringify({ timestamp: new Date().toISOString(), endpoint, convexEndpoint: process.env.CONVEX_SELF_HOSTED_URL, service: '1.26.1', transport: 'PowerSync NDJSON stream from actual Convex export', results,
  limitations: ['Local ES256 test signer; no external Clerk or Microsoft login flow', 'Direct protocol qualification; separate browser tests qualify actual SQLite SDK', 'Automatic invalidation covers the pilot exported setRole/upsert/remove/securityDisable paths only; other document/material ACL, identity changes and expiry paths still require release support'] }, null, 2) + '\n');
console.log(`${results.length} live PowerSync replication/access checks passed.`);
