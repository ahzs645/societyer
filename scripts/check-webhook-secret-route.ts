import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import express from "express";
import { ConvexHttpClient } from "convex/browser";
import { getFunctionName } from "convex/server";

const dir = await mkdtemp(path.join(tmpdir(), "societyer-webhook-route-"));
const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
Object.assign(process.env, { AUTH_MODE: "clerk", VITE_AUTH_MODE: "clerk", NODE_ENV: "development", AUTH_DB_PATH: path.join(dir, "auth.sqlite"), CLERK_JWT_KEY: publicKey.export({ type: "spki", format: "pem" }).toString(), CLERK_JWT_ISSUER_DOMAIN: "https://webhook-route.clerk.accounts.dev", CLERK_AUTHORIZED_PARTIES: "https://webhook-ui.test", SOCIETYER_API_PLATFORM_TOKEN: "webhook-server-service-test" });
const { mountApiGateway } = await import("../server/api-gateway");
const { decryptSecret } = await import("../server/api-gateway/shared");
const now = Math.floor(Date.now() / 1000);
const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
const payload = Buffer.from(JSON.stringify({ iss: process.env.CLERK_JWT_ISSUER_DOMAIN, sub: "requester", sid: "session-requester", aud: "convex", azp: "https://webhook-ui.test", iat: now - 5, nbf: now - 5, exp: now + 120 })).toString("base64url");
const input = `${header}.${payload}`;
const token = `${input}.${sign("RSA-SHA256", Buffer.from(input), privateKey).toString("base64url")}`;
let role = "Owner";
const writes: any[] = [];
const originalQuery = ConvexHttpClient.prototype.query;
const originalMutation = ConvexHttpClient.prototype.mutation;
ConvexHttpClient.prototype.query = async function (ref: any, args: any) {
  const name = getFunctionName(ref);
  if (name === "http:currentPrincipalMemberships") return { authIssuer: process.env.CLERK_JWT_ISSUER_DOMAIN, authSubject: "requester", memberships: [{ society: { _id: "workspace-a" }, userId: "user-a", role }] } as any;
  if (name === "apiPlatform:resourceTenantStatus") return (args.id === "foreign-subscription" ? "forbidden" : "allowed") as any;
  if (name === "apiPlatform:listWebhookSubscriptions") return writes.map(write => ({ _id: write.id ?? "subscription-created", name: write.name, targetUrl: write.targetUrl, hasSecret: true, status: "active" })) as any;
  throw new Error(`Unexpected query ${name}`);
};
ConvexHttpClient.prototype.mutation = async function (ref: any, args: any) {
  assert.equal(getFunctionName(ref), "apiPlatform:upsertWebhookSubscription");
  writes.push(args); return (args.id ?? "subscription-created") as any;
};
const app = express(); mountApiGateway(app);
const server = app.listen(0, "127.0.0.1");
await new Promise<void>(resolve => server.once("listening", resolve));
const address = server.address(); assert.ok(address && typeof address === "object");
const base = `http://127.0.0.1:${address.port}/api/v1`;
const body = { societyId: "workspace-a", name: "Governance notices", targetUrl: "http://127.0.0.1:18080/receive", eventTypes: ["meeting.created"], secretEncrypted: "client-forged-plaintext" };
const post = (data: any, authenticated = true) => fetch(`${base}/webhook-subscriptions`, { method: "POST", headers: { "content-type": "application/json", ...(authenticated ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(data) });
try {
  let response = await post(body); assert.equal(response.status, 201, await response.clone().text());
  let json = await response.json() as any;
  const firstSecret = json.data.signingSecret;
  assert.ok(firstSecret && firstSecret !== body.secretEncrypted);
  assert.match(writes[0].secretEncrypted, /^v1\./);
  assert.equal(decryptSecret(writes[0].secretEncrypted), firstSecret);
  assert.equal(writes[0].createdByUserId, "user-a");
  response = await post({ ...body, id: "subscription-created" }); assert.equal(response.status, 200);
  json = await response.json(); assert.notEqual(json.data.signingSecret, firstSecret);
  assert.equal(writes[1].id, "subscription-created");
  assert.equal(decryptSecret(writes[1].secretEncrypted), json.data.signingSecret);
  const listed = await fetch(`${base}/webhook-subscriptions?societyId=workspace-a`, { headers: { authorization: `Bearer ${token}` } });
  const listText = await listed.text(); assert.equal(listed.status, 200);
  assert.ok(!listText.includes(firstSecret) && !listText.includes(json.data.signingSecret) && !listText.includes("secretEncrypted"));
  response = await post({ ...body, id: "foreign-subscription" }); assert.equal(response.status, 403);
  role = "Member";
  response = await post({ ...body, id: "subscription-created" }); assert.equal(response.status, 403);
  response = await post(body, false); assert.equal(response.status, 401);
  assert.equal(writes.length, 2, "foreign, unauthorized and anonymous requests must not create or rotate secrets");
  console.log("Webhook secret route passed: authenticated current Owner creation/rotation encrypts server-generated one-time secrets; foreign-row, insufficient-role and anonymous requests cannot write; list responses expose no secrets.");
} finally {
  await new Promise<void>(resolve => server.close(() => resolve()));
  ConvexHttpClient.prototype.query = originalQuery; ConvexHttpClient.prototype.mutation = originalMutation;
  await rm(dir, { recursive: true, force: true });
}
