import assert from 'node:assert/strict';
import { convexTest } from 'convex-test';
import schema from '../convex/schema';
import { api } from '../convex/_generated/api';
import { betterAuthIssuer } from '../convex/lib/authIdentity';
import { toPortableMutationCtx } from '../convex/lib/portable';
import { requireFunctionAction } from '../shared/functions/actionPolicy';
import { applyApprovedSectionRecordsPortable } from '../shared/functions/importSessions';

const native = convexTest(schema, {
  './_generated/api.js': () => import('../convex/_generated/api.js'),
  './_generated/server.js': () => import('../convex/_generated/server.js'),
  './importSessions.js': () => import('../convex/importSessions'),
});
const issuer = betterAuthIssuer();
const fixture = await native.run(async ctx => {
  const societyId = await ctx.db.insert('societies', { name: 'Import authority fixture', isCharity: false, isMemberFunded: false, updatedAt: 0 });
  const foreignId = await ctx.db.insert('societies', { name: 'Foreign import fixture', isCharity: false, isMemberFunded: false, updatedAt: 0 });
  const users: Record<string, any> = {};
  for (const role of ['Owner', 'Director']) users[role] = await ctx.db.insert('users', { societyId, role, status: 'Active', displayName: role, email: `${role}@fixture.invalid`, authIssuer: issuer, authSubject: role, createdAtISO: new Date().toISOString() });
  const document = { category: 'Evidence', title: 'Synthetic fixture', flaggedForDeletion: false, createdAtISO: new Date().toISOString() };
  const sourceId = await ctx.db.insert('documents', { ...document, societyId: foreignId, tags: [] });
  const revokedId = await ctx.db.insert('documents', { ...document, societyId, tags: [], archivedAtISO: new Date().toISOString() });
  const sessions: Record<string, any> = {};
  async function session(name: string, kinds: Array<{ kind: string; payload?: any; source?: string }>, linkedSource?: any) {
    const sessionId = await ctx.db.insert('documents', { ...document, societyId, category: 'Import Session', tags: ['import-session'], content: JSON.stringify({ name }) });
    for (const record of kinds) await ctx.db.insert('documents', { ...document, societyId, category: 'Import Candidate', tags: ['import-session', 'import-session-record'], importSessionId: sessionId, importRecordKind: record.kind, content: JSON.stringify({ sessionId, recordKind: record.kind, status: 'Approved', targetModule: 'documents', payload: { name: 'Synthetic person', fullName: 'Synthetic person', fiscalYear: '2026', periodEnd: '2026-10-05', startDate: '2026-10-05', revenueCents: 12300, expensesCents: 7500, netAssetsCents: 4800, ...record.payload }, importedTargets: {}, sourceExternalIds: record.source ? [record.source] : [] }) });
    if (linkedSource) await ctx.db.insert('documents', { ...document, societyId, category: 'Import Candidate', tags: ['import-session', 'import-session-record'], importSessionId: sessionId, importRecordKind: 'documentCandidate', content: JSON.stringify({ sessionId, recordKind: 'documentCandidate', status: 'Approved', payload: { externalId: 'file:linked' }, importedTargets: { documents: linkedSource }, sourceExternalIds: ['file:linked'] }) });
    sessions[name] = sessionId;
  }
  await session('mixed', [{ kind: 'financialStatement', source: 'file:new' }, { kind: 'employee' }]);
  await session('director', [{ kind: 'roleHolder', payload: { roleType: 'director' } }]);
  await session('controller', [{ kind: 'roleHolder', payload: { roleType: 'controller' } }]);
  await session('unknown', [{ kind: 'futureProtectedSection' }]);
  await session('foreign', [{ kind: 'financialStatement' }, { kind: 'employee', source: 'file:linked' }], sourceId);
  await session('missing', [{ kind: 'financialStatement' }, { kind: 'employee', source: 'file:linked' }], revokedId);
  await ctx.db.delete(revokedId);
  return { societyId, users, sessions };
});
const base = ['settings:write', 'documents:read', 'documents:write'];
let denied = 0;
async function deny(name: string, scopes: string[], expected: RegExp) {
  await native.run(async ctx => {
    const portable = await toPortableMutationCtx(ctx);
    let writes = 0;
    const db = new Proxy(portable.db, { get(target, key) { const value = Reflect.get(target, key); if (['insert', 'patch', 'delete', 'replace'].includes(String(key))) return (...args: any[]) => { writes++; return value.apply(target, args); }; return typeof value === 'function' ? value.bind(target) : value; } });
    const scoped = { ...portable, db, principal: { kind: 'service' as const, runtime: 'test' as const, assurance: 'trusted-internal' as const, subject: 'scoped-import-service', societyId: String(fixture.societyId), actorUserId: String(fixture.users.Owner), scopes } };
    // Exercise public action policy and then the actual native-backed handler.
    await assert.rejects(async () => { await requireFunctionAction(scoped, 'importSessions:applyApprovedSectionRecords', 'mutation', { sessionId: fixture.sessions[name] }); await applyApprovedSectionRecordsPortable(scoped, { sessionId: fixture.sessions[name] }); }, expected);
    assert.equal(writes, 0, 'Every selected permission/source must be checked before the first write, even when errors are caught.');
  });
  denied++;
}
await deny('mixed', ['settings:write'], /documents:read/);
await deny('mixed', ['settings:write', 'documents:write'], /documents:read/);
await deny('mixed', base, /financials:write/);
await deny('mixed', [...base, 'financials:write'], /employees:write/);
await deny('director', base, /directors:write/);
await deny('controller', ['documents:read', 'documents:write'], /settings:write/);
await deny('unknown', base, /Unsupported import section kind/);
await deny('foreign', [...base, 'financials:write', 'employees:write'], /documents not found/);
await deny('missing', [...base, 'financials:write', 'employees:write'], /documents not found/);
await assert.rejects(() => native.withIdentity({ issuer, subject: 'Director' }).mutation(api.importSessions.applyApprovedSectionRecords, { sessionId: fixture.sessions.mixed }), /settings:write/);
const before = await native.run(async ctx => ({ financials: (await ctx.db.query('financials').collect()).length, employees: (await ctx.db.query('employees').collect()).length, evidence: (await ctx.db.query('sourceEvidence').collect()).length }));
assert.deepEqual(before, { financials: 0, employees: 0, evidence: 0 });
await native.run(async ctx => {
  const portable = await toPortableMutationCtx(ctx);
  const scoped = { ...portable, principal: { kind: 'service' as const, runtime: 'test' as const, assurance: 'trusted-internal' as const, subject: 'composed-import-service', societyId: String(fixture.societyId), actorUserId: String(fixture.users.Owner), scopes: [...base, 'financials:write', 'employees:write'] } };
  await requireFunctionAction(scoped, 'importSessions:applyApprovedSectionRecords', 'mutation', { sessionId: fixture.sessions.mixed });
  assert.deepEqual(await applyApprovedSectionRecordsPortable(scoped, { sessionId: fixture.sessions.mixed }), { total: 2, byKind: { financialStatement: 1, employee: 1 } });
});
const after = await native.run(async ctx => ({ financials: (await ctx.db.query('financials').collect()).length, employees: (await ctx.db.query('employees').collect()).length, evidence: (await ctx.db.query('sourceEvidence').collect()).length }));
assert.deepEqual(after, { financials: 1, employees: 1, evidence: 2 });
console.log(`Import destination authority passed: ${denied} scoped preflight denials with zero writes, public Director denied, composed service promoted 2 records.`);
