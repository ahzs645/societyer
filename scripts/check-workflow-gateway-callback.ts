/** Mounted HTTP route + actual native Convex handlers; only transport/JWT issuance are fixture adapters. */
import assert from 'node:assert/strict';
import express from 'express';
import { mkdir, mkdtemp, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { ConvexHttpClient } from 'convex/browser';
import { convexTest } from 'convex-test';
import { api } from '../convex/_generated/api';
import schema from '../convex/schema';
import { betterAuthIssuer } from '../convex/lib/authIdentity';

const cwd = process.cwd();
await mkdir(path.join(cwd, 'tmp'), { recursive: true });
const privateRoot = await mkdtemp(path.join(cwd, 'tmp/workflow-gateway-'));
const callbackSecret = randomUUID(); const serviceSecret = randomUUID(); const issuedToken = randomUUID();
const envValues = { AUTH_MODE: 'better-auth', AUTH_DB_PATH: path.join(privateRoot, 'auth.sqlite'), SOCIETYER_WORKFLOW_CALLBACK_SECRET: callbackSecret, SOCIETYER_API_PLATFORM_TOKEN: serviceSecret };
const previous = Object.fromEntries(Object.keys(envValues).map(key => [key, process.env[key]]));
Object.assign(process.env, envValues);
const originalQuery = ConvexHttpClient.prototype.query;
const originalMutation = ConvexHttpClient.prototype.mutation;
const originalSetAuth = ConvexHttpClient.prototype.setAuth;
const originalClearAuth = ConvexHttpClient.prototype.clearAuth;
const authentication = new WeakMap<object, string>();
let restoreSigner: (() => void) | undefined;
let httpServer: ReturnType<express.Express['listen']> | undefined;
try {
  const native = convexTest(schema, {
    './_generated/api.js': () => import('../convex/_generated/api.js'),
    './_generated/server.js': () => import('../convex/_generated/server.js'),
    './http.js': () => import('../convex/http'),
    './workflows.js': () => import('../convex/workflows'),
  });
  const issuer = betterAuthIssuer();
  const fixture = await native.run(async ctx => {
    const societyId = await ctx.db.insert('societies', { name: 'Mounted gateway callback', isCharity: false, isMemberFunded: false, updatedAt: 0 });
    const userId = await ctx.db.insert('users', { societyId, role: 'Admin', status: 'Active', displayName: 'Fixture Admin', email: 'admin@gateway.invalid', authSubject: 'gateway-admin', authIssuer: issuer, createdAtISO: new Date().toISOString() });
    const workflowId = await ctx.db.insert('workflows', { societyId, name: 'Gateway PDF qualification', recipe: 'agm_date_deadlines', status: 'active', provider: 'n8n', trigger: { kind: 'manual' }, createdByUserId: userId });
    const runId = await ctx.db.insert('workflowRuns', { societyId, workflowId, recipe: 'agm_date_deadlines', status: 'running', provider: 'n8n', startedAtISO: new Date().toISOString(), steps: [], demo: false, triggeredBy: 'manual', triggeredByUserId: userId });
    const completedId = await ctx.db.insert('workflowRuns', { societyId, workflowId, recipe: 'agm_date_deadlines', status: 'success', provider: 'n8n', startedAtISO: new Date().toISOString(), steps: [], demo: false, triggeredBy: 'manual', triggeredByUserId: userId });
    return { societyId, userId, workflowId, runId, completedId };
  });
  const actor = native.withIdentity({ issuer, subject: 'gateway-admin' });
  ConvexHttpClient.prototype.setAuth = function (token: string) { authentication.set(this, token); };
  ConvexHttpClient.prototype.clearAuth = function () { authentication.delete(this); };
  ConvexHttpClient.prototype.query = async function (reference: any, values: any) { return authentication.get(this) === issuedToken ? actor.query(reference, values) : native.query(reference, values); } as any;
  ConvexHttpClient.prototype.mutation = async function (reference: any, values: any) { assert.ok(authentication.get(this) === issuedToken, 'Write transport requires the callback-issued fixture principal.'); return actor.mutation(reference, values); } as any;
  const { auth } = await import('../server/auth-config');
  const signJWT = auth.api.signJWT;
  (auth.api as any).signJWT = async ({ body }: any) => { assert.ok(body.payload.sub === 'gateway-admin' && body.payload.societyer_auth_issuer === issuer, 'Gateway must issue the actual bound native principal.'); return { token: issuedToken }; };
  restoreSigner = () => { (auth.api as any).signJWT = signJWT; };
  const { mountApiGateway } = await import('../server/api-gateway');
  process.chdir(privateRoot);
  const app = express(); mountApiGateway(app);
  httpServer = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => httpServer!.once('listening', resolve));
  const base = `http://127.0.0.1:${(httpServer.address() as any).port}`;
  const pdf = Buffer.from('%PDF-1.4\nSynthetic private qualification only\n%%EOF').toString('base64');
  const body = { workflowId: fixture.workflowId, runId: fixture.runId, event: 'run.completed', externalRunId: 'gateway-42', generatedPdf: { filename: 'synthetic.pdf', base64: pdf }, output: { fixture: true } };
  const send = (payload: any, secret = callbackSecret) => fetch(`${base}/api/v1/workflow-callbacks/n8n`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-societyer-workflow-secret': secret }, body: JSON.stringify(payload) });
  assert.equal((await send(body, 'incorrect-fixture-secret')).status, 401);
  assert.equal((await send({ ...body, runId: fixture.completedId })).status, 500);
  const files = () => readdir(path.join(privateRoot, 'data/workflow-generated-documents')).catch(() => []);
  assert.equal((await files()).length, 0, 'Completed unrecorded run must fail before filesystem writes.');
  assert.equal((await send({ ...body, output: { callbackSecret } })).status, 500);
  assert.equal((await send({ ...body, note: callbackSecret })).status, 500);
  assert.equal((await files()).length, 0, 'Unsafe provider callback output must fail before filesystem writes.');
  const responses = await Promise.all([send(body), send(body)]);
  for (const response of responses) assert.equal(response.status, 200);
  assert.equal((await files()).length, 1, 'Concurrent duplicate gateway candidates leave one retained PDF.');
  assert.equal((await native.run(ctx => ctx.db.query('documents').collect())).length, 1);
  assert.equal((await native.run(ctx => ctx.db.query('documentVersions').collect())).length, 1);
  assert.equal((await send(body)).status, 200);
  assert.equal((await files()).length, 1);
  assert.equal((await send({ ...body, generatedPdf: { ...body.generatedPdf, base64: Buffer.from('%PDF-1.4\nDifferent content').toString('base64') } })).status, 500);
  assert.equal((await files()).length, 1);
  const oversized = Buffer.alloc(7 * 1024 * 1024 + 1, 65); oversized.write('%PDF');
  assert.equal((await send({ ...body, generatedPdf: { filename: 'too-large.pdf', base64: oversized.toString('base64') } })).status, 413);
  assert.equal((await files()).length, 1);
  await native.run(ctx => ctx.db.patch(fixture.userId, { status: 'Disabled' }));
  assert.equal((await send(body)).status, 404);
  assert.equal((await files()).length, 1);
  console.log('PASS mounted workflow gateway: callback-secret gate; native bound-principal transport; completed run zero file writes; concurrent/exact PDF retries one document/version/file; digest tamper and 7MiB cap rejection; revoked actor denial. JWT issuer/transport are fixture adapters; this is not live SSO qualification.');
} finally {
  if (httpServer) await new Promise<void>((resolve, reject) => httpServer!.close(error => error ? reject(error) : resolve()));
  restoreSigner?.();
  ConvexHttpClient.prototype.query = originalQuery; ConvexHttpClient.prototype.mutation = originalMutation;
  ConvexHttpClient.prototype.setAuth = originalSetAuth; ConvexHttpClient.prototype.clearAuth = originalClearAuth;
  process.chdir(cwd);
  for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  await rm(privateRoot, { recursive: true, force: true });
}
