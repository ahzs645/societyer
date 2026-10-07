/** Mounted gateway + real native handlers; only Convex transport and external runner are isolated fixture adapters. */
import assert from "node:assert/strict";
import express from "express";
import { createServer } from "node:http";
import { generateKeyPairSync, sign, randomUUID } from "node:crypto";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import path from "node:path";
import { ConvexHttpClient } from "convex/browser";
import { createFixture, fixtureIssuer } from "../experiments/offline-convex/fixture";
import { writeTrackedReport } from "./lib/writeTrackedReport.mjs";

await mkdir(path.join(process.cwd(), "tmp"), { recursive: true });
const privateRoot = await mkdtemp(path.join(process.cwd(), "tmp/provider-gateway-"));
const envNames = ["AUTH_MODE", "VITE_AUTH_MODE", "AUTH_DB_PATH", "BETTER_AUTH_SECRET", "CLERK_JWT_KEY", "CLERK_JWT_ISSUER_DOMAIN", "CLERK_AUTHORIZED_PARTIES", "CONNECTOR_RUNNER_BASE_URL", "CONNECTOR_RUNNER_SECRET", "SOCIETYER_WAVE_WORKSPACE_BINDINGS_JSON", "NODE_ENV"];
const previous = new Map(envNames.map(name => [name, process.env[name]]));
const originalQuery = ConvexHttpClient.prototype.query, originalMutation = ConvexHttpClient.prototype.mutation, originalSetAuth = ConvexHttpClient.prototype.setAuth, originalClearAuth = ConvexHttpClient.prototype.clearAuth;
let runnerCalls = 0, runnerMode = "assigned";
const runnerSecret = randomUUID();
const runner = createServer(async (req, res) => {
  runnerCalls++; let text = ""; for await (const chunk of req) text += chunk;
  const body = JSON.parse(text || "{}");
  assert.equal(req.headers["x-connector-runner-secret"], runnerSecret);
  assert.match(String(req.headers["x-connector-tenant-key"]), /^ct1_/);
  assert.equal(body.businessId, "business-fixture", "Gateway injects only operator assigned provider business");
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify({ businessId: runnerMode === "foreign" ? "foreign-business" : "business-fixture", profileKey: "fixture-profile", normalized: { accounts: [{ externalId: "account-fixture", name: "Fixture checking", currency: "CAD", accountType: "Bank", balanceCents: 1200, isRestricted: false }], transactions: [{ externalId: "tx-fixture", accountExternalId: "account-fixture", date: "2026-01-01", description: "Fixture transaction", amountCents: 1200, category: "Membership" }] } }));
});
let gateway: ReturnType<express.Express["listen"]> | undefined;
const cases: string[] = [], pass = (label: string) => { cases.push(label); console.log(`PASS ${label}`); };
try {
  const fixture = await createFixture({ "./http.js": () => import("../convex/http"), "./society.js": () => import("../convex/society"), "./users.js": () => import("../convex/users"), "./authorization.js": () => import("../convex/authorization"), "./workflows.js": () => import("../convex/workflows"), "./importSessions.js": () => import("../convex/importSessions"), "./financialHub.js": () => import("../convex/financialHub") });
  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  Object.assign(process.env, { AUTH_MODE: "clerk", VITE_AUTH_MODE: "clerk", AUTH_DB_PATH: path.join(privateRoot, "auth.sqlite"), BETTER_AUTH_SECRET: randomUUID(), CLERK_JWT_KEY: publicKey.export({ type: "spki", format: "pem" }).toString(), CLERK_JWT_ISSUER_DOMAIN: fixtureIssuer, CLERK_AUTHORIZED_PARTIES: "https://provider-gateway.example.test", NODE_ENV: "test", CONNECTOR_RUNNER_SECRET: runnerSecret });
  const token = (subject: string) => {
    const now = Math.floor(Date.now() / 1000);
    const input = `${Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url")}.${Buffer.from(JSON.stringify({ iss: fixtureIssuer, sub: subject, aud: "convex", azp: "https://provider-gateway.example.test", sid: "fixture-session", iat: now - 1, exp: now + 600 })).toString("base64url")}`;
    return `${input}.${sign("RSA-SHA256", Buffer.from(input), privateKey).toString("base64url")}`;
  };
  const tokens = new Map(["owner-a", "viewer-a", "owner-b"].map(subject => [token(subject), fixture.actor(subject)]));
  const ownerToken = [...tokens.keys()][0], viewerToken = [...tokens.keys()][1], foreignToken = [...tokens.keys()][2];
  const authentication = new WeakMap<object, string>();
  ConvexHttpClient.prototype.setAuth = function (token) { authentication.set(this, token); };
  ConvexHttpClient.prototype.clearAuth = function () { authentication.delete(this); };
  ConvexHttpClient.prototype.query = async function (reference: any, args: any) { return (tokens.get(authentication.get(this) ?? "") ?? fixture.native).query(reference, args); } as any;
  ConvexHttpClient.prototype.mutation = async function (reference: any, args: any) { const actor = tokens.get(authentication.get(this) ?? ""); assert.ok(actor, "Native gateway writes need the verified fixture principal"); return actor.mutation(reference, args); } as any;
  await new Promise<void>(resolve => runner.listen(0, "127.0.0.1", resolve));
  process.env.CONNECTOR_RUNNER_BASE_URL = `http://127.0.0.1:${(runner.address() as any).port}`;
  const { mountApiGateway } = await import("../server/api-gateway");
  const app = express(); mountApiGateway(app); gateway = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => gateway!.once("listening", resolve));
  const base = `http://127.0.0.1:${(gateway.address() as any).port}`;
  const send = (body: any = {}, bearer = ownerToken, suffix = "/connectors/wave/import-transactions") => fetch(`${base}/api/v1/browser-connectors${suffix}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${bearer}` }, body: JSON.stringify({ profileKey: "fixture-profile", ...body }) });
  const counts = () => fixture.native.run(async ctx => ({ imports: (await ctx.db.query("documents").collect()).filter(row => row.category === "Import Session").length, runs: (await ctx.db.query("workflowRuns").collect()).length, accounts: (await ctx.db.query("financialAccounts").collect()).length, transactions: (await ctx.db.query("financialTransactions").collect()).length }));
  const initial = await counts();
  delete process.env.SOCIETYER_WAVE_WORKSPACE_BINDINGS_JSON;
  assert.equal((await send()).status, 500); assert.equal(runnerCalls, 0); assert.deepEqual(await counts(), initial);
  process.env.SOCIETYER_WAVE_WORKSPACE_BINDINGS_JSON = JSON.stringify({ [fixture.ids.societyA]: "business-fixture" });
  assert.equal((await send({ businessId: "foreign-business" })).status, 500);
  assert.equal((await send({}, foreignToken)).status, 500);
  assert.equal((await send({}, viewerToken)).status, 403);
  assert.equal((await send({ societyId: fixture.ids.societyB })).status, 403);
  assert.equal(runnerCalls, 0); assert.deepEqual(await counts(), initial);
  pass("mounted gateway actual Clerk verification/native membership denies missing provider binding, foreign business/workspace and Viewer before runner or records");
  await fixture.native.run(ctx => ctx.db.patch(fixture.ids.societyA, { disabledModules: ["browserConnectors"] }));
  assert.equal((await send()).status, 403); assert.equal(runnerCalls, 0); assert.deepEqual(await counts(), initial);
  await fixture.native.run(ctx => ctx.db.patch(fixture.ids.societyA, { disabledModules: [] }));
  pass("disabled browser module prevents external runner execution and import/run writes");
  runnerMode = "foreign";
  assert.equal((await send()).status, 500); assert.equal(runnerCalls, 1); assert.deepEqual(await counts(), initial);
  pass("foreign provider result is rejected before staging any financial data or recording a success run");
  runnerMode = "assigned";
  const staged = await send(); assert.equal(staged.status, 200, await staged.text());
  const afterStage = await counts(); assert.equal(afterStage.imports, 1); assert.equal(afterStage.runs, 1); assert.equal(afterStage.accounts, 0);
  pass("bound Wave runner response stages a real native review import and connector run without directly posting financial records");
  const direct = await send({ applyDirect: true }); assert.equal(direct.status, 200, await direct.text());
  const afterDirect = await counts(); assert.equal(afterDirect.imports, 1); assert.equal(afterDirect.runs, 2); assert.equal(afterDirect.accounts, 1); assert.equal(afterDirect.transactions, 1);
  pass("bound direct Wave import reaches actual native provider binding and transaction handler");
  writeTrackedReport("artifacts/offline/provider-workspace-gateway.json", JSON.stringify({ sourceBaseline: "66b8dcd", executedAt: new Date().toISOString(), fixtureOnly: true, actualGatewayHttp: true, nativeHandlers: true, externallyHostedProviderContacted: false, cases, count: cases.length }, null, 2) + "\n");
} finally {
  ConvexHttpClient.prototype.query = originalQuery; ConvexHttpClient.prototype.mutation = originalMutation; ConvexHttpClient.prototype.setAuth = originalSetAuth; ConvexHttpClient.prototype.clearAuth = originalClearAuth;
  if (gateway) await new Promise<void>(resolve => gateway!.close(() => resolve()));
  await new Promise<void>(resolve => runner.close(() => resolve()));
  for (const [name, value] of previous) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
  await rm(privateRoot, { recursive: true, force: true });
}
