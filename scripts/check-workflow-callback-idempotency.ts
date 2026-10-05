import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
const previousServiceToken = process.env.SOCIETYER_API_PLATFORM_TOKEN;
const serviceToken = randomUUID();
process.env.SOCIETYER_API_PLATFORM_TOKEN = serviceToken;
import { convexTest } from 'convex-test';
import schema from '../convex/schema';
import { api, internal } from '../convex/_generated/api';
import { betterAuthIssuer } from '../convex/lib/authIdentity';
const test = convexTest(schema, {
  './_generated/api.js': () => import('../convex/_generated/api.js'),
  './_generated/server.js': () => import('../convex/_generated/server.js'),
  './http.js': () => import('../convex/http'),
  './workflows.js': () => import('../convex/workflows'),
});
const issuer = betterAuthIssuer();
const f = await test.run(async ctx => {
  const societyId = await ctx.db.insert('societies', { name: 'Callback retry qualification', isCharity: false, isMemberFunded: false, updatedAt: 0 });
  const users: Record<string, any> = {};
  for (const role of ['Owner', 'Admin', 'Director', 'Member', 'Viewer']) users[role] = await ctx.db.insert('users', { societyId, role, status: 'Active', displayName: role, email: `${role}@callback.invalid`, authIssuer: issuer, authSubject: role, createdAtISO: new Date().toISOString() });
  const workflowId = await ctx.db.insert('workflows', { societyId, recipe: 'agm_date_deadlines', name: 'Generated document workflow', provider: 'n8n', status: 'active', trigger: { kind: 'manual' }, config: { n8nOnly: true }, createdByUserId: users.Admin });
  const runId = await ctx.db.insert('workflowRuns', { societyId, workflowId, recipe: 'agm_date_deadlines', provider: 'n8n', status: 'running', startedAtISO: new Date().toISOString(), steps: [], demo: false, triggeredBy: 'manual', triggeredByUserId: users.Admin });
  const completedId = await ctx.db.insert('workflowRuns', { societyId, workflowId, recipe: 'agm_date_deadlines', provider: 'n8n', status: 'success', startedAtISO: new Date().toISOString(), steps: [], demo: false, triggeredBy: 'manual', triggeredByUserId: users.Admin });
  return { societyId, workflowId, runId, completedId, users };
});
const admin = test.withIdentity({ issuer, subject: 'Admin' });
const args = { serviceToken, societyId: f.societyId, workflowId: f.workflowId, runId: f.runId, fileName: 'synthetic.pdf', fileSizeBytes: 42, mimeType: 'application/pdf', storageKey: 'fixture-first.pdf', sha256: 'a'.repeat(64) };
const preflight = { workflowId: args.workflowId, runId: args.runId, fileName: args.fileName, fileSizeBytes: args.fileSizeBytes, sha256: args.sha256 };
const untrusted = { ...args, serviceToken: undefined };
await assert.rejects(() => admin.mutation(api.workflows.recordGeneratedDocument, untrusted), /service token is invalid/);
await assert.rejects(() => admin.mutation(api.workflows.recordGeneratedDocument, { ...args, serviceToken: 'incorrect-fixture-service-token' }), /service token is invalid/);
const foreignDoc = await test.run(async ctx => {
  const societyId = await ctx.db.insert('societies', { name: 'Foreign private generated file', isCharity: false, isMemberFunded: false, updatedAt: 0 });
  const documentId = await ctx.db.insert('documents', { societyId, title: 'Foreign generated PDF', category: 'WorkflowGenerated', tags: [], flaggedForDeletion: false, createdAtISO: new Date().toISOString() });
  await ctx.db.insert('documentVersions', { societyId, documentId, version: 1, storageProvider: 'local', storageKey: 'foreign-owned-generated.pdf', fileName: 'foreign.pdf', uploadedAtISO: new Date().toISOString(), isCurrent: true });
  return documentId;
});
await assert.rejects(() => admin.mutation(api.workflows.recordGeneratedDocument, { ...args, storageKey: 'foreign-owned-generated.pdf' }), /already claimed/);
assert.equal(await admin.query(api.http.gatewayGeneratedDocumentAccess, { societyId: f.societyId, storageKey: 'foreign-owned-generated.pdf', serviceToken }), false);
assert.equal((await test.run(ctx => ctx.db.query('documents').withIndex('by_society', q => q.eq('societyId', f.societyId)).collect())).length, 0, 'Missing/bad platform secret and foreign-key collision must create zero local documents.');
assert.ok(foreignDoc);
await assert.rejects(() => admin.mutation(api.workflows.recordGeneratedDocument, { ...args, runId: f.completedId }), /already complete/);
assert.equal((await test.run(ctx => ctx.db.query('documents').withIndex('by_society', q => q.eq('societyId', f.societyId)).collect())).length, 0);
for (const role of ['Owner', 'Director', 'Member', 'Viewer']) await assert.rejects(() => test.withIdentity({ issuer, subject: role }).mutation(api.workflows.recordGeneratedDocument, args), /principal|Permission/);
assert.equal(await admin.query(api.workflows.generatedDocumentPreflight, preflight), null);
const saved = await Promise.all([admin.mutation(api.workflows.recordGeneratedDocument, args), admin.mutation(api.workflows.recordGeneratedDocument, { ...args, storageKey: 'fixture-racing-candidate.pdf' })]);
assert.equal(saved[0].documentId, saved[1].documentId); assert.equal(saved[0].versionId, saved[1].versionId);
assert.equal(saved[0].storageKey, saved[1].storageKey);
assert.equal((await test.run(ctx => ctx.db.query('documents').withIndex('by_society', q => q.eq('societyId', f.societyId)).collect())).length, 1);
assert.equal((await test.run(ctx => ctx.db.query('documentVersions').withIndex('by_society', q => q.eq('societyId', f.societyId)).collect())).length, 1);
await assert.rejects(() => admin.query(api.workflows.generatedDocumentPreflight, { ...preflight, sha256: 'b'.repeat(64) }), /differs/);
const generatedDocument = saved[0];
await assert.rejects(() => admin.mutation(api.workflows.receiveExternalCallback, { workflowId: f.workflowId, runId: f.completedId, event: 'document.created', generatedDocument }), /does not belong/);
await assert.rejects(() => admin.mutation(api.workflows.receiveExternalCallback, { workflowId: f.workflowId, runId: f.runId, event: 'document.created', generatedDocument: { ...generatedDocument, storageKey: 'forged.pdf' } }), /does not belong/);
const callback = { workflowId: f.workflowId, runId: f.runId, externalRunId: 'fixture-run-1', event: 'run.completed', generatedDocument, output: { prepared: true } };
await admin.mutation(api.workflows.receiveExternalCallback, callback);
assert.deepEqual(await admin.mutation(api.workflows.receiveExternalCallback, callback), { duplicate: true });
await assert.rejects(() => admin.mutation(api.workflows.receiveExternalCallback, { ...callback, output: { prepared: false } }), /already complete/);
assert.equal((await admin.query(api.workflows.generatedDocumentPreflight, preflight)).documentId, generatedDocument.documentId);
assert.equal((await admin.mutation(api.workflows.recordGeneratedDocument, args)).documentId, generatedDocument.documentId);
await test.run(ctx => ctx.runMutation(internal.workflows._markExternalQueued, { id: f.runId, externalRunId: 'late-ack', output: { stale: true } }));
await test.run(ctx => ctx.runMutation(internal.workflows._completeRun, { id: f.runId, status: 'failed', output: { error: 'late transport failure' } }));
assert.equal((await admin.query(api.workflows.getRun, { id: f.runId })).status, 'success', 'Delayed queue acknowledgements/failures cannot resurrect a terminal callback.');
await test.run(ctx => ctx.db.patch(f.societyId, { disabledModules: ['workflows'] }));
await assert.rejects(() => admin.query(api.workflows.generatedDocumentPreflight, preflight), /disabled/);
await assert.rejects(() => admin.mutation(api.workflows.receiveExternalCallback, callback), /disabled/);
await test.run(ctx => ctx.db.patch(f.societyId, { disabledModules: [] }));
await test.run(ctx => ctx.db.patch(f.users.Admin, { status: 'Disabled' }));
await assert.rejects(() => admin.query(api.workflows.generatedDocumentPreflight, preflight), /membership|disabled/);
await assert.rejects(() => admin.mutation(api.workflows.receiveExternalCallback, callback), /membership|disabled/);
await test.run(ctx => ctx.db.patch(f.users.Admin, { status: 'Active' }));
await test.run(ctx => ctx.db.patch(f.workflowId, { status: 'paused' }));
await assert.rejects(() => admin.query(api.workflows.generatedDocumentPreflight, preflight), /revoked/);
assert.equal((await test.run(ctx => ctx.db.query('documents').withIndex('by_society', q => q.eq('societyId', f.societyId)).collect())).length, 1);
if (previousServiceToken === undefined) delete process.env.SOCIETYER_API_PLATFORM_TOKEN; else process.env.SOCIETYER_API_PLATFORM_TOKEN = previousServiceToken;
console.log('PASS native callback idempotency: operator proof/missing-bad-secret/foreign file claim zero writes; completed run zero writes; bound actor/write gates; concurrent identical PDFs one pinned document/version; different fingerprint/foreign-run/spoofed-version rejection; exact terminal callback acknowledgement; current actor/workflow revocation still denies retries.');
