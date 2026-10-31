/** R01: real handler rollback, request replay, concurrent submissions and source drift. */
import assert from 'node:assert/strict';
import { convexTest } from 'convex-test';
import schema from '../convex/schema';
import { api } from '../convex/_generated/api';
import { betterAuthIssuer } from '../convex/lib/authIdentity';
import { toPortableMutationCtx } from '../convex/lib/portable';
import { createPortable } from '../shared/functions/meetings';
import { motionRowToEmbedded } from '../shared/minutesMotions';
import { FOLLOW_UP_RECEIPT_FIELDS, followUpMotionFingerprint, followUpMotionSelection } from '../shared/followUpScheduling';
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
// The replay receipt is a digest, never a second copy of the request, and readers never see it.
const SECRET = 'Synthetic confidential wording 0042';
for (const [label, f, run, schedule, get, list] of [
  ['Convex', fixture, (fn: (db: any) => Promise<any>) => t.run(ctx => fn(ctx.db)), (args: any) => owner.mutation(api.meetings.create, args),
    (id: string) => owner.query(api.meetings.get, { id: id as any }), (societyId: string) => owner.query(api.meetings.list, { societyId: societyId as any })],
  ['local', local, (fn: (db: any) => Promise<any>) => db.transaction(() => fn(db)), (args: any) => rt.runMutation('meetings:create', args),
    (id: string) => rt.runQuery('meetings:get', { id }), (societyId: string) => rt.runQuery('meetings:list', { societyId })],
] as const) {
  const args = { ...argsFor(f, 'interaction-receipt-key-000009'), notes: SECRET, remotePasscode: SECRET };
  const id = await schedule(args);
  const stored = await run(sourceDb => sourceDb.get(id));
  assert.match(String(stored.followUpRequestDigest), /^[0-9a-f]{64}$/, `${label}: receipt stores a request digest`);
  assert.equal(stored.followUpRequestJson, undefined, `${label}: receipt stores no copy of the request`);
  for (const field of FOLLOW_UP_RECEIPT_FIELDS) assert.ok(!String(stored[field] ?? '').includes(SECRET), `${label}: ${field} holds no request wording`);
  assert.equal(await schedule(args), id, `${label}: digest receipt replays the original meeting`);
  await assert.rejects(() => schedule({ ...args, notes: 'Changed wording' }), /different details/);
  const read = await get(id) as any;
  const listed = (await list(f.societyId) as any[]).find(row => String(row._id) === String(id));
  assert.ok(listed, `${label}: scheduled meeting is listed`);
  for (const field of FOLLOW_UP_RECEIPT_FIELDS) {
    assert.ok(!(field in read), `${label}: meetings:get omits ${field}`);
    assert.ok(!(field in listed), `${label}: meetings:list omits ${field}`);
  }
  // Rows written before the digest kept a JSON copy: they still replay and still never reach readers.
  await run(sourceDb => sourceDb.patch(id, { followUpRequestDigest: undefined, followUpRequestJson: JSON.stringify(args) }));
  assert.equal((await run(sourceDb => sourceDb.get(id))).followUpRequestDigest, undefined, `${label}: fixture exercises the legacy receipt path`);
  assert.equal(await schedule(args), id, `${label}: legacy JSON receipt still replays`);
  await assert.rejects(() => schedule({ ...args, title: 'Changed legacy payload' }), /different details/);
  assert.ok(!('followUpRequestJson' in (await get(id) as any)), `${label}: legacy receipt copy is withheld from readers`);
  console.log(`✓ ${label}: digest-only replay receipt, legacy receipt replay, receipts withheld from get and list`);
}
// Draft minutes use ordered first-class rows, not the retired embedded array.
async function seedNativeSource(db: any, societyId: string) {
  const meetingId = await db.insert('meetings', { societyId, title: 'Native source', type: 'Board', scheduledAt: now, electronic: false, status: 'Held', attendeeIds: [] });
  const minutesId = await db.insert('minutes', { societyId, meetingId, heldAt: now, attendees: [], absent: [], quorumMet: false, discussion: '', decisions: [], actionItems: [] });
  const motionIds: string[] = [];
  for (const text of ['Native selected business', 'Other native business']) motionIds.push(await db.insert('motions', {
    societyId, minutesId, primaryMeetingId: meetingId, text, status: 'Deferred', source: 'minutes', createdAtISO: now, updatedAtISO: now,
  }));
  await db.patch(minutesId, { motionIds });
  return { societyId, meetingId, minutesId, motionIds, display: await Promise.all(motionIds.map(async id => motionRowToEmbedded(await db.get(id)))) };
}
for (const [label, f, run, schedule] of [
  ['Convex', fixture, (fn: (db: any) => Promise<any>) => t.run(ctx => fn(ctx.db)), (args: any) => owner.mutation(api.meetings.create, args)],
  ['local', local, (fn: (db: any) => Promise<any>) => db.transaction(() => fn(db)), (args: any) => rt.runMutation('meetings:create', args)],
] as const) {
  const native = await run(sourceDb => seedNativeSource(sourceDb, f.societyId));
  const sourceMotionFingerprint = await followUpMotionFingerprint(followUpMotionSelection(native.display, [0]));
  const args = { ...argsFor(native, 'interaction-native-key-000007'), followUp: {
    requestId: 'interaction-native-key-000007', sourceMeetingId: native.meetingId,
    sourceMinutesId: native.minutesId, motionIndexes: [0], sourceMotionFingerprint,
  } };
  const targetId = await schedule(args);
  const carried = await run(async sourceDb => (await sourceDb.query('motions').collect()).find((row: any) => row.targetMeetingId === targetId && row.sourceMinutesId === native.minutesId));
  assert.equal(carried?.text, 'Native selected business', `${label}: UI display and transactional handler fingerprint the same native row`);
  await run(sourceDb => sourceDb.patch(native.motionIds[0], { text: 'Changed native business' }));
  const before = await run(counts);
  await assert.rejects(() => schedule({ ...args, followUp: { ...args.followUp, requestId: 'interaction-native-key-000008' } }), /motions changed/);
  assert.deepEqual(await run(counts), before, `${label}: source drift writes no partial graph`);
  console.log(`✓ ${label}: native ordered-motion selection and changed-source rejection`);
}
console.log('Interaction scheduling checks passed.');
