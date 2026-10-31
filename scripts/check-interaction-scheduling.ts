/** R01: real handler rollback, request replay, concurrent submissions and source drift. */
import assert from 'node:assert/strict';
import { convexTest } from 'convex-test';
import schema from '../convex/schema';
import { api } from '../convex/_generated/api';
import { betterAuthIssuer } from '../convex/lib/authIdentity';
import { toPortableMutationCtx } from '../convex/lib/portable';
import { createPortable } from '../shared/functions/meetings';
import { followUpMotionFingerprint, followUpMotionSelection } from '../shared/followUpScheduling';
import { LocalStoreDb, MemoryRowStore, PortableRuntime, makeCapabilities } from '../shared/portable/index';
import { PORTABLE_FUNCTIONS } from '../shared/functions/registry';
import { portableTestPrincipal, PORTABLE_TEST_AUTH_SUBJECT } from './portable-test-fixture';
const now = '2026-10-01T12:00:00Z';
const sourceMotions = [{ text: 'Review synthetic deferred business', outcome: 'Deferred' }];
async function seed(db: any, issuer: string, subject: string) {
  const societyId = await db.insert('societies', { name: 'Synthetic scheduling', isCharity: false, isMemberFunded: false, updatedAt: 0 });
  for (const [authSubject, role] of [[subject, 'Owner'], ['viewer', 'Viewer'], ['other-owner', 'Owner']]) {
    await db.insert('users', { societyId, email: `${role}@example.test`, displayName: role, role, status: 'Active', authSubject, authIssuer: issuer, authProvider: 'better-auth', createdAtISO: now });
  }
  const meetingId = await db.insert('meetings', { societyId, title: 'Source meeting', type: 'Board', scheduledAt: now, electronic: false, status: 'Held', attendeeIds: [] });
  const minutesId = await db.insert('minutes', { societyId, meetingId, heldAt: now, attendees: [], absent: [], quorumMet: false, discussion: '', decisions: [], actionItems: [], approvedAt: now, motionSnapshots: sourceMotions });
  const otherMeeting = await db.insert('meetings', { societyId, title: 'Other meeting', type: 'Board', scheduledAt: now, electronic: false, status: 'Held', attendeeIds: [] });
  return { societyId, meetingId, minutesId, otherMeeting };
}
function injectCarryFailure(ctx: any) {
  return { ...ctx, db: new Proxy(ctx.db, { get(target, property) {
    if (property === 'insert') return async (table: string, row: any) => {
      if (table === 'motions' && row.sourceMinutesId) throw new Error('Injected carry-forward failure after meeting creation');
      return target.insert(table, row);
    };
    const value = Reflect.get(target, property); return typeof value === 'function' ? value.bind(target) : value;
  } }) };
}
const tables = ['meetings', 'minutes', 'agendas', 'agendaItems', 'motions', 'activity'];
const counts = async (db: any) => Object.fromEntries(await Promise.all(tables.map(async table => [table, (await db.query(table).collect()).length])));
const issuer = betterAuthIssuer();
const t = convexTest(schema, { './_generated/api.js': () => import('../convex/_generated/api.js'), './_generated/server.js': () => import('../convex/_generated/server.js'), './meetings.js': () => import('../convex/meetings') } as any);
const fixture = await t.run(ctx => seed(ctx.db, issuer, 'owner'));
const owner = t.withIdentity({ subject: 'owner', issuer });
const viewer = t.withIdentity({ subject: 'viewer', issuer });
const otherOwner = t.withIdentity({ subject: 'other-owner', issuer });
const db = new LocalStoreDb(new MemoryRowStore());
const local = await db.transaction(() => seed(db, 'https://portable-fixture.test', PORTABLE_TEST_AUTH_SUBJECT));
const rt = new PortableRuntime({ db, capabilities: makeCapabilities({}), principalProvider: portableTestPrincipal }).registerAll(PORTABLE_FUNCTIONS);
const createDef: any = PORTABLE_FUNCTIONS.find(def => def.name === 'meetings:create');
const sourceMotionFingerprint = await followUpMotionFingerprint(followUpMotionSelection(sourceMotions, [0]));
const argsFor = (f: typeof fixture, requestId: string) => ({ societyId: f.societyId, title: 'Follow-up synthetic meeting', type: 'Board', scheduledAt: '2026-11-28T12:00:00Z', electronic: false, status: 'Scheduled', attendeeIds: [], agendaJson: JSON.stringify([{ title: 'Minutes approval', type: 'motion', motionText: 'Approve previous minutes', adoptsMinutesId: f.minutesId }]), followUp: { requestId, sourceMeetingId: f.meetingId, sourceMinutesId: f.minutesId, motionIndexes: [0], sourceMotionFingerprint } });
for (const [label, f, count, schedule, fail] of [
  ['Convex', fixture, () => t.run(ctx => counts(ctx.db)), (args: any) => owner.mutation(api.meetings.create, args), (args: any) => owner.run(async ctx => createPortable(injectCarryFailure(await toPortableMutationCtx(ctx)), args))],
  ['local', local, () => counts(db), (args: any) => rt.runMutation('meetings:create', args), async (args: any) => {
    rt.register({ ...createDef, handler: (ctx: any, input: any) => createPortable(injectCarryFailure(ctx), input) });
    try { return await rt.runMutation('meetings:create', args); } finally { rt.register(createDef); }
  }],
] as const) {
  const args = argsFor(f, 'interaction-replay-key-000001');
  const before = await count();
  await assert.rejects(() => fail(args), /Injected carry-forward/);
  assert.deepEqual(await count(), before, `${label}: failure rolls back the entire meeting/minutes/agenda/motion graph`);
  const id = await schedule(args);
  const saved = await count();
  assert.equal(saved.meetings, before.meetings + 1);
  assert.equal(saved.minutes, before.minutes + 1);
  assert.equal(await schedule(args), id, `${label}: retry after a lost response returns the original meeting`);
  assert.deepEqual(await count(), saved);
  await assert.rejects(() => schedule({ ...args, title: 'Changed payload with old key' }), /different details/);
  await assert.rejects(() => schedule({ ...args, followUp: { ...args.followUp, requestId: 'interaction-other-key-000002', sourceMeetingId: f.otherMeeting } }), /different meeting/);
  await assert.rejects(() => schedule({ ...args, followUp: { ...args.followUp, requestId: 'interaction-other-key-000003', motionIndexes: [99] } }), /no longer available/);
  await assert.rejects(() => schedule({ ...args, followUp: { ...args.followUp, requestId: 'interaction-other-key-000004', sourceMotionFingerprint: 'stale' } }), /motions changed/);
  assert.deepEqual(await count(), saved);
  const simultaneous = argsFor(f, 'interaction-concurrent-000005');
  const ids = await Promise.all([schedule(simultaneous), schedule(simultaneous)]);
  assert.equal(ids[0], ids[1]);
  assert.equal((await count()).meetings, saved.meetings + 1);
  console.log(`✓ ${label}: injected second-stage rollback, exact replay, concurrent claims, changed payload and stale-source rejection`);
}
await assert.rejects(() => viewer.mutation(api.meetings.create, argsFor(fixture, 'interaction-viewer-key-000006')));
await assert.rejects(() => otherOwner.mutation(api.meetings.create, argsFor(fixture, 'interaction-replay-key-000001')), /different details/);
console.log('Interaction scheduling checks passed.');
