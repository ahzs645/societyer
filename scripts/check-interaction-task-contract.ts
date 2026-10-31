/** S01/S02/R02/R03: real Convex and local handlers, wire clears, concurrency, staged journal. */
import assert from 'node:assert/strict';
import { convexTest } from 'convex-test';
import schema from '../convex/schema';
import { api } from '../convex/_generated/api';
import { betterAuthIssuer } from '../convex/lib/authIdentity';
import { LocalStoreDb, MemoryRowStore, PortableRuntime, makeCapabilities } from '../shared/portable/index';
import { PORTABLE_FUNCTIONS } from '../shared/functions/registry';
import { portableTestPrincipal, PORTABLE_TEST_AUTH_SUBJECT } from './portable-test-fixture';
import { TASK_CLEARABLE_FIELDS, taskEditBaseline, taskOptionalPatch, normalizedTaskPatch } from '../shared/taskEditing';

const now = '2026-10-31T12:00:00.000Z';
async function seed(db: any, issuer: string, subject: string) {
  const societyId = await db.insert('societies', { name: 'Synthetic interaction tests', isCharity: false, isMemberFunded: false, updatedAt: 0 });
  const foreignSocietyId = await db.insert('societies', { name: 'Synthetic other workspace', isCharity: false, isMemberFunded: false, updatedAt: 0 });
  const user = (scope: string, name: string, role = 'Owner') => db.insert('users', { societyId: scope, role, status: 'Active', displayName: name, email: `${name}@example.test`, authSubject: name === 'owner' ? subject : name, authIssuer: issuer, authProvider: 'better-auth', createdAtISO: now });
  const users = [await user(societyId, 'owner'), await user(societyId, 'second')];
  await user(societyId, 'viewer', 'Viewer');
  const foreignUser = await user(foreignSocietyId, 'foreign');
  const meetingId = await db.insert('meetings', { societyId, type: 'Board', title: 'Source', scheduledAt: now, electronic: false, status: 'Scheduled', attendeeIds: [] });
  const agendaId = await db.insert('agendas', { societyId, meetingId, title: 'Agenda', status: 'Draft', createdAtISO: now, updatedAtISO: now });
  const agendaItemId = await db.insert('agendaItems', { societyId, agendaId, title: 'Business', type: 'discussion', order: 0, createdAtISO: now });
  const assigneePersonId = await db.insert('peopleDirectory', { societyId, fullName: 'Synthetic Person', searchName: 'synthetic person', createdAtISO: now, updatedAtISO: now });
  const committeeId = await db.insert('committees', { societyId, name: 'Committee', cadence: 'Monthly', color: 'blue', status: 'Active', createdAtISO: now });
  const goalId = await db.insert('goals', { societyId, title: 'Goal', category: 'Other', status: 'Active', startDate: '2026-01-01', targetDate: '2027-01-01', progressPercent: 0, milestones: [], keyResults: [], createdAtISO: now });
  const filingId = await db.insert('filings', { societyId, kind: 'AnnualReport', dueDate: '2027-01-01', status: 'Draft' });
  const workflowId = await db.insert('workflows', { societyId, recipe: 'test', name: 'Workflow', status: 'paused', trigger: { kind: 'manual' } });
  const documentId = await db.insert('documents', { societyId, title: 'Document', category: 'Other', tags: [], flaggedForDeletion: false, createdAtISO: now });
  const commitmentId = await db.insert('commitments', { societyId, title: 'Commitment', category: 'Other', requirement: 'Review', cadence: 'Annual', status: 'Active', createdAtISO: now, updatedAtISO: now });
  const values = { description: 'Description', assignee: 'Source name', assigneePersonId, dueDate: '2027-01-01', committeeId, goalId, meetingId, agendaItemId, filingId, workflowId, documentId, commitmentId, eventId: `commitment:${commitmentId}`, completionNote: 'Evidence' };
  const id = await db.insert('tasks', { societyId, title: 'Task', status: 'Todo', priority: 'Medium', responsibleUserIds: users, tags: [], checklist: [{ id: 'one', title: 'First step', done: false }], createdAtISO: now, ...values });
  return { societyId, users, foreignUser, values, id };
}
const issuer = betterAuthIssuer();
const t = convexTest(schema, {
  './_generated/api.js': () => import('../convex/_generated/api.js'),
  './_generated/server.js': () => import('../convex/_generated/server.js'),
  './tasks.js': () => import('../convex/tasks'),
} as any);
const native = await t.run(ctx => seed(ctx.db, issuer, 'owner'));
const owner = t.withIdentity({ subject: 'owner', issuer });
const viewer = t.withIdentity({ subject: 'viewer', issuer });
const db = new LocalStoreDb(new MemoryRowStore());
const local = await db.transaction(() => seed(db, 'https://portable-fixture.test', PORTABLE_TEST_AUTH_SUBJECT));
const rt = new PortableRuntime({ db, capabilities: makeCapabilities({}), principalProvider: portableTestPrincipal }).registerAll(PORTABLE_FUNCTIONS);

for (const [label, fixture, read, update] of [
  ['Convex', native, () => t.run(ctx => ctx.db.get(native.id)), (args: any) => owner.mutation(api.tasks.update, args)],
  ['local', local, () => db.get(local.id), (args: any) => rt.runMutation('tasks:update', args)],
] as const) {
  const initial: any = await read();
  await update({ id: fixture.id, expected: taskEditBaseline(initial), patch: { title: 'Only the title changed' } });
  let stored: any = await read();
  assert.deepEqual(stored.responsibleUserIds, fixture.users, `${label}: title-only save preserves every user`);
  assert.equal(stored.dueDate, fixture.values.dueDate, `${label}: omitted values remain`);
  await assert.rejects(() => update({ id: fixture.id, expected: taskEditBaseline(initial), patch: { title: 'Stale edit' } }), /changed since/);
  await assert.rejects(() => update({ id: fixture.id, patch: { responsibleUserIds: [fixture.foreignUser] } }));
  assert.equal((await read())?.title, 'Only the title changed');
  // These inputs survive an actual JSON wire round trip; omission must not mean delete.
  for (const field of TASK_CLEARABLE_FIELDS) {
    await update(JSON.parse(JSON.stringify({ id: fixture.id, expected: taskEditBaseline((await read()) as any), patch: { clearFields: [field] } })));
    assert.equal((await read())?.[field], undefined, `${label}: ${field} is really absent on readback`);
  }
  stored = await read();
  assert.deepEqual(stored.responsibleUserIds, fixture.users);
  await update({ id: fixture.id, patch: { responsibleUserIds: [fixture.users[1]] } });
  assert.deepEqual((await read())?.responsibleUserIds, [fixture.users[1]]);
  await update({ id: fixture.id, patch: { responsibleUserIds: [], checklist: [{ id: 'one', title: 'Renamed step', done: true }] } });
  assert.deepEqual((await read())?.responsibleUserIds, []);
  assert.equal((await read())?.checklist?.[0]?.done, true);
  await assert.rejects(() => update({ id: fixture.id, patch: { dueDate: '2027-01-01', clearFields: ['dueDate'] } }), /set and clear/);
  await assert.rejects(() => update({ id: fixture.id, patch: { clearFields: ['societyId'] } }));
  assert.equal((await read())?.societyId, fixture.societyId);
  console.log(`✓ ${label}: all ${TASK_CLEARABLE_FIELDS.length} optional fields clear, omitted fields and multi-assignees survive, stale/foreign/malformed writes reject`);
}
await assert.rejects(() => viewer.mutation(api.tasks.update, { id: native.id, patch: { clearFields: ['description'] } }));
const form = Object.fromEntries(TASK_CLEARABLE_FIELDS.map(field => [field, ''])) as any;
form.agendaItemId = 'must-clear-without-a-meeting';
const patch = taskOptionalPatch(form);
assert.deepEqual(new Set(patch.clearFields), new Set(TASK_CLEARABLE_FIELDS));
assert.equal(normalizedTaskPatch(patch).agendaItemId, undefined);
assert.deepEqual(normalizedTaskPatch({ description: undefined }), {});
assert.throws(() => normalizedTaskPatch({ clearFields: ['__proto__'] }));
console.log('Interaction task contract checks passed.');
