import assert from 'node:assert/strict';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { convexTest } from 'convex-test';
import schema from '../convex/schema';
import { api, internal } from '../convex/_generated/api';
import { betterAuthIssuer } from '../convex/lib/authIdentity';
import { providerConfigForRecipe, runExternalGovernanceRecipe } from '../convex/workflowCatalog';

const requests: Array<Record<string, any>> = [];
let responseMode = 'accepted';
const fixtureSecret = randomUUID(); // Only private ephemeral loopback transport sees this credential.
const server = http.createServer(async (req, res) => {
  const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk));
  const body = JSON.parse(Buffer.concat(chunks).toString()); requests.push(body);
  assert.equal(body.callbackSecret, fixtureSecret);
  if (responseMode === 'redirect') { res.writeHead(307, { location: '/credential-leak' }); res.end(); return; }
  if (responseMode === 'error') { res.writeHead(503); res.end(`Bearer ${fixtureSecret}`); return; }
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ executionId: 'fixture-42', access_token: fixtureSecret, nested: { password: fixtureSecret } }));
});
await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
const port = (server.address() as any).port;
const envNames = ['N8N_WEBHOOK_BASE_URL', 'SOCIETYER_WORKFLOW_CALLBACK_SECRET', 'SOCIETYER_WORKFLOW_CALLBACK_URL', 'SOCIETYER_OUTBOUND_ALLOW_LOCAL_DEVELOPMENT'];
const original = Object.fromEntries(envNames.map(name => [name, process.env[name]]));
process.env.N8N_WEBHOOK_BASE_URL = `http://127.0.0.1:${port}/webhook`;
process.env.SOCIETYER_WORKFLOW_CALLBACK_SECRET = fixtureSecret;
process.env.SOCIETYER_WORKFLOW_CALLBACK_URL = `http://127.0.0.1:${port}/callback`;
process.env.SOCIETYER_OUTBOUND_ALLOW_LOCAL_DEVELOPMENT = 'true';
try {
  const native = convexTest(schema, {
    './_generated/api.js': () => import('../convex/_generated/api.js'),
    './_generated/server.js': () => import('../convex/_generated/server.js'),
    './authorization.js': () => import('../convex/authorization'),
    './workflows.js': () => import('../convex/workflows'),
    './notifications.js': () => import('../convex/notifications'),
  });
  const issuer = betterAuthIssuer();
  const f = await native.run(async ctx => {
    const societyId = await ctx.db.insert('societies', { name: 'Workflow loopback qualification', isCharity: false, isMemberFunded: false, updatedAt: 0 });
    const foreignId = await ctx.db.insert('societies', { name: 'Foreign workflow', isCharity: false, isMemberFunded: false, updatedAt: 0 });
    const users: Record<string, any> = {};
    for (const role of ['Owner', 'Admin', 'Director', 'Member', 'Viewer']) users[role] = await ctx.db.insert('users', { societyId, role, displayName: role, status: 'Active', email: `${role}@workflow.invalid`, authIssuer: issuer, authSubject: role, createdAtISO: new Date().toISOString() });
    const workflows: Record<string, any> = {};
    for (const recipe of ['agm_date_deadlines', 'unbc_affiliate_id_request', 'ote_keycard_access_request']) {
      workflows[recipe] = await ctx.db.insert('workflows', { societyId, recipe, name: recipe, status: 'active', trigger: { kind: 'manual' }, provider: 'n8n', providerConfig: providerConfigForRecipe(recipe as any), createdByUserId: users.Admin, config: recipe === 'agm_date_deadlines' ? { n8nOnly: true } : {} });
    }
    return { societyId, foreignId, users, workflows };
  });
  const admin = native.withIdentity({ issuer, subject: 'Admin' });
  const args = (recipe: string) => ({ societyId: f.societyId, workflowId: f.workflows[recipe], input: { personName: 'Synthetic Person', personEmail: 'synthetic@fixture.invalid' } });
  for (const role of ['Member', 'Viewer']) await assert.rejects(() => native.withIdentity({ issuer, subject: role }).action(api.workflows.run, args('agm_date_deadlines')), /Permission tasks:write/);
  await assert.rejects(() => admin.action(api.workflows.run, { ...args('agm_date_deadlines'), societyId: f.foreignId }), /not found|membership/);
  assert.equal(requests.length, 0);
  for (const recipe of Object.keys(f.workflows)) {
    const result = await admin.action(api.workflows.run, args(recipe));
    assert.equal(result.status, 'running');
    const run = await admin.query(api.workflows.getRun, { id: result.runId });
    assert.equal(run.externalRunId, 'fixture-42');
    assert.equal(JSON.stringify(run).includes(fixtureSecret), false, 'No provider response credentials enter browser-readable history.');
    assert.equal(run.status, 'running', 'Webhook HTTP success is queue acknowledgement, not completed execution.');
  }
  assert.equal(requests.length, 3);
  await assert.rejects(() => admin.action(api.workflows.run, args('agm_date_deadlines')), /unfinished external run/);
  assert.equal(requests.length, 3, 'Duplicate launch cannot resend while the acknowledged run awaits completion.');
  const initialRuns = await native.run(ctx => ctx.db.query('workflowRuns').collect());
  for (const run of initialRuns) await admin.mutation(api.workflows.receiveExternalCallback, { workflowId: run.workflowId, runId: run._id, event: 'run.completed' });
  const unknownWorkflowId = await native.run(ctx => ctx.db.insert('workflows', { societyId: f.societyId, recipe: 'fixture_preview_nodes', name: 'Preview nodes do not execute', status: 'active', trigger: { kind: 'manual' }, provider: 'internal', createdByUserId: f.users.Admin, nodePreview: [{ key: 'trigger', type: 'manual_trigger', label: 'Launch' }, { key: 'custom', type: 'email', label: 'Custom unimplemented send' }] }));
  const prepared = await admin.action(api.workflows.run, { societyId: f.societyId, workflowId: unknownWorkflowId });
  assert.equal(prepared.status, 'manual_required');
  const preparation = await admin.query(api.workflows.getRun, { id: prepared.runId });
  assert.equal(preparation.steps[0].status, 'ok');
  assert.equal(preparation.steps[1].status, 'skip', 'A preview-only custom action must not falsely finish as executed.');
  const observed = requests.length;
  await native.run(ctx => ctx.db.patch(f.workflows.agm_date_deadlines, { providerConfig: { externalWebhookUrl: `http://127.0.0.1:${port}/tenant-controlled` } }));
  await assert.rejects(() => admin.action(api.workflows.run, args('agm_date_deadlines')), /not an operator-configured/);
  assert.equal(requests.length, observed, 'Tenant-editable destination must receive zero deployment credentials.');
  await native.run(ctx => ctx.db.patch(f.workflows.agm_date_deadlines, { providerConfig: providerConfigForRecipe('agm_date_deadlines') }));
  responseMode = 'error';
  await assert.rejects(() => admin.action(api.workflows.run, args('agm_date_deadlines')), /HTTP 503/);
  assert.equal(requests.length, observed + 1, 'Provider failure has no automatic resend.');
  responseMode = 'redirect';
  await assert.rejects(() => admin.action(api.workflows.run, args('agm_date_deadlines')), /could not be confirmed/);
  assert.equal(requests.length, observed + 2, 'Secret-bearing POST must never follow a redirect.');
  const records = await native.run(async ctx => ({ runs: await ctx.db.query('workflowRuns').collect(), notices: await ctx.db.query('notifications').collect() }));
  assert.equal(JSON.stringify(records).includes(fixtureSecret), false, 'Neither failed runs nor notifications retain raw provider text.');
  // Exercise the recheck after local preparation with actual internal native handlers.
  const runId = await admin.mutation(internal.workflows._createRun, { societyId: f.societyId, workflowId: f.workflows.agm_date_deadlines, recipe: 'agm_date_deadlines', provider: 'n8n', demo: false, triggeredBy: 'manual' });
  const wf = await native.run(ctx => ctx.db.get(f.workflows.agm_date_deadlines));
  let changed = false;
  const ctx = {
    runQuery: (fn: any, values: any) => admin.query(fn, values),
    runMutation: async (fn: any, values: any) => {
      const result = await admin.mutation(fn, values);
      if (!changed && values.stepIndex === 0) { changed = true; await native.run(ctx => ctx.db.patch(f.users.Admin, { role: 'Member' })); }
      return result;
    },
  };
  const beforeRevocation = requests.length;
  await assert.rejects(() => runExternalGovernanceRecipe(ctx, wf, runId, args('agm_date_deadlines')), /Permission|revoked/);
  assert.equal(requests.length, beforeRevocation, 'Authority revoked during preparation must stop outbound dispatch.');
  console.log('PASS workflow runner integration: 3 actual native-action n8n routes over isolated loopback HTTP; role/tenant denial; queue-only acknowledgement; unfinished-run duplicate denial; operator-only credentials; zero redirect forwarding/retry; safe run+notification persistence; current authority checked before egress. Preview-only nodes remain manual-required. No real external messages/submissions were sent.');
} finally {
  for (const [name, value] of Object.entries(original)) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}
