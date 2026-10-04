import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { makeFunctionReference } from 'convex/server';
import type { GenericId } from 'convex/values';
import { createFixture, fixtureIssuer } from './fixture';
import * as hooked from './convex/users';
import * as original from '../../convex/users';
import { ROLE_MATRIX, type Permission } from '../../shared/functions/permissions';
const f = await createFixture(), owner = f.actor('owner-a');
const ref = (name: string) => makeFunctionReference<'mutation'>(name);
const keys = Object.fromEntries(['meeting', 'minutes', 'agenda', 'item', 'document', 'material'].map(name => [name, randomUUID()]));
await owner.mutation(f.meetingApply, { societyId: f.ids.societyA, command: { version: 1, kind: 'create-meeting', operationId: randomUUID(), meetingUuid: keys.meeting, baseRevision: 0, keys,
  title: 'Automatic membership materialization', notes: '', agendaTitle: 'Review', scheduledAt: '2026-11-15T10:00:00Z' } });
let checks = 0;
const results: Array<{ name: string; passed: boolean }> = [];
async function check(name: string, body: () => Promise<void>) { await body(); checks++; results.push({ name, passed: true }); console.log(`PASS ${name}`); }
async function rows() { return f.native.run(ctx => ctx.db.query('offlineMeetingDownloads').withIndex('by_actor', q => q.eq('actor_key', `${fixtureIssuer}|viewer-a`).eq('society_id', f.ids.societyA)).collect()); }
const upsertArgs = { id: f.ids.users['viewer-a'], societyId: f.ids.societyA, email: 'viewer-a@example.test', displayName: 'viewer-a', role: 'Viewer', status: 'Active' };
await check('Pilot registrations preserve every production argument/return validator and public mutation flag', async () => {
  for (const name of ['setRole', 'upsert', 'remove', 'securityDisable'] as const) {
    const production = original[name] as typeof hooked[typeof name];
    assert.equal(hooked[name].exportArgs(), production.exportArgs());
    assert.equal(hooked[name].exportReturns(), production.exportReturns());
    assert.equal(hooked[name].isPublic, true); assert.equal(hooked[name].isMutation, true);
  }
});
await check('Role promotion and demotion atomically change projected write capability without rebuild calls', async () => {
  assert.equal(JSON.parse((await rows())[0].payload).editable, false);
  await owner.mutation(ref('users:setRole'), { id: f.ids.users['viewer-a'], role: 'Director' });
  assert.equal(JSON.parse((await rows())[0].payload).editable, true);
  await owner.mutation(ref('users:setRole'), { id: f.ids.users['viewer-a'], role: 'Viewer' });
  assert.equal(JSON.parse((await rows())[0].payload).editable, false);
});
await check('Unauthorized role changes, forged actors, cross-workspace targets and last-Owner changes remain denied', async () => {
  for (const args of [{ id: f.ids.users['viewer-a'], role: 'Owner' }, { id: f.ids.users['viewer-a'], role: 'Owner', actingUserId: f.ids.users['owner-a'] }]) {
    await assert.rejects(() => f.actor('viewer-a').mutation(ref('users:setRole'), args));
  }
  await assert.rejects(() => f.actor('owner-b').mutation(ref('users:setRole'), { id: f.ids.users['viewer-a'], role: 'Owner' }));
  await assert.rejects(() => owner.mutation(ref('users:setRole'), { id: f.ids.users['owner-a'], role: 'Viewer' }), /last Active Owner/);
  await assert.rejects(() => owner.mutation(ref('users:remove'), { id: f.ids.users['owner-a'] }), /last Active Owner/);
  assert.equal(JSON.parse((await rows())[0].payload).editable, false);
});
await check('Upsert suspension and reactivation atomically remove and restore projections', async () => {
  await owner.mutation(ref('users:upsert'), { ...upsertArgs, status: 'Suspended' }); assert.equal((await rows()).length, 0);
  await owner.mutation(ref('users:upsert'), upsertArgs); assert.equal((await rows()).length, 1);
});
await check('Any required read-module denial clears only the affected actor while Owner commands still commit', async () => {
  const previous = ROLE_MATRIX.Viewer; let revision = 1;
  try {
    for (const permission of ['minutes:read', 'agendas:read', 'documents:read'] as Permission[]) {
      ROLE_MATRIX.Viewer = previous.filter(value => value !== permission);
      await owner.mutation(f.meetingApply, { societyId: f.ids.societyA, command: { version: 1, kind: 'edit-meeting', operationId: randomUUID(), meetingUuid: keys.meeting, baseRevision: revision,
        title: `Required gate ${permission}`, notes: '' } }); revision++;
      assert.equal((await rows()).length, 0);
      assert.equal((await owner.query(f.meetingSnapshot, { societyId: f.ids.societyA }))[0].revision, revision);
    }
  } finally { ROLE_MATRIX.Viewer = previous; }
  await owner.mutation(ref('users:upsert'), upsertArgs); assert.equal((await rows()).length, 1);
});
await check('Unexpected projection failures roll back the membership change and its activity atomically', async () => {
  const before = await f.native.run(async ctx => ({ aggregate: (await ctx.db.query('offlineMeetingAggregates').collect())[0], activity: (await ctx.db.query('activity').collect()).length }));
  await f.native.run(ctx => ctx.db.patch(before.aggregate._id, { mappings: 'broken-json' }));
  try {
    await assert.rejects(() => owner.mutation(ref('users:setRole'), { id: f.ids.users['viewer-a'], role: 'Director' }));
    await f.native.run(async ctx => {
      assert.equal((await ctx.db.get(f.ids.users['viewer-a'] as GenericId<'users'>))?.role, 'Viewer');
      assert.equal((await ctx.db.query('activity').collect()).length, before.activity);
    });
  } finally { await f.native.run(ctx => ctx.db.patch(before.aggregate._id, { mappings: before.aggregate.mappings })); }
});
await check('Security disable and remove clear projections without an explicit rebuild', async () => {
  await owner.mutation(ref('users:securityDisable'), { id: f.ids.users['viewer-a'], reason: 'Native revocation check' }); assert.equal((await rows()).length, 0);
  await assert.rejects(() => f.actor('viewer-a').query(f.meetingSnapshot, { societyId: f.ids.societyA }), /disabled/i);
  await owner.mutation(ref('users:upsert'), upsertArgs); assert.equal((await rows()).length, 1);
  await owner.mutation(ref('users:remove'), { id: f.ids.users['viewer-a'] }); assert.equal((await rows()).length, 0);
});
console.log(`${checks} automatic membership projection checks passed.`);
writeFileSync(new URL('../../artifacts/offline/automatic-role-invalidation.json', import.meta.url), JSON.stringify({ timestamp: new Date().toISOString(), passed: checks,
  runtime: 'convex-test native transaction oracle using production validators and authorized handlers', results,
  limitations: ['Native oracle injects identity; live protocol tests separately verify JWT authentication and replicated effects', 'Only the pilot exported user mutation paths have automatic invalidation; other ACL/identity/expiry paths remain release prerequisites'] }, null, 2) + '\n');
