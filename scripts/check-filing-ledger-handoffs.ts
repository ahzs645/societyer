import assert from 'node:assert/strict';
import { convexTest } from 'convex-test';
import schema from '../convex/schema';
import { api } from '../convex/_generated/api';
import { betterAuthIssuer } from '../convex/lib/authIdentity';
import { toPortableMutationCtx } from '../convex/lib/portable';
import { markFiledPortable, updatePortable } from '../shared/functions/filings';
import { upsertPortable } from '../shared/functions/annualFilings';
import { StaticConvexClient } from '../src/lib/staticConvex';

const native = convexTest(schema, {
  './_generated/api.js': () => import('../convex/_generated/api.js'),
  './_generated/server.js': () => import('../convex/_generated/server.js'),
  './filings.js': () => import('../convex/filings'),
  './importSessions.js': () => import('../convex/importSessions'),
  './annualFilings.js': () => import('../convex/annualFilings'),
});
const issuer = betterAuthIssuer();
const nowISO = new Date().toISOString();
const fixture = await native.run(async ctx => {
  const societyId = await ctx.db.insert('societies', { name: 'Ledger handoffs fixture', jurisdictionCode: 'CA-BC', isCharity: false, isMemberFunded: false, updatedAt: 0 });
  const foreignId = await ctx.db.insert('societies', { name: 'Foreign ledger fixture', isCharity: false, isMemberFunded: false, updatedAt: 0 });
  const users: Record<string, any> = {};
  for (const role of ['Owner', 'Admin', 'Director', 'Member', 'Viewer']) users[role] = await ctx.db.insert('users', { societyId, displayName: role, email: `${role}@ledger.invalid`, role, status: 'Active', authIssuer: issuer, authSubject: role, createdAtISO: nowISO });
  const foreignSource = await ctx.db.insert('filings', { societyId: foreignId, kind: 'BCSocietyAnnualReport', jurisdictionCode: 'CA-BC', periodLabel: '2026', dueDate: '2026-12-31', status: 'Upcoming' });
  const foreignDoc = await ctx.db.insert('documents', { societyId: foreignId, title: 'Foreign receipt', category: 'Filing', tags: [], flaggedForDeletion: false, createdAtISO: nowISO });
  return { societyId, foreignId, foreignSource, foreignDoc, users };
});
const owner = native.withIdentity({ issuer, subject: 'Owner' });
const annualArgs = { societyId: fixture.societyId, jurisdiction: 'CA-BC', year: '2026', filed: false, nowISO };
const filingArgs = { societyId: fixture.societyId, kind: 'BCSocietyAnnualReport', jurisdictionCode: 'CA-BC', periodLabel: '2026', dueDate: '2026-12-31', status: 'Upcoming' };
await assert.rejects(() => owner.mutation(api.filings.create, { ...filingArgs, status: 'Filed' }), /filed date/);
const filingId = await owner.mutation(api.filings.create, filingArgs);
await assert.rejects(() => owner.mutation(api.filings.update, { id: filingId, patch: { status: 'Filed' } }), /filed date/);
await assert.rejects(() => owner.mutation(api.filings.markFiled, { id: filingId, filedAt: '2026-02-30', submissionMethod: 'ManualPortal', confirmationNumber: 'Ref' }), /valid filed date/);
await assert.rejects(() => owner.mutation(api.filings.markFiled, { id: filingId, filedAt: '2026-10-05', submissionMethod: 'ManualPortal', confirmationNumber: '   ' }), /evidence/);
await assert.rejects(() => owner.mutation(api.filings.markFiled, { id: filingId, filedAt: '2026-10-05', submissionMethod: 'ManualPortal', receiptDocumentId: fixture.foreignDoc }), /not found/);
await assert.rejects(() => owner.mutation(api.annualFilings.upsert, { ...annualArgs, sourceFilingId: fixture.foreignSource }), /not found/);
await assert.rejects(() => owner.mutation(api.annualFilings.upsert, { ...annualArgs, year: 'NaN' }), /four-digit/);
await assert.rejects(() => owner.mutation(api.annualFilings.upsert, { ...annualArgs, filed: true, filedOn: '2026-02-30' }), /valid filed-on/);
assert.equal((await owner.query(api.annualFilings.list, { societyId: fixture.societyId })).length, 0);
for (const role of ['Member', 'Viewer']) {
  const actor = native.withIdentity({ issuer, subject: role });
  await assert.rejects(() => actor.mutation(api.annualFilings.upsert, annualArgs), /Permission filings:write/);
  await assert.rejects(() => actor.mutation(api.filings.markFiled, { id: filingId, filedAt: '2026-10-05', submissionMethod: 'ManualPortal', evidenceNotes: 'Self-reported' }), /Permission filings:write/);
}
await assert.rejects(() => owner.mutation(api.annualFilings.upsert, { ...annualArgs, societyId: fixture.foreignId }), /membership/);
const linked = { ...annualArgs, sourceFilingId: filingId };
const ids = await Promise.all([owner.mutation(api.annualFilings.upsert, linked), owner.mutation(api.annualFilings.upsert, linked)]);
assert.equal(ids[0], ids[1]);
await assert.rejects(() => owner.mutation(api.annualFilings.upsert, annualArgs), /already tracks/);
assert.equal((await owner.query(api.annualFilings.list, { societyId: fixture.societyId })).length, 1);
await owner.mutation(api.filings.markFiled, { id: filingId, filedAt: '2026-10-05', submissionMethod: 'ManualPortal', evidenceNotes: 'Human records completion after official portal filing; not independent verification.' });
const evidenceId = await native.run(ctx => ctx.db.insert('documents', { societyId: fixture.societyId, title: 'Current filing evidence', category: 'Filing', tags: [], flaggedForDeletion: false, createdAtISO: nowISO }));
await owner.mutation(api.filings.update, { id: filingId, patch: { receiptDocumentId: evidenceId } });
await native.run(ctx => ctx.db.patch(evidenceId, { archivedAtISO: nowISO }));
await native.run(async ctx => {
  const p = await toPortableMutationCtx(ctx);
  const reviewer = { ...p, principal: { kind: 'user' as const, runtime: 'test' as const, assurance: 'verified-jwt' as const, issuer, subject: 'Director' } };
  // Handler defense independently rechecks current ACL even when an old record
  // supplies the document reference instead of the incoming arguments.
  await assert.rejects(() => markFiledPortable(reviewer, { id: filingId, filedAt: '2026-10-05', submissionMethod: 'ManualPortal' }), /documents not found/);
  await assert.rejects(() => updatePortable(reviewer, { id: filingId, patch: { notes: 'Reattestation after evidence was archived' } }), /documents not found/);
  const scoped = { ...p, principal: { kind: 'service' as const, runtime: 'test' as const, assurance: 'trusted-internal' as const, societyId: String(fixture.societyId), subject: 'filing-service', actorUserId: String(fixture.users.Owner), scopes: ['filings:write'] } };
  await assert.rejects(() => markFiledPortable(scoped, { id: filingId, filedAt: '2026-10-05', submissionMethod: 'ManualPortal' }), /Service scope documents:read/);
});
await native.run(ctx => ctx.db.patch(evidenceId, { archivedAtISO: undefined }));
let ledger = (await owner.query(api.annualFilings.list, { societyId: fixture.societyId }))[0];
assert.equal(ledger.filed, true); assert.equal(ledger.filedOn, '2026-10-05');
await owner.mutation(api.filings.update, { id: filingId, patch: { status: 'Upcoming' } });
ledger = (await owner.query(api.annualFilings.list, { societyId: fixture.societyId }))[0];
assert.equal(ledger.filed, false); assert.equal(ledger.filedOn, undefined);
assert.deepEqual(await owner.query(api.annualFilings.outstanding, { societyId: fixture.societyId, jurisdiction: 'CA-BC', fromYear: '2026', toYear: '2026' }), ['2026']);
await native.run(async ctx => {
  const p = await toPortableMutationCtx(ctx);
  const scoped = (scopes: string[]) => ({ ...p, principal: { kind: 'service' as const, runtime: 'test' as const, assurance: 'trusted-internal' as const, subject: 'ledger-service', societyId: String(fixture.societyId), actorUserId: String(fixture.users.Owner), scopes } });
  await assert.rejects(() => upsertPortable(scoped(['filings:read']), linked), /Service scope filings:write/);
  await assert.rejects(() => upsertPortable(scoped(['filings:write']), linked), /Service scope filings:read/);
  assert.equal(await upsertPortable(scoped(['filings:read', 'filings:write']), linked), ids[0]);
});
await assert.rejects(() => owner.mutation(api.filings.importBcRegistryHistory, { societyId: fixture.societyId, records: [{ kind: 'BCSocietyAnnualReport', dueDate: '2026-12-31', periodLabel: '2025', status: 'Upcoming', sourceExternalIds: ['fixture:first'] }, { kind: 'BCSocietyAnnualReport', dueDate: '2026-12-31', status: 'Filed', sourceExternalIds: ['fixture:invalid'] }] }), /filed date/);
assert.equal((await owner.query(api.filings.list, { societyId: fixture.societyId })).length, 1, 'Invalid second imported row must not partially write the first.');
await owner.mutation(api.filings.remove, { id: filingId });
ledger = (await owner.query(api.annualFilings.list, { societyId: fixture.societyId }))[0];
assert.equal(ledger.sourceMissing, true); assert.equal(ledger.filed, false);
assert.equal((await native.run(ctx => ctx.db.get(fixture.societyId)))?.incorporationNumber, undefined);

const staged = await owner.mutation(api.importSessions.createFromBundle, { societyId: fixture.societyId, name: 'Filing validation staging', bundle: { filings: [
  { kind: 'BCSocietyAnnualReport', periodLabel: '2024', dueDate: '2024-12-31', status: 'Upcoming', sourceExternalIds: ['fixture:first'] },
  { kind: 'BCSocietyAnnualReport', periodLabel: '2025', dueDate: '2025-12-31', status: 'Filed', sourceExternalIds: ['fixture:second'] },
] } });
const stagedState = await owner.query(api.importSessions.get, { sessionId: staged });
for (const record of stagedState.records) await owner.mutation(api.importSessions.updateRecord, { recordId: record._id, status: 'Approved' });
const beforeStaged = await native.run(async ctx => ({ docs: (await ctx.db.query('documents').collect()).length, filings: (await ctx.db.query('filings').collect()).length }));
await assert.rejects(() => owner.mutation(api.importSessions.applyApprovedSectionRecords, { sessionId: staged }), /filed date/);
assert.deepEqual(await native.run(async ctx => ({ docs: (await ctx.db.query('documents').collect()).length, filings: (await ctx.db.query('filings').collect()).length })), beforeStaged, 'Invalid later staged filing must roll back earlier records and generated source placeholders.');
const invalid = stagedState.records.find((record: any) => record.payload.periodLabel === '2025');
await owner.mutation(api.importSessions.updateRecord, { recordId: invalid._id, status: 'Approved', payload: { ...invalid.payload, filedAt: '2025-12-15', submissionMethod: 'Imported manual filing record' } });
assert.equal((await owner.mutation(api.importSessions.applyApprovedSectionRecords, { sessionId: staged })).total, 2);
assert.equal((await owner.mutation(api.importSessions.applyApprovedSectionRecords, { sessionId: staged })).total, 0, 'Repeated staged import must not duplicate applied filings.');

const seed = await native.run(async ctx => ({ societies: await ctx.db.query('societies').collect(), users: await ctx.db.query('users').collect() }));
const local = new StaticConvexClient({ seed, databaseName: `ledger-handoffs-${Date.now()}` });
try {
  const localFiling = await local.mutation('filings:create', filingArgs);
  const localLinked = { ...annualArgs, sourceFilingId: localFiling };
  const localId = await local.mutation('annualFilings:upsert', localLinked);
  assert.equal(await local.mutation('annualFilings:upsert', localLinked), localId);
  await local.mutation('filings:markFiled', { id: localFiling, filedAt: '2026-10-05', submissionMethod: 'ManualPortal', evidenceNotes: 'Local user records a completed external filing.' });
  assert.equal((await local.query('annualFilings:list', { societyId: fixture.societyId }) as any[])[0].filed, true);
  await assert.rejects(() => local.mutation('filings:update', { id: localFiling, patch: { filedAt: '2026-02-30' } }), /valid filed date/);
  const localSnapshot = local.exportLocalWorkspaceSnapshot();
  const restored = new StaticConvexClient({ seed: { societies: [] }, databaseName: `ledger-restored-${Date.now()}` });
  try { await restored.importLocalWorkspaceSnapshot(localSnapshot); assert.equal((await restored.query('annualFilings:list', { societyId: fixture.societyId }) as any[])[0].filed, true); } finally { restored.close(); }
} finally { local.close(); }
console.log('PASS filing-ledger handoffs: native/local/backup links; current derived status and missing-source safety; duplicate retry identity; role/tenant/service denial; filed-date/evidence validation on all writes and existing evidence ACL rechecks; invalid direct/staged batches zero writes and staged retry no duplicates; no incorporation verification.');
